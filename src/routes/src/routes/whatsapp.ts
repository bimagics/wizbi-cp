import { Router, Request, Response } from 'express';

const router = Router();

function bad(res: Response, code = 403, msg = 'forbidden') {
  return res.status(code).json({ ok: false, error: msg });
}

// GET /whatsapp/webhook (Verify)
router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === 'subscribe' && token === expected) {
    return res.status(200).send(challenge);
  }
  return bad(res, 403, 'verify-token-mismatch');
});

// POST /whatsapp/webhook (ACK + log)
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    // Acknowledge immediately (Meta expects 200 fast)
    res.status(200).send('EVENT_RECEIVED');

    // Minimal logging (safe)
    const body = req.body;
    console.log('[wa] incoming', JSON.stringify(body).slice(0, 4000));

    // כאן בעתיד: שליפת טקסט/מספר שולח, ניתוב לאנליסט וכו׳.
  } catch (e: any) {
    console.error('[wa] error', e?.message || e);
  }
});

export default router;
