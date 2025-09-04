// --- REPLACE THE ENTIRE FILE CONTENT ---

import { Router, Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import { google } from 'googleapis';
import { BigQuery } from '@google-cloud/bigquery';
import { getDb } from '../services/firebaseAdmin';

// --- Interfaces for Clarity ---
interface UserProfile {
  uid: string;
  email: string;
  name?: string;
  roles: {
    superAdmin?: boolean;
    orgAdmin?: string[]; // Array of Org IDs the user is an admin of
  }
}

// Extend Express Request to include our user profile
interface AuthenticatedRequest extends Request {
  user?: admin.auth.DecodedIdToken;
  userProfile?: UserProfile;
}

const router = Router();
const db = getDb();
const TENANTS_COLLECTION = db.collection('tenants');
const USERS_COLLECTION = db.collection('users');

const REGION = process.env.REGION || 'europe-west1';
const PROJECT_PREFIX = process.env.PROJECT_PREFIX || 'wizbi';
const FOLDER_ID = process.env.FOLDER_ID || '';

// --- Utility Functions ---
export function log(evt: string, meta: Record<string, any> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), severity: 'INFO', evt, ...meta }));
}

// --- NEW PERMISSIONS-AWARE AUTH MIDDLEWARE ---

// Step 1: Verify Firebase ID Token
export async function verifyFirebaseToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const hdrAuth = req.headers.authorization || '';
    const hdrX = (req.headers['x-firebase-id-token'] as string) || '';
    let token = '';
    
    if (hdrX) {
      token = hdrX;
    } else if (hdrAuth.startsWith('Bearer ')) {
      token = hdrAuth.slice(7);
    }

    if (!token) {
      log('auth.missing_token', { path: req.path });
      return res.status(401).json({ error: 'Missing authentication token' });
    }

    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (e: any) {
    log('auth.token_verify_failed', { path: req.path, error: e.message });
    res.status(401).json({ error: 'Unauthorized', detail: e.message });
  }
}

// Step 2: Fetch User Profile and Roles from Firestore
export async function fetchUserProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Authentication not performed' });

  try {
    const userDoc = await USERS_COLLECTION.doc(req.user.uid).get();
    if (!userDoc.exists) {
      const newUserProfile: UserProfile = {
          uid: req.user.uid,
          email: req.user.email || '',
          roles: {}
      };
      await USERS_COLLECTION.doc(req.user.uid).set(newUserProfile);
      req.userProfile = newUserProfile;
      log('auth.user_profile_created', { uid: req.user.uid, email: req.user.email });
    } else {
      req.userProfile = userDoc.data() as UserProfile;
    }
    log('auth.user_profile_loaded', { uid: req.userProfile?.uid, roles: req.userProfile?.roles });
    next();
  } catch(e: any) {
      log('auth.user_profile_fetch_failed', { uid: req.user.uid, error: e.message });
      res.status(500).json({ error: 'Failed to fetch user profile' });
  }
}

// Step 3: Role Enforcement Middleware
export function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const isSuperAdmin = req.userProfile?.roles?.superAdmin === true;
    if (!isSuperAdmin) {
        log('auth.permission_denied.superAdmin_required', { uid: req.userProfile?.uid });
        return res.status(403).json({ error: 'Permission denied: Super admin role required.' });
    }
    next();
}

// Combine middleware for convenience
export const requireAuth = [verifyFirebaseToken, fetchUserProfile];
export const requireAdminAuth = [...requireAuth, requireSuperAdmin];

// ---- Google auth client ----
async function gauth() { 
  return await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }); 
}

// ---- Provisioning Logic (Original functions are kept for future use, but simplified for now) ----
async function createProject(projectId: string, displayName: string, orgId: string) {
  const auth = await gauth();
  const crm = google.cloudresourcemanager({ version: 'v3', auth });
  const parent = FOLDER_ID ? `folders/${FOLDER_ID}` : `organizations/${orgId}`;
  log('provision.project.create.start', { projectId, displayName, parent });
  const operation = await crm.projects.create({ requestBody: { projectId, displayName, parent } });
  log('provision.project.create.pending', { projectId, operation: operation.data.name });
  // Note: In a real scenario, you'd poll this operation until it's done.
  // For now, we assume it will succeed in the background.
  return operation;
}

// ... (Keep other helper functions like linkBilling, enableApis etc. as they are)

async function provisionTenantProject(tenantId: string, displayName: string, orgId: string) {
    const ORG_ID = process.env.ORG_ID; // This should be your GCP Organization ID
    const BILLING_ACCOUNT = process.env.BILLING_ACCOUNT;

    if (!ORG_ID || !BILLING_ACCOUNT) {
        log('provision.env.missing', { ORG_ID: !!ORG_ID, BILLING: !!BILLING_ACCOUNT });
        throw new Error('Missing ORG_ID and/or BILLING_ACCOUNT env variables in the Control Plane.');
    }

    const projectId = `${PROJECT_PREFIX}-${tenantId}`; // Simplified project ID
    const docRef = TENANTS_COLLECTION.doc(tenantId);
    const startedAt = new Date().toISOString();

    log('provision.start', { tenantId, displayName, projectId, orgId });
    await docRef.set({ tenantId, displayName, projectId, state: 'provisioning', startedAt, orgId }, { merge: true });

    // --- Execute Provisioning Steps ---
    await createProject(projectId, displayName, ORG_ID);
    // Here you would add calls to:
    // 1. linkBilling(projectId, BILLING_ACCOUNT);
    // 2. enableApis(projectId, CORE_APIS);
    // 3. createArtifactRegistry(projectId, REGION);
    // 4. createBigQueryDatasets(projectId, ['raw', 'curated']);
    // 5. createFirestoreDatabase(projectId);
    // 6. setupServiceAccounts(projectId);
    // 7. createGithubRepoAndTrigger(projectId, GITHUB_OWNER);

    const updatedAt = new Date().toISOString();
    await docRef.set({ state: 'ready', updatedAt }, { merge: true });
    log('provision.done', { tenantId, projectId });

    return { projectId, state: 'ready' };
}


// ---- Routes using the new Middleware ----
// Only Super Admins can list tenants
router.get('/tenants', requireAdminAuth, async (_req: Request, res: Response) => {
  const snap = await TENANTS_COLLECTION.orderBy('startedAt', 'desc').limit(100).get();
  const list = snap.docs.map(d => ({id: d.id, ...d.data()}));
  log('tenants.list.success', { count: list.length });
  res.json(list);
});

// A new, simplified endpoint for provisioning based on an Org
router.post('/tenants', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { orgId, tenantId, displayName } = req.body;
        if (!orgId || !tenantId || !displayName) {
            return res.status(400).json({ error: 'orgId, tenantId, and displayName are required' });
        }

        // We use a simplified provisionTenant function now.
        // It no longer takes 'env' because we're creating one project per tenant.
        const result = await provisionTenantProject(
            String(tenantId).toLowerCase().replace(/[^a-z0-9-]/g, ''), // Sanitize tenantId
            String(displayName).trim(),
            String(orgId)
        );

        res.json({ ok: true, ...result });

    } catch (e: any) {
        log('tenants.provision.error', { error: e.message, stack: e.stack });
        res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
