import { Router, type Express } from 'express';
import { getDb } from '../services/firebaseAdmin';

const router = Router();
const COL = 'orgs';

router.get('/', async (_req, res) => {
  try {
    const snap = await getDb().collection(COL).limit(50).get();
    const items = snap.docs.map((d: FirebaseFirestore.QueryDocumentSnapshot) => ({
      id: d.id,
      ...d.data(),
    }));
    res.json({ ok: true, items });
  } catch (e) {
    console.error('[orgs:list]', e);
    res.status(500).json({ ok: false, error: 'list-failed' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, phone } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, error: 'missing-name' });

    const doc = await getDb().collection(COL).add({
      name,
      phone,
      createdAt: new Date().toISOString(),
    });

    res.json({ ok: true, id: doc.id });
  } catch (e) {
    console.error('[orgs:create]', e);
    res.status(500).json({ ok: false, error: 'create-failed' });
  }
});

/** ייצוא בשם – תואם לייבוא הקיים ב־index.ts */
export function registerOrgRoutes(app: Express) {
  app.use('/orgs', router);
}

/** נשאיר גם ברירת־מחדל למקרה שמייבאים כ-router */
export default router;
