// src/index.ts
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { getDb } from "./services/firebaseAdmin";
import { registerOrgRoutes } from "./routes/orgs";
import { registerFactoryRoutes } from "./routes/factory";
import { registerWhatsappRoutes } from "./routes/whatsapp";
import tenantsRouter from './routes/tenants';
import userRouter from './routes/user'; // Import the new user router

const app = express();
const port = process.env.PORT || 8080;
const WHATSAPP_ENABLED = (process.env.WHATSAPP_ENABLED || "false").toLowerCase() === "true";

app.use(express.json({ limit: '1mb' }));
app.use(bodyParser.json({ limit: "5mb" }));
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));

// הוספת הראוטרים החדשים
app.use(tenantsRouter);
app.use(userRouter); // Use the new user router

// Health
app.get("/health", async (_req, res) => {
  try {
    const db = getDb();
    await db.collection("_health").doc("ping").set({ ts: new Date().toISOString() }, { merge: true });
    return res.json({ ok: true, ts: new Date().toISOString(), firestore: { ok: true, rt: "firestore-admin" }});
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: "health-failed", detail: e?.message });
  }
});

// רוטים קיימים
registerOrgRoutes(app);
registerFactoryRoutes(app);
if (WHATSAPP_ENABLED) {
  registerWhatsappRoutes(app);
}

app.listen(port, () => {
  console.log(`[wizbi-cp] listening on :${port}`);
});
