import { Router, Request, Response } from 'express';
import admin from 'firebase-admin';
import { google } from 'googleapis';
import { BigQuery } from '@google-cloud/bigquery';

const router = Router();

// ===== Env =====
const ORG_ID = process.env.ORG_ID!;
const BILLING = process.env.BILLING_ACCOUNT!;
const REGION = process.env.REGION || 'europe-west1';
const PROJECT_PREFIX = process.env.PROJECT_PREFIX || 'wizbi';
const FOLDER_ID = process.env.FOLDER_ID || '';
const ALLOWED = (process.env.ALLOWED_ADMIN_EMAILS || '')
  .split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);

// ===== Auth (Firebase ID token) =====
async function requireUser(req: Request, res: Response, next: Function){
  try{
    const hdr = req.headers.authorization || '';
    if(!hdr.startsWith('Bearer ')) return res.status(401).json({error:'missing token'});
    const idToken = hdr.substring('Bearer '.length);
    const decoded = await admin.auth().verifyIdToken(idToken);
    (req as any).user = decoded;
    next();
  }catch(e:any){ res.status(401).json({error:'unauthorized', detail: String(e)}); }
}

function requireAdmin(req: Request, res: Response, next: Function){
  const user = (req as any).user as {email?:string};
  const email = (user?.email||'').toLowerCase();
  if(!email) return res.status(403).json({error:'no-email'});
  if(ALLOWED.length && !ALLOWED.includes(email)) return res.status(403).json({error:'not-admin'});
  next();
}

// ===== Firestore =====
const db = admin.firestore();
const TENANTS = db.collection('tenants');

// ===== Google Auth client =====
async function gauth(){
  return await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
}

// ===== Helpers =====
async function waitProjectActive(crm:any, projectId:string, timeoutMs=180000){
  const deadline = Date.now() + timeoutMs;
  const name = `projects/${projectId}`;
  for(;;){
    try{
      const { data } = await crm.projects.get({ name });
      if(data?.state === 'ACTIVE') return;
    }catch{/* ignore */}
    if(Date.now()>deadline) throw new Error('timeout waiting for project ACTIVE');
    await new Promise(r=>setTimeout(r, 3000));
  }
}

async function createProject(projectId:string, displayName:string){
  const auth = await gauth();
  const crm = google.cloudresourcemanager({version:'v3', auth});
  const parent = FOLDER_ID ? { type:'folder', id: FOLDER_ID.replace('folders/','') } : { type:'organization', id: ORG_ID };
  const req = { requestBody: { projectId, displayName, parent } as any };
  await crm.projects.create(req as any);
  await waitProjectActive(crm, projectId);
}

async function linkBilling(projectId:string){
  const auth = await gauth();
  const billing = google.cloudbilling({version:'v1', auth});
  await billing.projects.updateBillingInfo({
    name: `projects/${projectId}`,
    requestBody: { billingAccountName: `billingAccounts/${BILLING}` }
  });
}

async function enableApis(projectId:string, services:string[]){
  const auth = await gauth();
  const su = google.serviceusage({version:'v1', auth});
  const parent = `projects/${projectId}`;
  const chunks: string[][] = [];
  for (let i=0;i<services.length;i+=20) chunks.push(services.slice(i,i+20));
  for(const list of chunks){
    await su.services.batchEnable({ parent, requestBody: { serviceIds: list } });
  }
}

async function createArtifactRegistry(projectId:string, region:string){
  const auth = await gauth();
  const ar = google.artifactregistry({version:'v1', auth});
  const parent = `projects/${projectId}/locations/${region}`;
  try{
    await ar.projects.locations.repositories.create({
      parent, repositoryId: 'images',
      requestBody: { format:'DOCKER', description:'Tenant container images' }
    });
  }catch(e:any){ if(!String(e).includes('ALREADY_EXISTS')) throw e; }
  return `${region}-docker.pkg.dev/${projectId}/images`;
}

async function createBigQueryDatasets(projectId:string, datasets:string[], location='EU'){
  const bq = new BigQuery({ projectId });
  for(const ds of datasets){
    try{ await bq.createDataset(ds, { location }); }
    catch(e:any){ if(!String(e).includes('Already Exists')) throw e; }
  }
}

async function createFirestoreDatabase(projectId:string, locationId='europe-west1'){
  const auth = await gauth();
  const fs = google.firestore('v1');
  try{
    await fs.projects.databases.create({
      parent: `projects/${projectId}`,
      requestBody: { database: { type:'FIRESTORE_NATIVE', locationId }, databaseId: '(default)' },
      auth
    } as any);
  }catch(e:any){
    const s = String(e);
    if(!(s.includes('ALREADY_EXISTS') || s.includes('already exists'))) throw e;
  }
}

const CORE_APIS = [
  'run.googleapis.com',
  'iam.googleapis.com',
  'iamcredentials.googleapis.com',
  'artifactregistry.googleapis.com',
  'secretmanager.googleapis.com',
  'bigquery.googleapis.com',
  'bigquerystorage.googleapis.com',
  'firestore.googleapis.com',
  'logging.googleapis.com',
  'monitoring.googleapis.com',
  'cloudbuild.googleapis.com',
  'serviceusage.googleapis.com',
  'sts.googleapis.com',
];

async function provisionTenant(tenantId:string, displayName:string, env:'qa'|'prod'){
  const projectId = `${PROJECT_PREFIX}-${tenantId}-${env}`;
  const docRef = TENANTS.doc(`${tenantId}-${env}`);
  const startedAt = new Date().toISOString();

  await docRef.set({ tenantId, displayName, env, projectId, state:'provisioning', startedAt }, { merge:true });

  await createProject(projectId, `${displayName} (${env.toUpperCase()})`);
  await linkBilling(projectId);
  await enableApis(projectId, CORE_APIS);
  const ar = await createArtifactRegistry(projectId, REGION);
  await createBigQueryDatasets(projectId, ['raw','curated'], 'EU');
  await createFirestoreDatabase(projectId, 'europe-west1');

  const updatedAt = new Date().toISOString();
  await docRef.set({
    projectId, artifactRegistry: ar,
    bigquery: { datasets: ['raw','curated'], location: 'EU' },
    region: REGION, state:'ready', updatedAt
  }, { merge:true });

  return { projectId, artifactRegistry: ar, bigquery: { datasets: ['raw','curated'], location:'EU' }, region: REGION, state:'ready' };
}

// ===== Routes =====
router.get('/me', requireUser, async (req, res)=>{
  const u = (req as any).user as { email?: string, name?: string, uid?: string };
  const email = (u.email||'').toLowerCase();
  const isAdmin = !ALLOWED.length || ALLOWED.includes(email);
  res.json({ email, isAdmin, name: u.name||null, uid: u.uid||null });
});

router.get('/tenants', requireUser, requireAdmin, async (_req, res)=>{
  const snap = await TENANTS.orderBy('startedAt','desc').limit(100).get();
  res.json(snap.docs.map(d=>({ id:d.id, ...d.data() })));
});

router.post('/tenants/provision', requireUser, requireAdmin, async (req, res)=>{
  try{
    const { tenantId, displayName, env } = req.body || {};
    if(!tenantId || !env) return res.status(400).json({ error:'tenantId and env are required' });
    if(!['qa','prod'].includes(env)) return res.status(400).json({ error:'env must be qa|prod' });

    const result = await provisionTenant(String(tenantId).toLowerCase(), String(displayName||tenantId).trim(), env);
    res.json({ ok:true, ...result });
  }catch(e:any){
    console.error('Provision error:', e);
    res.status(500).json({ ok:false, error:String(e) });
  }
});

export default router;
