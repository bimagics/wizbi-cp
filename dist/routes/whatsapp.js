"use strict";
// --- REPLACE THE ENTIRE FILE CONTENT ---
// File: src/routes/whatsapp.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
// Minimalist rate limiter to prevent simple DoS attacks (in-memory per instance)
function simpleRateLimit(max, windowMs) {
    const hits = new Map();
    return (req, res, next) => {
        const now = Date.now();
        // Use the IP from the 'trust proxy' setting in index.ts
        const key = `${req.ip || "unknown_ip"}:${req.path}`;
        const entry = hits.get(key);
        if (!entry || entry.expires < now) {
            hits.set(key, { count: 1, expires: now + windowMs });
            return next();
        }
        entry.count++;
        if (entry.count > max) {
            return res.status(429).json({ error: "Too Many Requests" });
        }
        next();
    };
}
const router = (0, express_1.Router)();
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "change-me-in-env";
const APP_SECRET = process.env.WHATSAPP_APP_SECRET || "";
// GET endpoint for webhook subscription verification
router.get("/webhook", simpleRateLimit(30, 60000), (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("WhatsApp webhook verification successful!");
        return res.status(200).send(challenge);
    }
    console.warn("WhatsApp webhook verification failed.");
    return res.status(403).send("Forbidden");
});
// POST endpoint for receiving webhook events with HMAC signature validation
router.post("/webhook", simpleRateLimit(60, 60000), (req, res) => {
    try {
        if (!APP_SECRET) {
            console.error("CRITICAL: WHATSAPP_APP_SECRET is not configured. Rejecting all webhook events.");
            return res.status(500).json({ error: "WhatsApp App Secret is not configured on the server." });
        }
        // The body is a raw Buffer thanks to express.raw() in index.ts
        const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
        const signatureHeader = (req.headers["x-hub-signature-256"] || "");
        const signature = signatureHeader.startsWith("sha256=") ? signatureHeader.slice(7) : "";
        const expectedSignature = crypto_1.default
            .createHmac("sha256", APP_SECRET)
            .update(rawBody)
            .digest("hex");
        const isValid = signature &&
            signature.length === expectedSignature.length &&
            crypto_1.default.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expectedSignature, "hex"));
        if (!isValid) {
            console.warn("Invalid WhatsApp webhook signature received.");
            return res.status(401).json({ error: "Invalid signature" });
        }
        // Now it's safe to parse the JSON payload
        let payload;
        try {
            payload = JSON.parse(rawBody.toString("utf8"));
        }
        catch {
            return res.status(400).json({ error: "Invalid JSON payload" });
        }
        // --- TODO: Process the verified WhatsApp event payload here ---
        console.log("Verified WhatsApp event received:", JSON.stringify(payload, null, 2));
        return res.status(200).send("EVENT_RECEIVED");
    }
    catch (e) {
        console.error("Error in WhatsApp webhook handler:", e?.message ?? e);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});
exports.default = router;
