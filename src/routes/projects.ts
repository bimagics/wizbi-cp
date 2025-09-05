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
  roles: {
    superAdmin?: boolean;
    orgAdmin?: string[];
  }
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
        await PROJECTS_COLLECTION.doc(projectId).collection('logs').add({
            ...logEntry,
            serverTimestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        console.error(`Failed to write log to Firestore for project ${projectId}`, error);
    }
}

// --- Auth Middleware ---
async function verifyFirebaseToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const token = req.headers['x-firebase-id-token'] as string || (req.headers.authorization || '').slice(7);
    if (!token) return res.status(401).json({ error: 'Missing token' });
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch (e: any) {
    res.status(401).json({ error: 'Unauthorized', detail: e.message });
  }
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
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
}

function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (req.userProfile?.roles?.superAdmin !== true) {
        return res.status(403).json({ error: 'Permission denied' });
    }
    next();
}

export const requireAuth = [verifyFirebaseToken, fetchUserProfile];
export const requireAdminAuth = [...requireAuth, requireSuperAdmin];

// --- ROUTES ---

// Get all projects
router.get('/projects', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
        let query: admin.firestore.Query | admin.firestore.CollectionReference = PROJECTS_COLLECTION;
        const userProfile = req.userProfile;
        if (!userProfile?.roles?.superAdmin) {
            const orgIds = userProfile?.roles?.orgAdmin || [];
            if (orgIds.length === 0) return res.json([]);
            query = query.where('orgId', 'in', orgIds);
        }
        const snap = await query.orderBy('createdAt', 'desc').limit(100).get();
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        res.json(list);
    } catch(e: any) {
        res.status(500).json({ error: "Failed to list projects" });
    }
});

// Get logs for a project
router.get('/projects/:id/logs', requireAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const logsSnap = await PROJECTS_COLLECTION.doc(id).collection('logs').orderBy('serverTimestamp', 'asc').get();
        const logs = logsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json({ ok: true, logs });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: 'failed-to-get-logs' });
    }
});

// STAGE 0: Create the initial project document
router.post('/projects', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    const { orgId, projectId, displayName } = req.body;
    if (!orgId || !projectId || !displayName) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    const projectDocRef = PROJECTS_COLLECTION.doc(projectId);

    if ((await projectDocRef.get()).exists) {
        return res.status(409).json({ error: `Project '${projectId}' already exists.` });
    }

    await projectDocRef.set({
        displayName, orgId,
        createdAt: new Date().toISOString(),
        state: 'pending_gcp',
    });
    await projectLogger(projectId, 'project.created', { displayName, orgId });

    res.status(201).json({ ok: true, id: projectId });
});

// STAGE 1: Provision GCP Infrastructure
router.post('/projects/:id/provision-gcp', requireAdminAuth, async (req: Request, res: Response) => {
    const { id } = req.params;
    const log = (evt: string, meta?: Record<string, any>) => projectLogger(id, evt, meta);
    
    res.status(202).json({ ok: true, message: 'GCP provisioning started.' });

    try {
        const projectDoc = await PROJECTS_COLLECTION.doc(id).get();
        if (!projectDoc.exists) throw new Error('Project not found.');

        const { displayName, orgId } = projectDoc.data()!;
        const orgDoc = await ORGS_COLLECTION.doc(orgId).get();
        if (!orgDoc.exists || !orgDoc.data()!.gcpFolderId) throw new Error('Organization data is invalid.');
        
        await PROJECTS_COLLECTION.doc(id).update({ state: 'provisioning_gcp' });
        log('gcp.provision.start');
        
        const gcpInfra = await GcpService.provisionProjectInfrastructure(id, displayName, orgDoc.data()!.gcpFolderId);
        
        await PROJECTS_COLLECTION.doc(id).update({
            state: 'pending_github',
            gcpProjectId: gcpInfra.projectId,
            gcpProjectNumber: gcpInfra.projectNumber,
            gcpServiceAccount: gcpInfra.serviceAccountEmail,
            gcpWifProvider: gcpInfra.wifProviderName
        });
        log('gcp.provision.success', gcpInfra);

    } catch (e: any) {
        await PROJECTS_COLLECTION.doc(id).update({ state: 'failed_gcp', error: e.message });
        log('gcp.provision.failed', { error: e.message, stack: e.stack });
    }
});

