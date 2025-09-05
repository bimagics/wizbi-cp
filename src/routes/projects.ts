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

interface Project {
    id: string;
    createdAt: string;
    [key: string]: any;
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

// --- Enhanced Logger ---
async function projectLogger(projectId: string, evt: string, meta: Record<string, any> = {}) {
    const timestamp = new Date();
    const logEntry = {
        ts: timestamp.toISOString(),
        severity: 'INFO',
        evt,
        ...meta
    };

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
  console.log(JSON.stringify({ ts: new Date().toISOString(), evt: 'auth.middleware.verify_token.start' }));
  try {
    const token = req.headers['x-firebase-id-token'] as string || (req.headers.authorization || '').slice(7);
    if (!token) {
      return res.status(401).json({ error: 'Missing authentication token' });
    }
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch (e: any) {
    console.error('Token verification failed', e);
    res.status(401).json({ error: 'Unauthorized', detail: e.message });
  }
}

async function fetchUserProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Authentication not performed' });
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
    console.error(`Failed to fetch profile for UID ${uid}`, e);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
}

function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (req.userProfile?.roles?.superAdmin !== true) {
        return res.status(403).json({ error: 'Permission denied: Super admin role required.' });
    }
    next();
}

export const requireAuth = [verifyFirebaseToken, fetchUserProfile];
export const requireAdminAuth = [...requireAuth, requireSuperAdmin];

// --- The Main Provisioning Engine ---
async function provisionProject(projectId: string, displayName: string, orgId: string) {
    const projectDocRef = PROJECTS_COLLECTION.doc(projectId);
    const log = (evt: string, meta?: Record<string, any>) => projectLogger(projectId, evt, meta);

    const updateState = async (state: string, data: object = {}) => {
        await projectDocRef.set({ state, ...data }, { merge: true });
        await log(`provision.state_change.${state}`, data);
    };

    try {
        await updateState('starting', { displayName, orgId, createdAt: new Date().toISOString() });

        const orgDoc = await ORGS_COLLECTION.doc(orgId).get();
        if (!orgDoc.exists) throw new Error(`Organization ${orgId} not found.`);
        const orgData = orgDoc.data()!;
        if (!orgData.githubTeamSlug || !orgData.gcpFolderId) {
            throw new Error(`Organization ${orgId} is missing critical data (githubTeamSlug or gcpFolderId).`);
        }
        await log('provision.org_data.validated', { orgId });

        await updateState('provisioning_gcp');
        const gcpInfra = await GcpService.provisionProjectInfrastructure(projectId, displayName, orgData.gcpFolderId);
        await log('provision.gcp_infra.success', { gcpProjectId: gcpInfra.projectId });

        await updateState('provisioning_github');
        const githubRepo = await GithubService.createGithubRepoFromTemplate(projectId, orgData.githubTeamSlug);
        await projectDocRef.update({ githubRepoUrl: githubRepo.url, gcpProjectId: gcpInfra.projectId });
        await log('provision.github_repo.success', { repoUrl: githubRepo.url });

        await updateState('injecting_secrets');
        const secretsToCreate = {
            GCP_PROJECT_ID: gcpInfra.projectId,
            GCP_REGION: process.env.GCP_DEFAULT_REGION || 'europe-west1',
            WIF_PROVIDER: gcpInfra.wifProviderName,
            DEPLOYER_SA: gcpInfra.serviceAccountEmail,
        };
        await GithubService.createRepoSecrets(githubRepo.name, secretsToCreate);
        await log('provision.secrets_injected.success', { secretNames: Object.keys(secretsToCreate) });

        await updateState('ready');

    } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await log('provision.error.fatal', { error: errorMessage, stack: error.stack });
        await updateState('failed', { error: errorMessage });
    }
}

// --- Routes ---
router.get('/projects', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
        let query: admin.firestore.Query | admin.firestore.CollectionReference = PROJECTS_COLLECTION;
        const userProfile = req.userProfile;
        if (!userProfile?.roles?.superAdmin) {
            const orgIds = userProfile?.roles?.orgAdmin || [];
            if (orgIds.length > 0) {
                query = query.where('orgId', 'in', orgIds);
            } else {
                return res.json([]);
            }
        }
        query = query.orderBy('createdAt', 'desc');

        const snap = await query.limit(100).get();
        const list: Project[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as Project));
        res.json(list);
    } catch(e: any) {
        console.error('Failed to list projects', e);
        res.status(500).json({ error: "Failed to list projects" });
    }
});

// --- NEW ROUTE: Get logs for a specific project ---
router.get('/projects/:id/logs', requireAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const logsSnap = await PROJECTS_COLLECTION.doc(id).collection('logs').orderBy('serverTimestamp', 'asc').get();
        const logs = logsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json({ ok: true, logs });
    } catch (e: any) {
        console.error(`Failed to get logs for project ${req.params.id}`, e);
        res.status(500).json({ ok: false, error: 'failed-to-get-logs' });
    }
});


router.post('/projects', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    const { orgId, projectId, displayName } = req.body;
    if (!orgId || !projectId || !displayName) {
        return res.status(400).json({ error: 'orgId, projectId, and displayName are required' });
    }
    
    const existingProject = await PROJECTS_COLLECTION.doc(projectId).get();
    if (existingProject.exists) {
        return res.status(409).json({ error: `Project with ID '${projectId}' already exists.` });
    }
    
    res.status(202).json({ ok: true, message: 'Project provisioning accepted and started.', projectId });
    
    provisionProject(projectId.trim(), displayName.trim(), orgId);
});


router.delete('/projects/:id', requireAdminAuth, async (req: Request, res: Response) => {
    const { id } = req.params;
    const log = (evt: string, meta?: Record<string, any>) => projectLogger(id, evt, meta);

    try {
        const projectDoc = await PROJECTS_COLLECTION.doc(id).get();
        if (!projectDoc.exists) {
            return res.status(404).json({ error: 'Project not found' });
        }
        await log('project.delete.received');

        await PROJECTS_COLLECTION.doc(id).update({ state: 'deleting' });

        (async () => {
            try {
                await log('project.delete.gcp_cleanup.start');
                await GcpService.deleteGcpProject(id);
                await log('project.delete.gcp_cleanup.success');
                
                await log('project.delete.github_cleanup.start');
                await GithubService.deleteGithubRepo(id);
                await log('project.delete.github_cleanup.success');

                await log('project.delete.firestore_cleanup.start');
                await PROJECTS_COLLECTION.doc(id).delete();
                log('project.delete.firestore_cleanup.success');
            } catch (error: any) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                await log('project.delete.error.fatal', { error: errorMessage });
                await PROJECTS_COLLECTION.doc(id).update({ state: 'delete_failed', error: errorMessage });
            }
        })();

        res.status(202).json({ ok: true, message: 'Project deletion started.' });

    } catch (e: any) {
        await log('project.delete.error.initial', { error: (e as Error).message });
        res.status(500).json({ ok: false, error: 'Failed to start project deletion.' });
    }
});


export default router;

// Re-exporting log for use in other services that may not have a projectId context
export const log = (evt: string, meta: Record<string, any> = {}) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), severity: 'INFO', evt, ...meta }));
}
