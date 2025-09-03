import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { registerWhatsappRoutes } from "./routes/whatsapp";
import { registerOrgRoutes } from "./routes/orgs";

const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.json({ limit: "5mb" }));
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString(), firestore: { ok: true, rt: "firestore-admin" }});
});

registerWhatsappRoutes(app);
registerOrgRoutes(app);

app.listen(port, () => {
  console.log(`[wizbi-cp] listening on :${port}`);
});