// STAGE 2: Provision GitHub Repository
router.post('/projects/:id/provision-github', requireAdminAuth, async (req: Request, res: Response) => {
    const { id } = req.params;
    const log = (evt: string, meta?: Record<string, any>) => projectLogger(id, evt, meta);

    res.status(202).json({ ok: true, message: 'GitHub provisioning started.' });

    try {
        const projectDoc = await PROJECTS_COLLECTION.doc(id).get();
        if (!projectDoc.exists) throw new Error('Project not found.');
        
        const { orgId } = projectDoc.data()!;
        const orgDoc = await ORGS_COLLECTION.doc(orgId).get();
        if (!orgDoc.exists || !orgDoc.data()!.githubTeamSlug) throw new Error('Organization data is invalid.');
        
        await PROJECTS_COLLECTION.doc(id).update({ state: 'provisioning_github' });
        log('github.provision.start');
        
        const githubRepo = await GithubService.createGithubRepoFromTemplate(id, orgDoc.data()!.githubTeamSlug);
        
        await PROJECTS_COLLECTION.doc(id).update({
            state: 'pending_secrets',
            githubRepoUrl: githubRepo.url
        });
        log('github.provision.success', githubRepo);

    } catch (e: any) {
        await PROJECTS_COLLECTION.doc(id).update({ state: 'failed_github', error: e.message });
        log('github.provision.failed', { error: e.message, stack: e.stack });
    }
});

// STAGE 3: Inject Secrets and Finalize
router.post('/projects/:id/finalize', requireAdminAuth, async (req: Request, res: Response) => {
    const { id } = req.params;
    const log = (evt: string, meta?: Record<string, any>) => projectLogger(id, evt, meta);

    res.status(202).json({ ok: true, message: 'Finalization started.' });

    try {
        await PROJECTS_COLLECTION.doc(id).update({ state: 'injecting_secrets' });
        log('finalize.start');
        
        const projectDoc = await PROJECTS_COLLECTION.doc(id).get();
        const projectData = projectDoc.data();
        if (!projectData) throw new Error("Project data not found");

        // --- FIX: Add validation for required fields before creating secrets ---
        if (!projectData.gcpProjectId || !projectData.gcpWifProvider || !projectData.gcpServiceAccount) {
            throw new Error('Project document is missing required GCP data for finalization. GCP provisioning may have failed.');
        }

        const secretsToCreate = {
            GCP_PROJECT_ID: projectData.gcpProjectId,
            GCP_REGION: process.env.GCP_DEFAULT_REGION || 'europe-west1',
            WIF_PROVIDER: projectData.gcpWifProvider,
            DEPLOYER_SA: projectData.gcpServiceAccount,
        };
        await GithubService.createRepoSecrets(id, secretsToCreate);
        
        await PROJECTS_COLLECTION.doc(id).update({ state: 'ready' });
        log('finalize.success');

    } catch (e: any) {
        await PROJECTS_COLLECTION.doc(id).update({ state: 'failed_secrets', error: e.message });
        log('finalize.failed', { error: e.message, stack: e.stack });
    }
});

// DELETE a project
router.delete('/projects/:id', requireAdminAuth, async (req: Request, res: Response) => {
    const { id } = req.params;
    const log = (evt: string, meta?: Record<string, any>) => projectLogger(id, evt, meta);

    try {
        const projectDoc = await PROJECTS_COLLECTION.doc(id).get();
        if (!projectDoc.exists) {
            return res.status(404).json({ error: 'Project not found' });
        }
        await log('project.delete.received');
        
        // Fire-and-forget deletion process
        (async () => {
            try {
                await PROJECTS_COLLECTION.doc(id).update({ state: 'deleting' });
                await GcpService.deleteGcpProject(id);
                await GithubService.deleteGithubRepo(id);
                await PROJECTS_COLLECTION.doc(id).delete();
                log('project.delete.success');
            } catch (error: any) {
                const errorMessage = error.message || 'Unknown error during deletion';
                await PROJECTS_COLLECTION.doc(id).update({ state: 'delete_failed', error: errorMessage });
                log('project.delete.failed', { error: errorMessage });
            }
        })();

        res.status(202).json({ ok: true, message: 'Project deletion started.' });

    } catch (e: any) {
        await log('project.delete.initial_error', { error: (e as Error).message });
        res.status(500).json({ ok: false, error: 'Failed to start project deletion.' });
    }
});


export default router;

// Re-exporting log for use in other services
export const log = (evt: string, meta: Record<string, any> = {}) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), severity: 'INFO', evt, ...meta }));
}
