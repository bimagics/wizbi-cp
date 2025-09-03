import { Request, Response, NextFunction } from "express";
import { adminAuth } from "../services/firebaseAdmin";

/** בודק Firebase ID Token בכותר Authorization: Bearer <token> */
export async function requireFirebaseUser(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ ok: false, error: "missing-bearer" });

    const decoded = await adminAuth.verifyIdToken(token);
    (req as any).user = decoded;
    return next();
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: "invalid-token", detail: e?.message });
  }
}

/** מאפשר רק למיילים ברשימת ADMINS (מופרדת בפסיקים) */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const decoded = (req as any).user;
  const admins = (process.env.ADMINS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!decoded?.email || !admins.includes(decoded.email.toLowerCase())) {
    return res.status(403).json({ ok: false, error: "admin-only" });
  }
  return next();
}
