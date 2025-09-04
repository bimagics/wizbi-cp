// --- REPLACE THE ENTIRE FILE CONTENT ---

import { Router, Request, Response } from 'express';
import { getDb } from '../services/firebaseAdmin';
// We now require Super Admin for ALL org operations
import { requireAdminAuth } from './projects';

const router = Router();
const ORGS_COLLECTION = 'orgs';

// Only a Super Admin can list orgs
router.get('/orgs', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const snap = await getDb().collection(ORGS_COLLECTION).orderBy('name').get();
    const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ ok: true, items });
  } catch (e: any) {
    console.error('[orgs:list]', e.message);
    res.status(500).json({ ok: false, error: 'list-failed' });
  }
});

// Only a Super Admin can create a new org
router.post('/orgs', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { name, phone } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, error: 'missing-name' });

    const docRef = await getDb().collection(ORGS_COLLECTION).add({
      name,
      phone,
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({ ok: true, id: docRef.id });
  } catch (e: any) {
    console.error('[orgs:create]', e.message);
    res.status(500).json({ ok: false, error: 'create-failed' });
  }
});

export default router;
