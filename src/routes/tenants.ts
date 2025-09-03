// src/routes/tenants.ts
import { Router, Request, Response } from 'express';
import admin from 'firebase-admin';
import { google } from 'googleapis';
import { BigQuery } from '@google-cloud/bigquery';
import { getDb } from '../services/firebaseAdmin';

const router = Router();

const db = getDb();
const TENANTS = db.collection('tenants');

const REGION = process.env.REGION || 'europe-west1';
const PROJECT_PREFIX = process.env.PROJECT_PREFIX || 'wizbi';
const FOLDER_ID = process.env.FOLDER_ID || '';
const ALLOWED = (process.env.ALLOWED_ADMIN_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function log(evt: string, meta: Record<string, any> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), evt, ...meta }));
}

// ===== Auth =====
// קורא קודם X-Firebase-ID-Token (מהדפדפן), ואם אין – Authorization: Bearer
async function requireUser(req: Request, res: Response, next: Function) {
  try {
    const hdrAuth = req.headers.authorization || '';
    const hdrX = (req.headers['x-firebase-id-token'] as string) || '';
    let token = ''; let via: 'x-header' | 'auth-bearer' | 'none' = 'none';
    if (hdrX) { token = hdrX; via = 'x-header'; }
    else if (hdrAuth.startsWith('Bearer ')) { token = hdrAuth.substring(7); via = 'auth-bearer'; }

    if (!token) {
      log('auth.missing_token', { path: req.path });
      return res.status(401).json({ error: 'missing token' });
    }
    const decoded = await admin.auth().verifyIdToken(token);
    (req as any).user = decoded;
    log('auth.ok', { via, uid: decoded.uid, email: decoded.email });
    next();
  } catch (e: any) {
    log('auth.verify_failed', { path: req.path, error: String(e) });
    res.status(401).json({ error: 'unauthorized', detail: String(e) });
  }
}

function requireAdmin(req: Request, res: Response, next: Function) {
  const user = (req as any).user as { email?: string };
  const email = (user?.email || '').toLowerCase();
  if (!email) { log('auth.no_email'); return res.status(403).json({ error: 'no-email' }); }
  if (ALLOWED.length && !ALLOWED.includes(email)) { log('auth.not_admin', { email }); return res.status(403).json({ error: 'not-admin' }); }
  next();
}

async function gauth() {
  return await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
}

async function waitProjectActive(crm: any, projectId: string, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs; const name = `projects/${projectId}`;
  for (;;) {
    try { const { data } = await crm.projects.get({ name }); if (data?.state === 'ACTIVE') return; } catch {}
    if (Date.now() > deadline) throw new Error('timeout waiting for project ACTIVE');
    await new Promise(r => setTimeout(r, 3000));
  }
}

async function createProject(projectId: string, displayName: string, orgId: string) {
  const auth = await gauth();
  const crm = google.cloudresourcemanager({ version: 'v3', auth });
  const parent = FOLDER_ID ? { type: 'folder', id: FOLDER_ID.replace('folders/', '') } : { type: 'organization', id: orgId };
  log('provision.project.create.start', { projectId, displayName, parent });
  await crm.projects.create({ requestBody: { projectId, displayName, parent } } as any);
  await waitProjectActive(crm, projectId);
  log('provision.project.create.done', { projectId });
}

async function linkBilling(projectId: string, billingAccount: string) {
  const auth = await gauth();
  const billing = google.cloudbilling({ version: 'v1', auth });
  log('provision.billing.link.start', { projectId, billingAccount });
  await billing.projects.updateBillingInfo({ name: `projects/${projectId}`, requestBody: { billingAccountName: `billingAccounts/${billingAccount}` } });
  log('provision.billing.link.done', { projectId });
}

async function enableApis(projectId: string, services: string[]) {
  const auth = await gauth();
  const su = google.serviceusage({ version: 'v1', auth });
  const parent = `projects/${projectId}`;
  for (let i = 0; i < services.length; i += 20) {
    const list = services.slice(i, i + 20);
    log('provision.apis.enable.batch.start', { projectId, services: list });
    await su.services.batchEnable({ parent, requestBody: { serviceIds: list } });
    log('provision.apis.enable.batch.done', { projectId, count: list.length });
  }
}

async function createArtifactRegistry(projectId: string, region: string) {
  const auth = await gauth();
  const ar = google.artifactregistry({ version: 'v1', auth });
  const parent = `projects/${projectId}/locations/${region}`;
  try {
    log('provision.ar.create.start', { projectId, region });
    await ar.projects.locations.repositories.create({ parent, repositoryId: 'images', requestBody: { format: 'DOCKER', description: 'Tenant container images' } });
    log('provision.ar.create.done', { projectId });
  } catch (e: any) {
    const s = String(e);
    if (!s.includes('ALREADY_EXISTS')) { log('provision.ar.create.error', { projectId, error: s }); throw e; }
    log('provision.ar.create.already_exists', { projectId });
  }
  return `${region}-docker.pkg.dev/${projectId}/images`;
}

