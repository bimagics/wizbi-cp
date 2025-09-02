import { Router, Request, Response } from 'express';

const router = Router();

function deny(res: Response, code = 403, msg = 'forbidden') {
  return res.status(code).json({ ok: false, error: msg });
}

// GET /whatsapp/webhook (Meta verification)
router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === expected) {
    return res.status(200).send(challenge);
  }
  return deny(res, 403, 'verify-token-mismatch');
});

// POST /whatsapp/webhook (ack + log)
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    res.status(200).send('EVENT_RECEIVED');
    console.log('[wa] incoming', JSON.stringify(req.body).slice(0, 4000));
  } catch (e: any) {
    console.error('[wa] error', e?.message || e);
  }
});

export default router;
