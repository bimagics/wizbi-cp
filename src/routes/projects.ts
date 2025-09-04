// src/routes/projects.ts
import { Router, Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import { google } from 'googleapis';
import { getDb } from '../services/firebaseAdmin';

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
const PROJECT_PREFIX = process.env.PROJECT_PREFIX || 'wizbi';

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
  if (!req.user) return res.status(401).json({ error: 'Authentication not performed' });

  try {
    const userDoc = await USERS_COLLECTION.doc(req.user.uid).get();
    if (!userDoc.exists) {
      const newUserProfile: UserProfile = { uid: req.user.uid, email: req.user.email || '', roles: {} };
      await USERS_COLLECTION.doc(req.user.uid).set(newUserProfile);
      req.userProfile = newUserProfile;
    } else {
      req.userProfile = userDoc.data() as UserProfile;
    }
    next();
  } catch(e: any) {
      log('auth.user_profile_fetch_failed', { uid: req.user.uid, error: e.message });
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

// --- GCP Provisioning Logic (Placeholder) ---
async function provisionProject(projectId: string, displayName: string, orgId: string) {
    log('provision.start', { projectId, displayName, orgId });

    // This is a placeholder for the full template-based provisioning.
    // For now, it just creates a record in Firestore.
    const fullProjectId = `${PROJECT_PREFIX}-${projectId}`;
    const docRef = PROJECTS_COLLECTION.doc(projectId);
    
    await docRef.set({
        projectId: fullProjectId,
        displayName,
        orgId,
        state: 'provisioning',
        createdAt: new Date().toISOString(),
    }, { merge: true });

    // TODO: Here we will call the full blueprint provisioning logic:
    // 1. Create GCP Project
    // 2. Link Billing
    // 3. Enable APIs
    // 4. Create GitHub Repo & CI/CD Trigger
    // etc.
    
    // For now, we'll just simulate completion.
    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate work
    
    await docRef.update({ state: 'ready' });
    log('provision.done', { projectId });

    return { projectId: fullProjectId, state: 'ready' };
}

// --- Routes ---
router.get('/projects', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
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
        const sanitizedProjectId = String(projectId).toLowerCase().replace(/[^a-z0-9-]/g, '');
        const result = await provisionProject(sanitizedProjectId, String(displayName).trim(), String(orgId));
        res.status(201).json({ ok: true, ...result });
    } catch (e: any) {
        log('projects.provision.error', { error: e.message, stack: e.stack });
        res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
