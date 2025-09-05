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

export function log(evt: string, meta: Record<string, any> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), severity: 'INFO', evt, ...meta }));
}

// --- Auth Middleware ---
async function verifyFirebaseToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  log('auth.middleware.verify_token.start');
  try {
    const token = req.headers['x-firebase-id-token'] as string || (req.headers.authorization || '').slice(7);
    if (!token) {
      log('auth.middleware.verify_token.error', { reason: 'Missing token' });
      return res.status(401).json({ error: 'Missing authentication token' });
    }
    req.user = await admin.auth().verifyIdToken(token);
    log('auth.middleware.verify_token.success', { uid: req.user.uid });
    next();
  } catch (e: any) {
    log('auth.middleware.verify_token.error', { error: e.message });
    res.status(401).json({ error: 'Unauthorized', detail: e.message });
  }
}

async function fetchUserProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Authentication not performed' });

  const { uid, email } = req.user;
  log('auth.middleware.fetch_profile.start', { uid, email });
  try {
    const userDoc = await USERS_COLLECTION.doc(uid).get();
    if (!userDoc.exists) {
      log('auth.middleware.fetch_profile.user_not_found', { uid });
      const newUserProfile: UserProfile = { uid, email: email || '', roles: {} };
      await USERS_COLLECTION.doc(uid).set(newUserProfile);
      req.userProfile = newUserProfile;
      log('auth.middleware.fetch_profile.user_created', { uid });
    } else {
      req.userProfile = userDoc.data() as UserProfile;
      log('auth.middleware.fetch_profile.success', { uid, roles: req.userProfile.roles });
    }
    next();
  } catch (e: any) {
    log('auth.middleware.fetch_profile.error', { uid, error: e.message, stack: e.stack });
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
}

function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (req.userProfile?.roles?.superAdmin !== true) {
        log('auth.permission_denied.superAdmin_required', { uid: req.userProfile?.uid });
        return res.status(403).json({ error: 'Permission denied: Super admin role required.' });
    }
    next();
}

export const requireAuth = [verifyFirebaseToken, fetchUserProfile];
export const requireAdminAuth = [...requireAuth, requireSuperAdmin];

// --- The Main Provisioning Engine ---
async function provisionProject(projectId: string, displayName: string, orgId: string) {
    const projectDocRef = PROJECTS_COLLECTION.doc(projectId);

    const updateState = async (state: string, data: object = {}) => {
        await projectDocRef.set({ state, ...data }, { merge: true });
        log(`provision.state_change.${state}`, { projectId, ...data });
    };

    try {
        await updateState('starting', { displayName, orgId, createdAt: new Date().toISOString() });

        const orgDoc = await ORGS_COLLECTION.doc(orgId).get();
        if (!orgDoc.exists) throw new Error(`Organization ${orgId} not found.`);
        const orgData = orgDoc.data()!;
        if (!orgData.githubTeamSlug || !orgData.gcpFolderId) {
            throw new Error(`Organization ${orgId} is missing critical data (githubTeamSlug or gcpFolderId).`);
        }

        await updateState('provisioning_gcp');
        const gcpInfra = await GcpService.provisionProjectInfrastructure(projectId, displayName, orgData.gcpFolderId);

        await updateState('provisioning_github');
        const githubRepo = await GithubService.createGithubRepoFromTemplate(projectId, orgData.githubTeamSlug);
        await projectDocRef.update({ githubRepoUrl: githubRepo.url, gcpProjectId: gcpInfra.projectId });

        await updateState('injecting_secrets');
        const secretsToCreate = {
            GCP_PROJECT_ID: gcpInfra.projectId,
            GCP_REGION: process.env.GCP_DEFAULT_REGION || 'europe-west1',
            WIF_PROVIDER: gcpInfra.wifProviderName,
            DEPLOYER_SA: gcpInfra.serviceAccountEmail,
        };
        await GithubService.createRepoSecrets(githubRepo.name, secretsToCreate);

        await updateState('ready');

    } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log('provision.error.fatal', { projectId, error: errorMessage, stack: error.stack });
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
        } else {
            query = query.orderBy('createdAt', 'desc');
        }

        const snap = await query.limit(100).get();
        const list: Project[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as Project));
        
        if (!userProfile?.roles?.superAdmin) {
            list.sort((a: Project, b: Project) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        }

        res.json(list);
    } catch(e: any) {
        log('projects.list.error', { error: e.message });
        res.status(500).json({ error: "Failed to list projects" });
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
    log('project.delete.received', { projectId: id });

    try {
        const projectDoc = await PROJECTS_COLLECTION.doc(id).get();
        if (!projectDoc.exists) {
            return res.status(404).json({ error: 'Project not found' });
        }

        await PROJECTS_COLLECTION.doc(id).update({ state: 'deleting' });

        (async () => {
            try {
                await GcpService.deleteGcpProject(id);
                await GithubService.deleteGithubRepo(id);
                await PROJECTS_COLLECTION.doc(id).delete();
                log('project.delete.success', { projectId: id });
            } catch (error: any) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                log('project.delete.error.fatal', { projectId: id, error: errorMessage });
                await PROJECTS_COLLECTION.doc(id).update({ state: 'delete_failed', error: errorMessage });
            }
        })();

        res.status(202).json({ ok: true, message: 'Project deletion started.' });

    } catch (e: any) {
        log('project.delete.error.initial', { projectId: id, error: e.message });
        res.status(500).json({ ok: false, error: 'Failed to start project deletion.' });
    }
});


export default router;
