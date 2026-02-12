"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/orgs.ts
const express_1 = require("express");
const firebaseAdmin_1 = require("../services/firebaseAdmin");
const projects_1 = require("./projects"); // Use requireAuth for listing
const GcpService = __importStar(require("../services/gcp"));
const GithubService = __importStar(require("../services/github"));
const router = (0, express_1.Router)();
const ORGS_COLLECTION = 'orgs';
const PROJECTS_COLLECTION = 'projects';
router.get('/orgs', projects_1.requireAuth, async (req, res) => {
    try {
        const userProfile = req.userProfile;
        // Super Admins see all organizations
        if (userProfile?.roles?.superAdmin) {
            const snap = await (0, firebaseAdmin_1.getDb)().collection(ORGS_COLLECTION).orderBy('name').get();
            const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            return res.json({ ok: true, items });
        }
        // Org Admins see only their assigned organizations
        const orgIds = userProfile?.roles?.orgAdmin || [];
        if (orgIds.length === 0) {
            return res.json({ ok: true, items: [] }); // No orgs assigned, return empty
        }
        // --- FIX: Added (id: string) to explicitly type the parameter ---
        const orgPromises = orgIds.map((id) => (0, firebaseAdmin_1.getDb)().collection(ORGS_COLLECTION).doc(id).get());
        const orgDocs = await Promise.all(orgPromises);
        const items = orgDocs
            .filter(doc => doc.exists)
            .map(doc => ({ id: doc.id, ...doc.data() }));
        res.json({ ok: true, items });
    }
    catch (e) {
        (0, projects_1.log)('orgs.list.error', { error: e.message });
        res.status(500).json({ ok: false, error: 'list-failed' });
    }
});
// Creating an org still requires a super admin
router.post('/orgs', projects_1.requireAdminAuth, async (req, res) => {
    (0, projects_1.log)('orgs.create.received', { body: req.body });
    try {
        const { name, phone } = req.body || {};
        if (!name)
            return res.status(400).json({ ok: false, error: 'missing-name' });
        const gcpFolderId = await GcpService.createGcpFolderForOrg(name);
        const { id: githubTeamId, slug: githubTeamSlug } = await GithubService.createGithubTeam(name);
        (0, projects_1.log)('orgs.create.firestore.start', { name });
        const docRef = await (0, firebaseAdmin_1.getDb)().collection(ORGS_COLLECTION).add({
            name,
            phone,
            gcpFolderId,
            githubTeamId,
            githubTeamSlug,
            createdAt: new Date().toISOString(),
        });
        (0, projects_1.log)('orgs.create.firestore.success', { orgId: docRef.id });
        res.status(201).json({ ok: true, id: docRef.id });
    }
    catch (e) {
        (0, projects_1.log)('orgs.create.error', { error: e.message, stack: e.stack });
        res.status(500).json({ ok: false, error: 'create-failed', detail: e.message });
    }
});
// Deleting an org still requires a super admin
router.delete('/orgs/:id', projects_1.requireAdminAuth, async (req, res) => {
    const { id } = req.params;
    (0, projects_1.log)('org.delete.received', { orgId: id });
    try {
        // **SAFETY CHECK**: Ensure no projects are associated with this org
        const projectsSnap = await (0, firebaseAdmin_1.getDb)().collection(PROJECTS_COLLECTION).where('orgId', '==', id).limit(1).get();
        if (!projectsSnap.empty) {
            (0, projects_1.log)('org.delete.error.has_projects', { orgId: id });
            return res.status(400).json({ error: 'Cannot delete organization with active projects. Please delete all associated projects first.' });
        }
        const orgDoc = await (0, firebaseAdmin_1.getDb)().collection(ORGS_COLLECTION).doc(id).get();
        if (!orgDoc.exists) {
            return res.status(404).json({ error: 'Organization not found' });
        }
        const orgData = orgDoc.data();
        // Mark for deletion in Firestore
        await (0, firebaseAdmin_1.getDb)().collection(ORGS_COLLECTION).doc(id).update({ state: 'deleting' });
        // Fire and forget deletion process
        (async () => {
            try {
                if (orgData.gcpFolderId) {
                    await GcpService.deleteGcpFolder(orgData.gcpFolderId);
                }
                if (orgData.githubTeamSlug) {
                    await GithubService.deleteGithubTeam(orgData.githubTeamSlug);
                }
                await (0, firebaseAdmin_1.getDb)().collection(ORGS_COLLECTION).doc(id).delete();
                (0, projects_1.log)('org.delete.success', { orgId: id });
            }
            catch (error) {
                (0, projects_1.log)('org.delete.error.fatal', { orgId: id, error: error.message });
                await (0, firebaseAdmin_1.getDb)().collection(ORGS_COLLECTION).doc(id).update({ state: 'delete_failed', error: error.message });
            }
        })();
        res.status(202).json({ ok: true, message: 'Organization deletion started.' });
    }
    catch (e) {
        (0, projects_1.log)('org.delete.error.initial', { orgId: id, error: e.message });
        res.status(500).json({ ok: false, error: 'Failed to start organization deletion.' });
    }
});
exports.default = router;
