// --- REPLACE THE ENTIRE FILE CONTENT ---
// File path: src/routes/projects.ts
// FINAL, PERFECTED VERSION: Includes doc preview, backfill functionality, and refactored logic.

import { Router, Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import { getDb } from '../services/firebaseAdmin';
import * as GcpService from '../services/gcp';
import * as GithubService from '../services/github';
import { google } from 'googleapis';

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

// Custom error for billing issues
class BillingError extends Error {
    public gcpProjectId: string;
    constructor(message: string, gcpProjectId: string) {
        super(message);
        this.name = 'BillingError';
        this.gcpProjectId = gcpProjectId;
    }
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

// --- REUSABLE CORE LOGIC ---

/**
 * Creates and populates a Google Doc for a given project.
 * @param projectId The ID of the project.
 * @param projectData The project's data from Firestore.
 * @returns The URL of the newly created document.
 */
async function createAndPopulateSpecDoc(projectId: string, projectData: admin.firestore.DocumentData): Promise<string> {
    const log = (evt: string, meta?: Record<string, any>) => projectLogger(projectId, evt, meta);
    const { displayName, orgId, template, gcpProjectId, githubRepoUrl, createdAt } = projectData;

    try {
        log('stage.docs.create.start');
        const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/drive'] });
        const drive = google.drive({ version: 'v3', auth });
        const docs = google.docs({ version: 'v1', auth });

        const templateFileId = '18Rs1tt0j4xL6lj9NFKSPAit_-smk-EOmCTdecvpco8U';
        const parentFolderId = '1MBK_KI0o7y45Y8WFV3pbPT_MBDh4wvt0';

        if (!templateFileId || templateFileId.length < 20) {
            log('stage.docs.create.skipped', { reason: 'Template ID not configured' });
            return '';
        }

        const { data: newFile } = await drive.files.copy({
            fileId: templateFileId,
            requestBody: {
                name: `[WIZBI] Project Specification: ${displayName}`,
                parents: [parentFolderId]
            }
        });

        if (!newFile.id) {
            throw new Error('No file ID returned from Google Drive API on copy.');
        }

        await drive.permissions.create({
            fileId: newFile.id,
            requestBody: { role: 'reader', type: 'anyone' }
        });
        const specDocUrl = `https://docs.google.com/document/d/${newFile.id}/edit`;
        log('stage.docs.create.success', { specDocUrl });

        const creationDate = new Date(createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const orgData = (await ORGS_COLLECTION.doc(orgId).get()).data();
        
        await docs.documents.batchUpdate({
            documentId: newFile.id,
            requestBody: {
                requests: [
                    { replaceAllText: { containsText: { text: '{{PROJECT_DISPLAY_NAME}}', matchCase: true }, replaceText: displayName } },
                    { replaceAllText: { containsText: { text: '{{PROJECT_ID}}', matchCase: true }, replaceText: projectId } },
                    { replaceAllText: { containsText: { text: '{{ORGANIZATION_NAME}}', matchCase: true }, replaceText: orgData?.name || 'N/A' } },
                    { replaceAllText: { containsText: { text: '{{TEMPLATE_NAME}}', matchCase: true }, replaceText: template } },
                    { replaceAllText: { containsText: { text: '{{CREATION_DATE}}', matchCase: true }, replaceText: creationDate } },
                    { replaceAllText: { containsText: { text: '{{GITHUB_REPO_URL}}', matchCase: true }, replaceText: githubRepoUrl } },
                    { replaceAllText: { containsText: { text: '{{PROD_URL}}', matchCase: true }, replaceText: `https://${projectId}.web.app` } },
                    { replaceAllText: { containsText: { text: '{{QA_URL}}', matchCase: true }, replaceText: `https://${projectId}-qa.web.app` } },
                    { replaceAllText: { containsText: { text: '{{FIREBASE_CONSOLE_URL}}', matchCase: true }, replaceText: `https://console.firebase.google.com/project/${gcpProjectId}` } },
                    { replaceAllText: { containsText: { text: '{{GCP_CONSOLE_URL}}', matchCase: true }, replaceText: `https://console.cloud.google.com/?project=${gcpProjectId}` } },
                ]
            }
        });
        log('stage.docs.populate.success', { documentId: newFile.id });

        return specDocUrl;

    } catch (error: any) {
        log('stage.docs.create.error', { error: error.message, stack: error.stack });
        return ''; // Return empty string on failure, the process should not halt
    }
}

// --- Orchestration Logic ---
async function runFullProvisioning(projectId: string) {
    const log = (evt: string, meta?: Record<string, any>) => projectLogger(projectId, evt, meta);
    
    try {
        // --- STAGE 1: GCP ---
        await log('stage.gcp.start');
        let projectDoc = await PROJECTS_COLLECTION.doc(projectId).get();
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
        
        // Refresh project data to ensure all fields are present before doc creation
        projectDoc = await PROJECTS_COLLECTION.doc(projectId).get();
        const specDocUrl = await createAndPopulateSpecDoc(projectId, projectDoc.data()!);

        await PROJECTS_COLLECTION.doc(projectId).update({ 
            state: 'ready', 
            error: null,
            specDocUrl: specDocUrl || null
        });
        await log('stage.finalize.success', { finalState: 'ready' });

    } catch (e: any) {
        if (e instanceof BillingError) {
            const billingUrl = `https://console.cloud.google.com/billing/linkedaccount?project=${e.gcpProjectId}`;
            const errorMessage = `Manual action required: Please link billing account. URL: ${billingUrl}`;
            await PROJECTS_COLLECTION.doc(projectId).update({ 
                state: 'pending_billing', 
                error: errorMessage,
                gcpProjectId: e.gcpProjectId
            });
            await log('stage.gcp.billing_failed_manual_intervention', { error: e.message, gcpProjectId: e.gcpProjectId, billingUrl });
            return; 
        }

        const errorMessage = (e as Error).message || 'An unknown error occurred';
        const projectDoc = await PROJECTS_COLLECTION.doc(projectId).get();
        const currentState = projectDoc.data()?.state || 'unknown';
        const failedState = `failed_${currentState.replace('provisioning_', '').replace('injecting_', '').replace('pending_', '')}`;
        
        await PROJECTS_COLLECTION.doc(projectId).update({ state: failedState, error: errorMessage });
        await log(`stage.${currentState.replace('pending_','provisioning_')}.failed`, { error: errorMessage, stack: (e as Error).stack });
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
        runFullProvisioning(projectId);
    } catch (error: any) {
        const eid = projectId || 'unknown-project';
        await projectLogger(eid, 'project.create.fatal', { error: (error as Error).message, stack: (error as Error).stack });
        res.status(500).json({ ok: false, error: 'Failed to create project', detail: (error as Error).message });
    }
});

router.post('/projects/:id/provision', requireAdminAuth, async (req: Request, res: Response) => {
    const { id } = req.params;
    const projectDoc = await PROJECTS_COLLECTION.doc(id).get();
    const state = projectDoc.data()?.state;

    if (state && (state.startsWith('provisioning') || state.startsWith('injecting'))) {
        return res.status(409).json({ ok: false, error: 'Provisioning is already in progress.'});
    }

    if (state === 'pending_billing' || state === 'failed_billing' || state.startsWith('failed')) {
        res.status(202).json({ ok: true, message: 'Retrying full provisioning process.' });
        runFullProvisioning(id);
    } else {
        res.status(202).json({ ok: true, message: 'Full provisioning process initiated.' });
        runFullProvisioning(id);
    }
});

// --- NEW ENDPOINT FOR BACKFILLING DOCS ---
router.post('/projects/:id/generate-doc', requireAdminAuth, async (req: Request, res: Response) => {
    const { id } = req.params;
    const log = (evt: string, meta?: Record<string, any>) => projectLogger(id, evt, meta);
    
    try {
        log('project.doc.generate.received');
        const projectDoc = await PROJECTS_COLLECTION.doc(id).get();
        if (!projectDoc.exists) {
            return res.status(404).json({ error: 'Project not found' });
        }
        const projectData = projectDoc.data()!;
        if (projectData.specDocUrl) {
            return res.status(400).json({ error: 'Document already exists for this project.' });
        }

        const specDocUrl = await createAndPopulateSpecDoc(id, projectData);
        if (!specDocUrl) {
            throw new Error('Document creation failed. Check logs for details.');
        }

        await PROJECTS_COLLECTION.doc(id).update({ specDocUrl });
        log('project.doc.generate.success', { specDocUrl });
        
        res.status(200).json({ ok: true, message: 'Document generated successfully.', specDocUrl });

    } catch (error: any) {
        log('project.doc.generate.error', { error: error.message });
        res.status(500).json({ ok: false, error: 'Failed to generate document', detail: error.message });
    }
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

export { BillingError };

export const log = (evt: string, meta: Record<string, any> = {}) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), severity: 'INFO', evt, ...meta }));
}
