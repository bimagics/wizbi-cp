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

// Step 1: Verify Firebase ID Token (Same as before)
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
    req.user = decodedToken; // Attach decoded token to request
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
      // Optional: Auto-create a user profile on first login with no roles
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

// ---- Google auth client (No changes here) ----
async function gauth() { 
  return await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }); 
}

// ---- Provisioning Logic (No changes here, just logging improvements) ----
async function createProject(projectId:string, displayName:string, orgId:string){
  const auth=await gauth(); const crm=google.cloudresourcemanager({version:'v3',auth});
  const parent = FOLDER_ID ? { type:'folder', id:FOLDER_ID.replace('folders/','') } : { type:'organization', id:orgId };
  log('provision.project.create.start',{projectId,displayName,parent});
  await crm.projects.create({ requestBody:{ projectId, displayName, parent } } as any);
  log('provision.project.create.done',{projectId});
}
// ... other provisioning functions like linkBilling, enableApis etc. remain the same.
// For brevity, they are omitted here, but should be kept in your file.
// Make sure to replace just the top part of the file and keep the provisioning logic.

const CORE_APIS = [
  'run.googleapis.com','iam.googleapis.com','iamcredentials.googleapis.com',
  'artifactregistry.googleapis.com','secretmanager.googleapis.com',
  'bigquery.googleapis.com','bigquerystorage.googleapis.com',
  'firestore.googleapis.com','logging.googleapis.com','monitoring.googleapis.com',
  'cloudbuild.googleapis.com','serviceusage.googleapis.com','sts.googleapis.com'
];

async function provisionTenant(tenantId:string, displayName:string, env:'qa'|'prod'){
  const ORG_ID=process.env.ORG_ID, BILLING=process.env.BILLING_ACCOUNT;
  if(!ORG_ID||!BILLING){ log('provision.env.missing',{ORG_ID:!!ORG_ID,BILLING:!!BILLING}); throw new Error('missing ORG_ID and/or BILLING_ACCOUNT env'); }
  const projectId=`${PROJECT_PREFIX}-${tenantId}-${env}`;
  const docRef=TENANTS_COLLECTION.doc(`${tenantId}-${env}`); const startedAt=new Date().toISOString();
  log('provision.start',{tenantId,displayName,env,projectId});
  await docRef.set({tenantId,displayName,env,projectId,state:'provisioning',startedAt},{merge:true});
  await createProject(projectId,`${displayName} (${env.toUpperCase()})`,ORG_ID);
  // ... The rest of this function remains unchanged.
  log('provision.done',{tenantId,env,projectId});
  return { projectId, state:'ready' };
}


// ---- Routes using the new Middleware ----
// Only Super Admins can list and provision tenants
router.get('/tenants', requireAdminAuth, async (_req, res) => {
  const snap = await TENANTS_COLLECTION.orderBy('startedAt', 'desc').limit(100).get();
  const list = snap.docs.map(d => ({id: d.id, ...d.data()}));
  log('tenants.list.success', { count: list.length });
  res.json(list);
});

router.post('/tenants/provision', requireAdminAuth, async (req,res)=>{
  try{
    const { tenantId, displayName, env } = req.body || {};
    if(!tenantId || !env) return res.status(400).json({error:'tenantId and env are required'});
    if(!['qa','prod'].includes(env)) return res.status(400).json({error:'env must be qa or prod'});
    const result=await provisionTenant(String(tenantId).toLowerCase(), String(displayName||tenantId).trim(), env);
    res.json({ ok:true, ...result });
  }catch(e:any){ 
    log('tenants.provision.error',{error:e.message}); 
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

export default router;
