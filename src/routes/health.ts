import { Router } from 'express';
import { db } from '../services/firebaseAdmin';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const rt = 'firestore-admin';
    await db().collection('__health').doc('__ping')
      .set({ ts: new Date().toISOString() }, { merge: true });
    res.json({ ok: true, ts: new Date().toISOString(), firestore: { ok: true, rt } });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || 'health-failed' });
  }
});

export default router;
