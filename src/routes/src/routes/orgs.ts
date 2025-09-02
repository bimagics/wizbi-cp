import { Router, Request, Response } from 'express';
import { db } from '../services/firebaseAdmin';

const router = Router();
const ORGS = 'orgs';

function ok(res: Response, data: any, code = 200) {
  return res.status(code).json({ ok: true, data });
}
function bad(res: Response, code = 400, msg = 'bad-request') {
  return res.status(code).json({ ok: false, error: msg });
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, phone, slug } = req.body || {};
    if (!name || typeof name !== 'string') return bad(res, 400, 'name-required');

    const now = new Date().toISOString();
    const ref = slug ? db().collection(ORGS).doc(slug) : db().collection(ORGS).doc();

    await ref.set(
      { name, phone: phone || null, createdAt: now, updatedAt: now, status: 'active' },
      { merge: true }
    );
    return ok(res, { id: ref.id });
  } catch (e: any) {
    console.error('[orgs:create]', e);
    return bad(res, 500, 'create-failed');
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit || '20'), 10), 100);
    const snap = await db().collection(ORGS).orderBy('createdAt', 'desc').limit(limit).get();
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return ok(res, { items });
  } catch (e: any) {
    console.error('[orgs:list]', e);
    return bad(res, 500, 'list-failed');
  }
});

router.get('/:orgId', async (req: Request, res: Response) => {
  try {
    const doc = await db().collection(ORGS).doc(req.params.orgId).get();
    if (!doc.exists) return bad(res, 404, 'org-not-found');
    return ok(res, { id: doc.id, ...doc.data() });
  } catch (e: any) {
    console.error('[orgs:get]', e);
    return bad(res, 500, 'get-failed');
  }
});

router.patch('/:orgId', async (req: Request, res: Response) => {
  try {
    const { name, phone, status } = req.body || {};
    const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (phone !== undefined) updates.phone = phone;
    if (status !== undefined) updates.status = status;
    await db().collection(ORGS).doc(req.params.orgId).set(updates, { merge: true });
    return ok(res, { id: req.params.orgId });
  } catch (e: any) {
    console.error('[orgs:update]', e);
    return bad(res, 500, 'update-failed');
  }
});

router.post('/:orgId/members', async (req: Request, res: Response) => {
  try {
    const { email, role } = req.body || {};
    if (!email) return bad(res, 400, 'email-required');

    const now = new Date().toISOString();
    await db().collection(ORGS).doc(req.params.orgId)
      .collection('orgMembers').doc(email).set({
        role: role || 'member',
        addedAt: now,
      }, { merge: true });

    await db().collection('users').doc(email).set({
      updatedAt: now,
      orgs: [req.params.orgId],
    }, { merge: true });

    return ok(res, { orgId: req.params.orgId, email });
  } catch (e: any) {
    console.error('[orgs:addMember]', e);
    return bad(res, 500, 'add-member-failed');
  }
});

export default router;
