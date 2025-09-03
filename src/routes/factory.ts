import type { Express, Request, Response } from 'express';
import { getDb } from '../services/firebaseAdmin';

export function registerFactoryRoutes(app: Express) {
  // דוגמת בדיקת חיבור ל־DB (תוכל להרחיב לפי הצורך)
  app.get('/factory/ping', async (_req: Request, res: Response) => {
    try {
      // קריאת no-op ל־Firestore כדי לוודא אתחול
      await getDb().collection('_meta').limit(1).get().catch(() => null);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || 'factory-ping-failed' });
    }
  });
}

export default registerFactoryRoutes;
