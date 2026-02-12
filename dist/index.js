"use strict";
// --- REPLACE THE ENTIRE FILE CONTENT ---
// File: src/index.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const libsodium_wrappers_1 = __importDefault(require("libsodium-wrappers"));
// --- Import all routers using the unified pattern ---
const health_1 = __importDefault(require("./routes/health"));
const user_1 = __importDefault(require("./routes/user"));
const projects_1 = __importDefault(require("./routes/projects"));
const orgs_1 = __importDefault(require("./routes/orgs"));
const whatsapp_1 = __importDefault(require("./routes/whatsapp"));
const github_1 = __importDefault(require("./routes/github"));
const settings_1 = __importDefault(require("./routes/settings"));
async function main() {
    // --- Initialize libsodium ---
    try {
        await libsodium_wrappers_1.default.ready;
        console.log('[wizbi-cp] Libsodium crypto library initialized successfully.');
    }
    catch (error) {
        console.error('[wizbi-cp] FATAL: Libsodium crypto library failed to initialize.', error);
        process.exit(1); // Exit if crypto is not available
    }
    // --- App Initialization ---
    const app = (0, express_1.default)();
    const port = process.env.PORT || 8080;
    // --- Security Enhancements ---
    // Trust proxy headers from Cloud Run
    app.set("trust proxy", true);
    // Remove framework identifier
    app.disable("x-powered-by");
    // Basic security headers
    app.use((req, res, next) => {
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        res.setHeader("X-XSS-Protection", "1; mode=block");
        next();
    });
    // --- Focused CORS Configuration ---
    const DEFAULT_ALLOWED_ORIGINS = new Set([
        "https://wizbi-cp.web.app",
        "https://wizbi-cp.firebaseapp.com",
        "https://wizbi-cp-qa.web.app",
        "https://wizbi-cp-qa.firebaseapp.com",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173", // Common Vite port
        "http://127.0.0.1:5173",
    ]);
    const extraOrigins = (process.env.CORS_ORIGIN ?? "").split(",").map(s => s.trim()).filter(Boolean);
    extraOrigins.forEach(o => DEFAULT_ALLOWED_ORIGINS.add(o));
    app.use((0, cors_1.default)({
        origin: (origin, cb) => {
            // Allow requests with no origin (like curl, Postman)
            if (!origin || DEFAULT_ALLOWED_ORIGINS.has(origin)) {
                return cb(null, true);
            }
            return cb(new Error('Not allowed by CORS'));
        },
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Authorization", "Content-Type", "X-Firebase-ID-Token"],
        maxAge: 3600,
    }));
    // --- Body Parsers ---
    // IMPORTANT: The WhatsApp webhook needs the raw body for signature verification, so it's registered before express.json()
    app.use("/api/whatsapp/webhook", // Assuming this is the path you use
    express_1.default.raw({ type: "application/json", limit: "1mb" }), whatsapp_1.default);
    // JSON parser for all other API routes
    app.use(express_1.default.json({ limit: '2mb' }));
    app.use(express_1.default.urlencoded({ extended: true }));
    // --- Register API Routes ---
    console.log("[wizbi-cp] Registering routes...");
    app.use('/api', health_1.default);
    app.use('/api', user_1.default);
    app.use('/api', projects_1.default);
    app.use('/api', orgs_1.default);
    app.use('/api', github_1.default);
    app.use('/api', settings_1.default);
    // --- Static assets and final handlers ---
    // Serve static files from 'public' folder
    app.use(express_1.default.static(path_1.default.join(process.cwd(), "public")));
    // Inline health check for Docker/Cloud Run
    app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));
    // Generic 404 handler
    app.use((req, res) => {
        // If the request is for an API route, return JSON. Otherwise, you might want to serve an HTML 404 page.
        if (req.path.startsWith('/api/')) {
            return res.status(404).json({ error: "Not Found" });
        }
        // Fallback for non-api routes (optional, can serve a 404 page)
        res.status(404).send("Not Found");
    });
    // Generic error handler
    app.use((err, _req, res, _next) => {
        console.error("Unhandled error:", err?.message ?? err);
        res.status(500).json({ error: "Internal Server Error" });
    });
    // --- Start Server ---
    app.listen(port, () => {
        console.log(`[wizbi-cp] Server is fully initialized and listening on :${port}`);
    });
}
main();
