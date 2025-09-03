import { Router } from 'express';
import { db } from '../services/firebaseAdmin';

const router = Router();

router.get('/health', async (_req, res) => {
  try {
    const now = new Date().toISOString();
    // כתיבת ping קטנה כדי לוודא הרשאות ל-Firestore
    await db.collection('_health').doc('ping').set({ ts: now }, { merge: true });

    res.json({
      ok: true,
      ts: now,
      firestore: { ok: true, rt: 'firestore-admin' },
    });
  } catch (err) {
    console.error('health failed:', err);
    res.status(500).json({ ok: false, error: 'health-failed' });
  }
});

export default router;
