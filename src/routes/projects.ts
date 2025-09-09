// --- REPLACE THE ENTIRE FILE CONTENT ---
// File path: src/routes/projects.ts

import { Router, Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import { getDb } from '../services/firebaseAdmin';
import * as GcpService from '../services/gcp';
import * as GithubService from '../services/github';

// --- Interfaces & Types ---
interface UserProfile {
  uid: string;
  email: string;
  roles: { superAdmin?: boolean; orgAdmin?: string[]; }
}
interface AuthenticatedRequest extends Request {
  user?: admin.auth.DecodedIdToken;
  userProfile?: UserProfile;
}

const router = Router();
const db = getDb();
const PROJECTS_COLLECTION = db.collection('projects');
const USERS_COLLECTION = db.collection('users');
const ORGS_COLLECTION = db.collection('orgs');

// --- Logger ---
async function projectLogger(projectId: string, evt: string, meta: Record<string, any> = {}) {
    const logEntry = { ts: new Date().toISOString(), severity: 'INFO', evt, ...meta };
    console.log(JSON.stringify({ projectId, ...logEntry }));
    try {
        PROJECTS_COLLECTION.doc(projectId).collection('logs').add({
            ...logEntry,
            serverTimestamp: admin.firestore.FieldValue.serverTimestamp()
        }).catch(error => console.error(`ASYNC LOG FAILED: Failed to write log to Firestore for project ${projectId}`, error));
    } catch (error) { 
        console.error(`SYNC LOG FAILED: Failed to write log to Firestore for project ${projectId}`, error); 
    }
}


// --- Auth Middleware ---
async function verifyFirebaseToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const token = req.headers['x-firebase-id-token'] as string || (req.headers.authorization || '').slice(7);
    if (!token) return res.status(401).json({ error: 'Missing token' });
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch (e: any) { res.status(401).json({ error: 'Unauthorized', detail: e.message }); }
}

async function fetchUserProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const { uid, email } = req.user;
  try {
    const userDoc = await USERS_COLLECTION.doc(uid).get();
    if (!userDoc.exists) {
      const newUserProfile: UserProfile = { uid, email: email || '', roles: {} };
      await USERS_COLLECTION.doc(uid).set(newUserProfile);
      req.userProfile = newUserProfile;
    } else {
      req.userProfile = userDoc.data() as UserProfile;
    }
    next();
  } catch (e: any) { res.status(500).json({ error: 'Failed to fetch user profile' }); }
}

function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (req.userProfile?.roles?.superAdmin !== true) {
        return res.status(403).json({ error: 'Permission denied' });
    }
    next();
}

export const requireAuth = [verifyFirebaseToken, fetchUserProfile];
export const requireAdminAuth = [...requireAuth, requireSuperAdmin];

