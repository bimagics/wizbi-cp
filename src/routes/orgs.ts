import { Express, Request, Response } from "express";
import { getDb } from "../services/firebaseAdmin";
import { requireFirebaseUser } from "../middleware/auth";

export function registerOrgRoutes(app: Express) {
  const db = getDb();

  // הגנות: כל ה-/orgs דורשים משתמש מחובר
  app.post("/orgs", requireFirebaseUser, async (req: Request, res: Response) => {
    try {
      const { name, phone } = req.body || {};
      if (!name) return res.status(400).json({ ok: false, error: "name-required" });

      const now = new Date().toISOString();
      const doc = {
        name, phone: phone || null,
        createdAt: now, updatedAt: now,
        ownerUid: (req as any).user?.uid || null,
        status: "active",
      };

      const ref = await db.collection("orgs").add(doc);
      return res.json({ ok: true, id: ref.id, org: doc });
    } catch (err: any) {
      console.error("POST /orgs error:", err);
      return res.status(500).json({ ok: false, error: "create-failed", detail: err?.message });
    }
  });

  app.get("/orgs", requireFirebaseUser, async (_req: Request, res: Response) => {
    try {
      const snap = await db.collection("orgs").orderBy("createdAt", "desc").limit(100).get();
      const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      return res.json({ ok: true, items });
    } catch (err: any) {
      console.error("GET /orgs error:", err);
      return res.status(500).json({ ok: false, error: "list-failed", detail: err?.message });
    }
  });
}
