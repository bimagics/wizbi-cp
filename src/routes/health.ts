import { Router } from 'express';
import { getDb } from '../services/firebaseAdmin.js';

const r = Router();

r.get('/', async (_req, res) => {
  const status: any = { ok: true, ts: new Date().toISOString() };

  try {
    const db = await getDb(); // lazy init
    if (db) {
      // בדיקת קריאה פשוטה: לא כותבים כלום, רק לוקחים זמן שרת
      const rt = await db.recursiveDelete ? 'firestore-admin' : 'firestore';
      status.firestore = { ok: true, rt };
    } else {
      status.firestore = { ok: false, reason: 'no-project' };
    }
  } catch (e: any) {
    status.firestore = { ok: false, error: String(e?.message || e) };
  }

  res.json(status);
});

export default r;
