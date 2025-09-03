import express from "express";
import cors from "cors";
import bodyParser from "body-parser";

// --- Import all routers ---
import { registerOrgRoutes } from "./routes/orgs";
import { registerFactoryRoutes } from "./routes/factory";
import { registerWhatsappRoutes } from "./routes/whatsapp";
import tenantsRouter from './routes/tenants';
import userRouter from './routes/user';
import healthRouter from './routes/health';

// --- App Initialization ---
const app = express();
const port = process.env.PORT || 8080;
const WHATSAPP_ENABLED = (process.env.WHATSAPP_ENABLED || "false").toLowerCase() === "true";

console.log("[wizbi-cp] Initializing middleware...");
app.use(express.json({ limit: '1mb' }));
app.use(bodyParser.json({ limit: "5mb" }));
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));

// --- Register all API routes ---
console.log("[wizbi-cp] Registering routes...");
app.use('/', healthRouter); // Mount at root
app.use('/', userRouter);   // Mount at root
app.use('/', tenantsRouter); // Mount at root
console.log("   -> health, user, tenants routers registered.");

registerOrgRoutes(app);
console.log("   -> orgs routes registered.");
registerFactoryRoutes(app);
console.log("   -> factory routes registered.");

if (WHATSAPP_ENABLED) {
  registerWhatsappRoutes(app);
  console.log("   -> whatsapp routes registered.");
} else {
  console.log("   -> whatsapp routes skipped (disabled).");
}

console.log("[wizbi-cp] All routes registered.");

// --- Start Server ---
app.listen(port, () => {
  console.log(`[wizbi-cp] Server is fully initialized and listening on :${port}`);
});
