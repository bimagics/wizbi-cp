import { Router, Request, Response } from 'express';
import { requireUser, log } from './tenants'; // Note we are importing from tenants

const router = Router();
const ALLOWED = (process.env.ALLOWED_ADMIN_EMAILS || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);

router.get('/me', requireUser, async (req: Request, res: Response) => {
  const u = (req as any).user as { email?: string; name?: string; uid?: string };
  const email = (u.email || '').toLowerCase();
  const isAdmin = !ALLOWED.length || ALLOWED.includes(email);
  log('me', { email, isAdmin });
  res.json({ email, isAdmin, name: u.name || null, uid: u.uid || null });
});

export default router;
