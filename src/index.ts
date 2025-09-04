// --- REPLACE THE ENTIRE FILE CONTENT ---

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";

// --- Import all routers using the unified pattern ---
import healthRouter from './routes/health';
import userRouter from './routes/user';
import projectsRouter from './routes/projects'; // UPDATED
import orgsRouter from './routes/orgs';
import whatsappRouter from './routes/whatsapp';

// --- App Initialization ---
const app = express();
const port = process.env.PORT || 8080;
const WHATSAPP_ENABLED = (process.env.WHATSAPP_ENABLED || "false").toLowerCase() === "true";

console.log("[wizbi-cp] Initializing middleware...");
app.use(express.json({ limit: '1mb' }));
app.use(bodyParser.json({ limit: "5mb" }));
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
console.log("[wizbi-cp] Middleware initialized.");

// --- Register all API routes ---
console.log("[wizbi-cp] Registering routes...");
app.use('/api', healthRouter);
app.use('/api', userRouter);
app.use('/api', projectsRouter); // UPDATED
app.use('/api', orgsRouter);
app.use('/api', factoryRouter);
console.log("   -> Core routers registered under /api.");

if (WHATSAPP_ENABLED) {
  app.use('/', whatsappRouter);
  console.log("   -> WhatsApp router registered at root.");
} else {
  console.log("   -> WhatsApp router skipped (disabled).");
}
console.log("[wizbi-cp] All routes registered.");

// --- Start Server ---
app.listen(port, () => {
  console.log(`[wizbi-cp] Server is fully initialized and listening on :${port}`);
});
