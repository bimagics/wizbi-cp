// src/index.ts
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { registerOrgRoutes } from "./routes/orgs";
import { registerFactoryRoutes } from "./routes/factory";
import { registerWhatsappRoutes } from "./routes/whatsapp";
import tenantsRouter from './routes/tenants';
import userRouter from './routes/user';
import healthRouter from './routes/health'; // ייבוא חדש של ראוטר ה-health

const app = express();
const port = process.env.PORT || 8080;
const WHATSAPP_ENABLED = (process.env.WHATSAPP_ENABLED || "false").toLowerCase() === "true";

app.use(express.json({ limit: '1mb' }));
app.use(bodyParser.json({ limit: "5mb" }));
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));

// --- טעינה אחידה של כל הראוטרים ---
app.use(healthRouter); // שימוש בראוטר החדש
app.use(tenantsRouter);
app.use(userRouter);

// --- רוטים קיימים (שעדיין לא הועברו למבנה החדש) ---
registerOrgRoutes(app);
registerFactoryRoutes(app);
if (WHATSAPP_ENABLED) {
  registerWhatsappRoutes(app);
}

// הסרנו את ההגדרה הישנה של /health מכאן

app.listen(port, () => {
  console.log(`[wizbi-cp] listening on :${port}`);
});
