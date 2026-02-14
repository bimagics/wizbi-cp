import { Router, Request, Response } from 'express';
import { getDb } from '../services/firebaseAdmin';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    await db.collection("_health").doc("ping").set({ ts: new Date().toISOString() }, { merge: true });
    return res.json({ ok: true, ts: new Date().toISOString(), firestore: { ok: true, rt: "firestore-admin" } });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: "health-failed", detail: e?.message });
  }
});

// Serve Firebase client config dynamically — replaces /__/firebase/init.js
router.get('/firebase-config', (_req: Request, res: Response) => {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCP_PROJECT_ID || '';
  const apiKey = process.env.FIREBASE_API_KEY || '';
  return res.json({
    projectId,
    apiKey,
    authDomain: `${projectId}.firebaseapp.com`,
    storageBucket: `${projectId}.firebasestorage.app`,
    messagingSenderId: process.env.GCP_CONTROL_PLANE_PROJECT_NUMBER || '',
    appId: process.env.FIREBASE_APP_ID || '',
  });
});

export default router;
