"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const firebaseAdmin_1 = require("../services/firebaseAdmin");
const router = (0, express_1.Router)();
router.get('/health', async (_req, res) => {
    try {
        const db = (0, firebaseAdmin_1.getDb)();
        await db.collection("_health").doc("ping").set({ ts: new Date().toISOString() }, { merge: true });
        return res.json({ ok: true, ts: new Date().toISOString(), firestore: { ok: true, rt: "firestore-admin" } });
    }
    catch (e) {
        return res.status(500).json({ ok: false, error: "health-failed", detail: e?.message });
    }
});
exports.default = router;
