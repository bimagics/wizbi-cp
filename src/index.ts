import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import sodium from 'libsodium-wrappers';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';

// --- Import all routers ---
import healthRouter from './routes/health';
import userRouter from './routes/user';
import projectsRouter from './routes/projects';
import orgsRouter from './routes/orgs';
import githubRouter from './routes/github';
import githubSetupRouter from './routes/github-setup';
import settingsRouter from './routes/settings';
import apiKeysRouter from './routes/api-keys';
import agentRouter from './routes/agent';
import { mountMcpServer } from './mcp/index';

async function main() {
  // --- Initialize libsodium ---
  try {
    await sodium.ready;
    console.log('[wizbi-cp] Libsodium crypto library initialized successfully.');
  } catch (error) {
    console.error('[wizbi-cp] FATAL: Libsodium crypto library failed to initialize.', error);
    process.exit(1);
  }

  // --- App Initialization ---
  const app = express();
  const port = process.env.PORT || 8080;
  const PROJECT_ID = process.env.GCP_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '';

  // --- Security Enhancements ---
  app.set("trust proxy", true);
  app.disable("x-powered-by");

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    next();
  });

  // --- Dynamic CORS Configuration ---
  // Automatically derives allowed origins from the PROJECT_ID,
  // so any fresh installation works without hardcoded domains.
  const allowedOrigins = new Set<string>([
    // Local development
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);

  // Add Firebase Hosting origins based on PROJECT_ID
  if (PROJECT_ID) {
    allowedOrigins.add(`https://${PROJECT_ID}.web.app`);
    allowedOrigins.add(`https://${PROJECT_ID}.firebaseapp.com`);
    allowedOrigins.add(`https://${PROJECT_ID}-qa.web.app`);
    allowedOrigins.add(`https://${PROJECT_ID}-qa.firebaseapp.com`);
  }

  // Allow extra origins from env var (comma-separated)
  const extraOrigins = (process.env.CORS_ORIGIN ?? "").split(",").map(s => s.trim()).filter(Boolean);
  extraOrigins.forEach(o => {
    if (o === '*') {
      // Wildcard: allow all origins (useful for initial setup)
      allowedOrigins.clear();
    } else {
      allowedOrigins.add(o);
    }
  });

  app.use(
    cors({
      origin: (origin, cb) => {
        // If allowedOrigins is empty (wildcard mode), allow everything
        if (allowedOrigins.size === 0 || !origin || allowedOrigins.has(origin)) {
          return cb(null, true);
        }
        return cb(new Error('Not allowed by CORS'));
      },
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type", "X-Firebase-ID-Token", "X-API-Key"],
      maxAge: 3600,
    })
  );

  // --- Body Parsers ---
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // --- Register API Routes ---
  console.log("[wizbi-cp] Registering routes...");
  app.use('/api', healthRouter);
  app.use('/api', userRouter);
  app.use('/api', projectsRouter);
  app.use('/api', orgsRouter);
  app.use('/api', githubRouter);
  app.use('/api', githubSetupRouter);
  app.use('/api', settingsRouter);
  app.use('/api', apiKeysRouter);
  app.use('/api', agentRouter);

  // --- OpenAPI / Swagger Docs ---
  try {
    const specPath = path.join(__dirname, 'openapi.yaml');
    if (fs.existsSync(specPath)) {
      const swaggerDoc = YAML.load(specPath);
      app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc, {
        customSiteTitle: 'WIZBI CP API Docs',
        customCss: '.swagger-ui .topbar { display: none }',
      }));
      app.get('/api/openapi.json', (_req, res) => res.json(swaggerDoc));
      console.log('[wizbi-cp] Swagger UI available at /api/docs');
    }
  } catch (e) {
    console.warn('[wizbi-cp] Swagger UI not loaded:', (e as Error).message);
  }

  // --- MCP Server (Agent Interface) ---
  mountMcpServer(app);
  console.log('[wizbi-cp] MCP Server available at /api/mcp/sse');

  // --- Static assets ---
  app.use(express.static(path.join(process.cwd(), "public")));

  // Health check for Docker/Cloud Run
  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

  // 404 handler
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: "Not Found" });
    }
    res.status(404).send("Not Found");
  });

  // Error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Unhandled error:", err?.message ?? err);
    res.status(500).json({ error: "Internal Server Error" });
  });

  // --- Start Server ---
  app.listen(port, () => {
    console.log(`[wizbi-cp] Server listening on :${port} (project: ${PROJECT_ID || 'unknown'})`);
  });
}

main();