// --- Orchestration Logic ---
async function runFullProvisioning(projectId: string) {
    const log = (evt: string, meta?: Record<string, any>) => projectLogger(projectId, evt, meta);
    
    try {
        // --- STAGE 1: GCP ---
        await log('stage.gcp.start');
        const projectDoc = await PROJECTS_COLLECTION.doc(projectId).get();
        if (!projectDoc.exists) throw new Error('Project document not found in Firestore.');

        const { displayName, orgId, template } = projectDoc.data()!;
        const orgDoc = await ORGS_COLLECTION.doc(orgId).get();
        if (!orgDoc.exists || !orgDoc.data()!.gcpFolderId) throw new Error('Parent organization data or GCP Folder ID is invalid.');

        await PROJECTS_COLLECTION.doc(projectId).update({ state: 'provisioning_gcp' });
        const gcpInfra = await GcpService.provisionProjectInfrastructure(projectId, displayName, orgDoc.data()!.gcpFolderId);
        
        await PROJECTS_COLLECTION.doc(projectId).update({
            state: 'pending_github',
            gcpProjectId: gcpInfra.projectId,
            gcpProjectNumber: gcpInfra.projectNumber,
            gcpServiceAccount: gcpInfra.serviceAccountEmail,
            gcpWifProvider: gcpInfra.wifProviderName
        });
        await log('stage.gcp.success', { nextState: 'pending_github' });
        
        // --- STAGE 2: GitHub ---
        await log('stage.github.start');
        if (!orgDoc.data()!.githubTeamSlug) throw new Error('Parent organization data or GitHub Team Slug is invalid.');
        
        await PROJECTS_COLLECTION.doc(projectId).update({ state: 'provisioning_github' });
        const projectInfo = {
            id: projectId, 
            displayName: displayName,
            gcpRegion: process.env.GCP_DEFAULT_REGION || 'europe-west1'
        };
        const githubRepo = await GithubService.createGithubRepoFromTemplate(projectInfo, orgDoc.data()!.githubTeamSlug, template);

        await PROJECTS_COLLECTION.doc(projectId).update({
            state: 'pending_secrets', githubRepoUrl: githubRepo.url
        });
        await log('stage.github.success', { nextState: 'pending_secrets' });

        // --- STAGE 3: Finalize (Secrets & Deployment) ---
        await log('stage.finalize.start');
        await PROJECTS_COLLECTION.doc(projectId).update({ state: 'injecting_secrets' });
        
        const secretsToCreate = {
            GCP_PROJECT_ID: gcpInfra.projectId,
            GCP_REGION: process.env.GCP_DEFAULT_REGION || 'europe-west1',
            WIF_PROVIDER: gcpInfra.wifProviderName,
            DEPLOYER_SA: gcpInfra.serviceAccountEmail,
        };
        await GithubService.createRepoSecrets(projectId, secretsToCreate);
        await GithubService.triggerInitialDeployment(projectId);

        await PROJECTS_COLLECTION.doc(projectId).update({ state: 'ready' });
        await log('stage.finalize.success', { finalState: 'ready' });

    } catch (e: any) {
        const errorMessage = (e as Error).message || 'An unknown error occurred';
        const projectDoc = await PROJECTS_COLLECTION.doc(projectId).get();
        const currentState = projectDoc.data()?.state || 'unknown';
        const failedState = `failed_${currentState.replace('provisioning_', '').replace('injecting_', '')}`;
        
        await PROJECTS_COLLECTION.doc(projectId).update({ state: failedState, error: errorMessage });
        await log(`stage.${currentState}.failed`, { error: errorMessage, stack: (e as Error).stack });
    }
}

// --- ROUTES ---

router.get('/projects', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
        let query: admin.firestore.Query | admin.firestore.CollectionReference = PROJECTS_COLLECTION;
        if (!req.userProfile?.roles?.superAdmin) {
            const orgIds = req.userProfile?.roles?.orgAdmin || [];
            if (orgIds.length === 0) return res.json([]);
            query = query.where('orgId', 'in', orgIds);
        }
        const snap = await query.orderBy('createdAt', 'desc').limit(100).get();
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        res.json(list);
    } catch(e: any) { res.status(500).json({ error: "Failed to list projects" }); }
});

router.get('/projects/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;
        const projectDoc = await PROJECTS_COLLECTION.doc(id).get();
        if (!projectDoc.exists) return res.status(404).json({ error: 'Project not found' });
        const projectData = projectDoc.data()!;
        if (!req.userProfile?.roles?.superAdmin && !req.userProfile?.roles?.orgAdmin?.includes(projectData.orgId)) {
            return res.status(403).json({ error: 'Permission denied' });
        }
        res.json({ id: projectDoc.id, ...projectData });
    } catch (e: any) { res.status(500).json({ error: "Failed to get project details" }); }
});

router.get('/projects/:id/logs', requireAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const logsSnap = await PROJECTS_COLLECTION.doc(id).collection('logs').orderBy('serverTimestamp', 'asc').get();
        const logs = logsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json({ ok: true, logs });
    } catch (e: any) { res.status(500).json({ ok: false, error: 'failed-to-get-logs' }); }
});

