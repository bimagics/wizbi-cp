import { Router, Request, Response } from 'express';
import { db } from '../services/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

const router = Router();
const ORGS = 'orgs';

function resp(res: Response, data: any, code = 200) {
  return res.status(code).json({ ok: true, data });
}
function bad(res: Response, code = 400, msg = 'bad-request') {
  return res.status(code).json({ ok: false, error: msg });
}

// POST /orgs  { name, phone? , slug? }
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, phone, slug } = req.body || {};
    if (!name || typeof name !== 'string') return bad(res, 400, 'name-required');

    const now = new Date().toISOString();
    const docRef = slug
      ? db().collection(ORGS).doc(slug)
      : db().collection(ORGS).doc();

    await docRef.set({
      name,
      phone: phone || null,
      createdAt: now,
      updatedAt: now,
      status: 'active',
    }, { merge: true });

    return resp(res, { id: docRef.id });
  } catch (e: any) {
    console.error('[orgs:create]', e);
    return bad(res, 500, 'create-failed');
  }
});

// GET /orgs?limit=20&cursor=<docId>
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit || '20'), 10), 100);
    const cursor = String(req.query.cursor || '');
    let q = db().collection(ORGS).orderBy('createdAt', 'desc').limit(limit);

    if (cursor) {
      const cdoc = await db().collection(ORGS).doc(cursor).get();
      if (cdoc.exists) q = q.startAfter(cdoc.get('createdAt'));
    }

    const snap = await q.get();
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return resp(res, { items });
  } catch (e: any) {
    console.error('[orgs:list]', e);
    return bad(res, 500, 'list-failed');
  }
});

// GET /orgs/:orgId
router.get('/:orgId', async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const doc = await db().collection(ORGS).doc(orgId).get();
    if (!doc.exists) return bad(res, 404, 'org-not-found');
    return resp(res, { id: doc.id, ...doc.data() });
  } catch (e: any) {
    console.error('[orgs:get]', e);
    return bad(res, 500, 'get-failed');
  }
});

// PATCH /orgs/:orgId { name?, phone?, status? }
router.patch('/:orgId', async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const { name, phone, status } = req.body || {};
    const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (phone !== undefined) updates.phone = phone;
    if (status !== undefined) updates.status = status;
    await db().collection(ORGS).doc(orgId).set(updates, { merge: true });
    return resp(res, { id: orgId });
  } catch (e: any) {
    console.error('[orgs:update]', e);
    return bad(res, 500, 'update-failed');
  }
});

// POST /orgs/:orgId/members { email, role? }
router.post('/:orgId/members', async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const { email, role } = req.body || {};
    if (!email) return bad(res, 400, 'email-required');

    const now = new Date().toISOString();
    const memRef = db().collection(ORGS).doc(orgId).collection('orgMembers').doc(email);

    await memRef.set({
      role: role || 'member',
      addedAt: now,
    }, { merge: true });

    // אפשרות: לשמור קישור גם ב- users/{email}/orgs
    await db().collection('users').doc(email).set({
      updatedAt: now,
      orgs: FieldValue.arrayUnion(orgId),
    }, { merge: true });

    return resp(res, { orgId, email });
  } catch (e: any) {
    console.error('[orgs:addMember]', e);
    return bad(res, 500, 'add-member-failed');
  }
});

export default router;
