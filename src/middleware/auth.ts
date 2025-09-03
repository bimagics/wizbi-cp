// src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers['authorization'] || '';
  const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!token) {
    return res.status(401).json({ ok: false, error: 'missing-bearer' });
  }

  // Cloud Run כבר אימת OIDC כשהשירות פרטי; כאן רק “מעבירים הלאה”
  if (process.env.TRUST_CLOUD_RUN_IDENTITY === '1' || process.env.ALLOW_ANY_BEARER === '1') {
    return next();
  }

  // (אופציונלי) אימות Firebase ייכנס כאן בהמשך כשנחבר פרונט/אפליקציות.
  return next();
}