router.post('/projects', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    const { orgId, displayName, shortName, template } = req.body;
    if (!orgId || !displayName || !shortName || !template) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    let projectId = '';
    try {
        const orgDoc = await ORGS_COLLECTION.doc(orgId).get();
        if (!orgDoc.exists) return res.status(404).json({ error: 'Organization not found' });
        
        const orgName = orgDoc.data()?.name || 'unknown';
        const orgSlug = orgName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const formattedShortName = shortName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        projectId = `wizbi-${orgSlug}-${formattedShortName}`;

        const projectDocRef = PROJECTS_COLLECTION.doc(projectId);
        if ((await projectDocRef.get()).exists) {
            return res.status(409).json({ error: `Project ID '${projectId}' already exists.` });
        }
        
        await projectLogger(projectId, 'project.create.init', { orgId, displayName, shortName, template });
        await projectDocRef.set({
            displayName, orgId, shortName, template,
            createdAt: new Date().toISOString(),
            state: 'pending_gcp',
        });
        await projectLogger(projectId, 'project.create.success', { finalProjectId: projectId });
        res.status(201).json({ ok: true, id: projectId });
    } catch (error: any) {
        const eid = projectId || 'unknown-project';
        await projectLogger(eid, 'project.create.fatal', { error: (error as Error).message, stack: (error as Error).stack });
        res.status(500).json({ ok: false, error: 'Failed to create project', detail: (error as Error).message });
    }
});

// --- UNIFIED PROVISIONING ENDPOINT ---
// This single endpoint starts or retries the entire provisioning flow.
router.post('/projects/:id/provision', requireAdminAuth, async (req: Request, res: Response) => {
    const { id } = req.params;
    const projectDoc = await PROJECTS_COLLECTION.doc(id).get();
    const state = projectDoc.data()?.state;

    // Prevent re-triggering if already in progress
    if (state && (state.startsWith('provisioning') || state.startsWith('injecting'))) {
        return res.status(409).json({ ok: false, error: 'Provisioning is already in progress.'});
    }

    // Acknowledge the request immediately
    res.status(202).json({ ok: true, message: 'Full provisioning process initiated.' });

    // Run the long process in the background
    runFullProvisioning(id);
});


router.delete('/projects/:id', requireAdminAuth, async (req: Request, res: Response) => {
    const { id } = req.params;
    const log = (evt: string, meta?: Record<string, any>) => projectLogger(id, evt, meta);
    try {
        const projectDoc = await PROJECTS_COLLECTION.doc(id).get();
        if (!projectDoc.exists) return res.status(404).json({ error: 'Project not found' });
        
        await log('project.delete.received');
        res.status(202).json({ ok: true, message: 'Project deletion started.' });

        (async () => {
            try {
                await PROJECTS_COLLECTION.doc(id).update({ state: 'deleting' });
                await GcpService.deleteGcpProject(id);
                await GithubService.deleteGithubRepo(id);
                await log('project.delete.cleanup.start');
                const logsCollection = PROJECTS_COLLECTION.doc(id).collection('logs');
                const logsSnapshot = await logsCollection.get();
                const batch = db.batch();
                logsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
                await batch.commit();
                await PROJECTS_COLLECTION.doc(id).delete();
                console.log(JSON.stringify({ projectId: id, evt: 'project.delete.success' }));
            } catch (error: any) {
                const errorMessage = (error as Error).message || 'Unknown error during deletion';
                await PROJECTS_COLLECTION.doc(id).update({ state: 'delete_failed', error: errorMessage });
                await log('project.delete.failed', { error: errorMessage });
            }
        })();
    } catch (e: any) {
        await log('project.delete.initial_error', { error: (e as Error).message });
        res.status(500).json({ ok: false, error: 'Failed to start project deletion.' });
    }
});

export default router;

export const log = (evt: string, meta: Record<string, any> = {}) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), severity: 'INFO', evt, ...meta }));
}
