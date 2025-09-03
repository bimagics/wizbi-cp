import { Router, Request, Response } from 'express';
import { getDb } from '../services/firebaseAdmin';

const router = Router();

// The path is now defined inside the router file itself for clarity
router.get('/factory/ping', async (_req: Request, res: Response) => {
  try {
    await getDb().collection('_meta').limit(1).get().catch(() => null);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || 'factory-ping-failed' });
  }
});

export default router;
