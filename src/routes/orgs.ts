import { Express, Request, Response } from "express";
import { getDb } from "../services/firebaseAdmin";

export function registerOrgRoutes(app: Express) {
  const db = getDb();

  // יצירת ארגון
  app.post("/orgs", async (req: Request, res: Response) => {
    try {
      const { name, phone } = req.body || {};
      if (!name) return res.status(400).json({ ok: false, error: "name is required" });

      const doc = {
        name,
        phone: phone || null,
        createdAt: new Date().toISOString(),
        status: "active",
      };

      const ref = await db.collection("orgs").add(doc);
      return res.json({ ok: true, id: ref.id, org: doc });
    } catch (err: any) {
      console.error("POST /orgs error:", err);
      return res.status(500).json({ ok: false, error: err?.message || "internal_error" });
    }
  });

  // רשימת ארגונים
  app.get("/orgs", async (_req: Request, res: Response) => {
    try {
      const snap = await db.collection("orgs").orderBy("createdAt", "desc").limit(50).get();
      const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      return res.json({ ok: true, items });
    } catch (err: any) {
      console.error("GET /orgs error:", err);
      return res.status(500).json({ ok: false, error: err?.message || "internal_error" });
    }
  });
}
