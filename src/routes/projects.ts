import { Router, Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import { getDb } from '../services/firebaseAdmin';
import * as GithubService from '../services/github';

// --- Interfaces & Types ---
interface UserProfile {
  uid: string;
  email: string;
  roles: { superAdmin?: boolean; orgAdmin?: string[] }
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

// --- Utility Functions ---
export function log(evt: string, meta: Record<string, any> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), severity: 'INFO', evt, ...meta }));
}

// --- Permissions-Aware Auth Middleware ---
async function verifyFirebaseToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const token = req.headers['x-firebase-id-token'] as string || (req.headers.authorization || '').slice(7);
    if (!token) {
      log('auth.missing_token', { path: req.path });
      return res.status(401).json({ error: 'Missing authentication token' });
    }
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch (e: any) {
    log('auth.token_verify_failed', { path: req.path, error: e.message });
    res.status(401).json({ error: 'Unauthorized', detail: e.message });
  }
}

async function fetchUserProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication not performed' });
  }

  const { uid, email } = req.user;
  log('[AUTH] Starting fetchUserProfile', { uid, email });

  try {
    log('[AUTH] Querying Firestore for user profile', { collection: 'users', docId: uid });
    const userDoc = await USERS_COLLECTION.doc(uid).get();

    if (!userDoc.exists) {
      log('[AUTH] User document not found, creating new profile', { uid, email });
      const newUserProfile: UserProfile = { 
        uid, 
        email: email || '', 
        roles: {} // New users start with no roles
      };
      await USERS_COLLECTION.doc(uid).set(newUserProfile);
      req.userProfile = newUserProfile;
      log('[AUTH] New user profile created successfully', { uid });
    } else {
      req.userProfile = userDoc.data() as UserProfile;
      log('[AUTH] Successfully fetched user profile', { uid, roles: req.userProfile.roles });
    }
    next();
  } catch (e: any) {
    log('[AUTH] CRITICAL ERROR in fetchUserProfile', { uid, error: e.message, stack: e.stack });
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

// --- Provisioning Engine ---
async function provisionProject(projectId: string, displayName: string, orgId: string) {
    const orgDoc = await ORGS_COLLECTION.doc(orgId).get();
    if (!orgDoc.exists) {
        const err = new Error(`Organization with ID ${orgId} not found.`);
        (err as any).statusCode = 404;
        throw err;
    }
    const orgData = orgDoc.data()!;

    if (!orgData.githubTeamSlug) {
        throw new Error(`Organization ${orgId} is missing the githubTeamSlug.`);
    }

    await PROJECTS_COLLECTION.doc(projectId).set({
        displayName, orgId, state: 'starting', createdAt: new Date().toISOString()
    }, { merge: true });

    try {
        const githubRepoUrl = await GithubService.createGithubRepo(projectId, orgData.githubTeamSlug);
        
        log('provision.simulation.success', { projectId, githubRepoUrl });

        await PROJECTS_COLLECTION.doc(projectId).update({
            state: 'ready',
            githubRepoUrl,
        });

        return { projectId, state: 'ready' };

    } catch (error: any) {
        log('provision.error.fatal', { projectId, error: error.message });
        await PROJECTS_COLLECTION.doc(projectId).update({ state: 'failed', error: error.message });
        throw error;
    }
}

// --- Routes ---
router.get('/projects', requireAdminAuth, async (req: Request, res: Response) => {
    const snap = await PROJECTS_COLLECTION.orderBy('createdAt', 'desc').limit(100).get();
    const list = snap.docs.map(d => ({id: d.id, ...d.data()}));
    res.json(list);
});

router.post('/projects', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { orgId, projectId, displayName } = req.body;
        if (!orgId || !projectId || !displayName) {
            return res.status(400).json({ error: 'orgId, projectId, and displayName are required' });
        }
        const sanitizedId = String(projectId).toLowerCase().replace(/[^a-z0-9-]/g, '');

        // Check if project already exists
        const existingProject = await PROJECTS_COLLECTION.doc(sanitizedId).get();
        if (existingProject.exists) {
            return res.status(409).json({ error: `Project with ID '${sanitizedId}' already exists.` });
        }
        
        const result = await provisionProject(sanitizedId, displayName.trim(), orgId);
        res.status(201).json({ ok: true, ...result });
    } catch (e: any) {
        const statusCode = e.statusCode || 500;
        res.status(statusCode).json({ ok: false, error: e.message });
    }
});

export default router;