async function createBigQueryDatasets(projectId: string, datasets: string[], location = 'EU') {
  const bq = new BigQuery({ projectId });
  for (const ds of datasets) {
    try {
      log('provision.bq.dataset.create.start', { projectId, dataset: ds, location });
      await bq.createDataset(ds, { location });
      log('provision.bq.dataset.create.done', { projectId, dataset: ds });
    } catch (e: any) {
      const s = String(e);
      if (!s.includes('Already Exists')) { log('provision.bq.dataset.create.error', { projectId, dataset: ds, error: s }); throw e; }
      log('provision.bq.dataset.create.already_exists', { projectId, dataset: ds });
    }
  }
}

async function createFirestoreDatabase(projectId: string, locationId = 'europe-west1') {
  const auth = await gauth();
  const fs = google.firestore('v1');
  try {
    log('provision.firestore.create.start', { projectId, locationId });
    await fs.projects.databases.create({ parent: `projects/${projectId}`, requestBody: { database: { type: 'FIRESTORE_NATIVE', locationId }, databaseId: '(default)' }, auth } as any);
    log('provision.firestore.create.done', { projectId });
  } catch (e: any) {
    const s = String(e);
    if (!(s.includes('ALREADY_EXISTS') || s.includes('already exists'))) { log('provision.firestore.create.error', { projectId, error: s }); throw e; }
    log('provision.firestore.create.already_exists', { projectId });
  }
}

const CORE_APIS = [
  'run.googleapis.com','iam.googleapis.com','iamcredentials.googleapis.com',
  'artifactregistry.googleapis.com','secretmanager.googleapis.com',
  'bigquery.googleapis.com','bigquerystorage.googleapis.com',
  'firestore.googleapis.com','logging.googleapis.com','monitoring.googleapis.com',
  'cloudbuild.googleapis.com','serviceusage.googleapis.com','sts.googleapis.com'
];

async function provisionTenant(tenantId: string, displayName: string, env: 'qa' | 'prod') {
  const ORG_ID = process.env.ORG_ID;
  const BILLING = process.env.BILLING_ACCOUNT;
  if (!ORG_ID || !BILLING) { log('provision.env.missing', { ORG_ID: !!ORG_ID, BILLING: !!BILLING }); throw new Error('missing ORG_ID and/or BILLING_ACCOUNT env'); }

  const projectId = `${PROJECT_PREFIX}-${tenantId}-${env}`;
  const docRef = TENANTS.doc(`${tenantId}-${env}`);
  const startedAt = new Date().toISOString();

  log('provision.start', { tenantId, displayName, env, projectId });
  await docRef.set({ tenantId, displayName, env, projectId, state: 'provisioning', startedAt }, { merge: true });

  await createProject(projectId, `${displayName} (${env.toUpperCase()})`, ORG_ID);
  await linkBilling(projectId, BILLING);
  await enableApis(projectId, CORE_APIS);
  const ar = await createArtifactRegistry(projectId, REGION);
  await createBigQueryDatasets(projectId, ['raw', 'curated'], 'EU');
  await createFirestoreDatabase(projectId, 'europe-west1');

  const updatedAt = new Date().toISOString();
  await docRef.set({ projectId, artifactRegistry: ar, bigquery: { datasets: ['raw','curated'], location: 'EU' }, region: REGION, state: 'ready', updatedAt }, { merge: true });

  log('provision.done', { tenantId, env, projectId });
  return { projectId, artifactRegistry: ar, bigquery: { datasets: ['raw','curated'], location:'EU' }, region: REGION, state:'ready' };
}

// ===== Routes =====
router.get('/me', requireUser, async (req, res) => {
  const u = (req as any).user as { email?: string, name?: string, uid?: string };
  const email = (u.email || '').toLowerCase();
  const isAdmin = !ALLOWED.length || ALLOWED.includes(email);
  log('me', { email, isAdmin });
  res.json({ email, isAdmin, name: u.name || null, uid: u.uid || null });
});

router.get('/tenants', requireUser, requireAdmin, async (_req, res) => {
  const snap = await TENANTS.orderBy('startedAt','desc').limit(100).get();
  const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  log('tenants.list', { count: list.length });
  res.json(list);
});

router.post('/tenants/provision', requireUser, requireAdmin, async (req, res) => {
  try {
    const { tenantId, displayName, env } = req.body || {};
    if (!tenantId || !env) { log('tenants.provision.bad_request', { tenantId: !!tenantId, env: !!env }); return res.status(400).json({ error: 'tenantId and env are required' }); }
    if (!['qa','prod'].includes(env)) { log('tenants.provision.bad_env', { env }); return res.status(400).json({ error: 'env must be qa|prod' }); }
    const result = await provisionTenant(String(tenantId).toLowerCase(), String(displayName || tenantId).trim(), env);
    res.json({ ok: true, ...result });
  } catch (e: any) {
    log('tenants.provision.error', { error: String(e) });
    res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;
