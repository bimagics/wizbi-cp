"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/user.ts
const express_1 = require("express");
const firebaseAdmin_1 = require("../services/firebaseAdmin");
const projects_1 = require("./projects"); // Re-using auth middleware
const router = (0, express_1.Router)();
const USERS_COLLECTION = 'users';
// --- THIS IS THE MISSING ROUTE ---
// Fetches the profile of the currently logged-in user.
router.get('/me', projects_1.requireAuth, async (req, res) => {
    if (!req.userProfile) {
        return res.status(404).json({ error: 'User profile not found.' });
    }
    res.json(req.userProfile);
});
// ---------------------------------
// GET all users (for superAdmin)
router.get('/users', projects_1.requireAdminAuth, async (_req, res) => {
    try {
        const snap = await (0, firebaseAdmin_1.getDb)().collection(USERS_COLLECTION).get();
        const users = snap.docs.map(doc => {
            const data = doc.data();
            if (!data.roles) {
                data.roles = {};
            }
            return {
                uid: doc.id,
                email: data.email,
                roles: data.roles,
            };
        });
        res.json(users);
    }
    catch (e) {
        (0, projects_1.log)('users.list.error', { error: e.message });
        res.status(500).json({ ok: false, error: 'Failed to list users' });
    }
});
// UPDATE a user's roles/orgs (for superAdmin)
router.put('/users/:uid', projects_1.requireAdminAuth, async (req, res) => {
    const { uid } = req.params;
    const { roles } = req.body;
    if (!roles) {
        return res.status(400).json({ error: 'Missing roles object in request body.' });
    }
    (0, projects_1.log)('user.update.received', { uid, roles });
    try {
        const userRef = (0, firebaseAdmin_1.getDb)().collection(USERS_COLLECTION).doc(uid);
        await userRef.update({
            roles: roles
        });
        (0, projects_1.log)('user.update.success', { uid });
        res.status(200).json({ ok: true, message: 'User updated successfully.' });
    }
    catch (e) {
        (0, projects_1.log)('user.update.error', { uid, error: e.message });
        res.status(500).json({ ok: false, error: `Failed to update user: ${e.message}` });
    }
});
exports.default = router;
