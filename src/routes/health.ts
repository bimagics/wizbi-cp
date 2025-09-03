import { Router, Request, Response } from 'express';
import { getDb } from '../services/firebaseAdmin';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    await db.collection("_health").doc("ping").set({ ts: new Date().toISOString() }, { merge: true });
    return res.json({ ok: true, ts: new Date().toISOString(), firestore: { ok: true, rt: "firestore-admin" }});
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: "health-failed", detail: e?.message });
  }
});

export default router;
