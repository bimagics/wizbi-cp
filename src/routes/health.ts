import { Router } from 'express';
import { getDb } from '../services/firebaseAdmin';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    // אתחול "לייט" — יוצר מופע אם צריך
    getDb();
    res.json({
      ok: true,
      ts: new Date().toISOString(),
      firestore: { ok: true, rt: 'firestore-admin' },
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: 'health-failed', detail: e?.message });
  }
});

export default router;
