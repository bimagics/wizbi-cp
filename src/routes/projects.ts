import { Router, Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import { getDb } from '../services/firebaseAdmin';
import * as GcpService from '../services/gcp';
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

export function log(evt: string, meta: Record<string, any> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), severity: 'INFO', evt, ...meta }));
}

// --- Middleware (no changes) ---
async function verifyFirebaseToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  // ... same as before
}
async function fetchUserProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  // ... same as before
}
function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  // ... same as before
}
export const requireAuth = [verifyFirebaseToken, fetchUserProfile];
export const requireAdminAuth = [...requireAuth, requireSuperAdmin];

// --- Provisioning Engine ---
async function provisionProject(projectId: string, displayName: string, orgId: string) {
    const orgDoc = await ORGS_COLLECTION.doc(orgId).get();
    if (!orgDoc.exists) throw new Error(`Organization with ID ${orgId} not found.`);
    const orgData = orgDoc.data()!;

    // Ensure the org has the slug before proceeding
    if (!orgData.githubTeamSlug) {
        throw new Error(`Organization ${orgId} is missing the githubTeamSlug.`);
    }

    await PROJECTS_COLLECTION.doc(projectId).set({
        displayName, orgId, state: 'starting', createdAt: new Date().toISOString()
    }, { merge: true });

    try {
        // Here we would orchestrate all the steps
        // const gcpProjectId = await GcpService.createGcpProjectInFolder(projectId, displayName, orgData.gcpFolderId);
        // await GcpService.linkBilling(gcpProjectId);
        // await GcpService.enableApis(gcpProjectId);
        
        // --- שינוי קריטי כאן ---
        // העברת ה-slug במקום ה-ID
        const githubRepoUrl = await GithubService.createGithubRepo(projectId, orgData.githubTeamSlug);
        
        // For now, we simulate success
        log('provision.simulation.success', { projectId, githubRepoUrl });

        await PROJECTS_COLLECTION.doc(projectId).update({
            state: 'ready',
            // gcpProjectId,
            githubRepoUrl, // Save the repo URL
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
    // ... no changes
});

router.post('/projects', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { orgId, projectId, displayName } = req.body;
        if (!orgId || !projectId || !displayName) {
            return res.status(400).json({ error: 'orgId, projectId, and displayName are required' });
        }
        const sanitizedId = String(projectId).toLowerCase().replace(/[^a-z0-9-]/g, '');
        const result = await provisionProject(sanitizedId, displayName.trim(), orgId);
        res.status(201).json({ ok: true, ...result });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
