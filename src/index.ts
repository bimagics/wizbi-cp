import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { getDb } from "./services/firebaseAdmin";
import { registerOrgRoutes } from "./routes/orgs";
import { registerFactoryRoutes } from "./routes/factory";
// אופציונלי: רוטים לווצאפ – נרשמים רק אם מופעל
import { registerWhatsappRoutes } from "./routes/whatsapp";

const app = express();
const port = process.env.PORT || 8080;
const WHATSAPP_ENABLED = (process.env.WHATSAPP_ENABLED || "false").toLowerCase() === "true";

app.use(bodyParser.json({ limit: "5mb" }));
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));

// Health (אפשר למחוק את src/routes/health.ts הישן)
app.get("/health", async (_req, res) => {
  try {
    const db = getDb();
    await db.collection("_health").doc("ping").set({ ts: new Date().toISOString() }, { merge: true });
    return res.json({ ok: true, ts: new Date().toISOString(), firestore: { ok: true, rt: "firestore-admin" }});
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: "health-failed", detail: e?.message });
  }
});

registerOrgRoutes(app);
registerFactoryRoutes(app);
if (WHATSAPP_ENABLED) {
  registerWhatsappRoutes(app);
}

app.listen(port, () => {
  console.log(`[wizbi-cp] listening on :${port}`);
});
