"use strict";
// --- REPLACE THE ENTIRE FILE CONTENT ---
// File path: src/routes/github.ts
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
const express_1 = require("express");
const projects_1 = require("./projects");
const GithubService = __importStar(require("../services/github"));
const router = (0, express_1.Router)();
// Endpoint to dynamically fetch available template repositories
router.get('/github/templates', projects_1.requireAdminAuth, async (req, res) => {
    try {
        (0, projects_1.log)('github.templates.list.received');
        const templates = await GithubService.listTemplateRepos();
        res.json({ ok: true, templates });
    }
    catch (error) {
        (0, projects_1.log)('github.templates.list.error', { error: error.message });
        res.status(500).json({ ok: false, error: 'Failed to fetch templates', detail: error.message });
    }
});
// Endpoint to create a new template repository
router.post('/github/templates', projects_1.requireAdminAuth, async (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name || !description) {
            return res.status(400).json({ ok: false, error: 'Missing name or description' });
        }
        (0, projects_1.log)('github.templates.create.received', { name });
        const newRepo = await GithubService.createNewTemplate(name, description);
        res.status(201).json({ ok: true, repo: newRepo });
    }
    catch (error) {
        (0, projects_1.log)('github.templates.create.error', { error: error.message });
        res.status(500).json({ ok: false, error: 'Failed to create template', detail: error.message });
    }
});
// Endpoint to update a template's description
router.put('/github/templates/:repoName', projects_1.requireAdminAuth, async (req, res) => {
    try {
        const { repoName } = req.params;
        const { description } = req.body;
        if (description === undefined) { // Allow empty description
            return res.status(400).json({ ok: false, error: 'Missing description field' });
        }
        (0, projects_1.log)('github.templates.update.received', { repoName });
        await GithubService.updateTemplateDescription(repoName, description);
        res.status(200).json({ ok: true });
    }
    catch (error) {
        (0, projects_1.log)('github.templates.update.error', { error: error.message });
        res.status(500).json({ ok: false, error: 'Failed to update template', detail: error.message });
    }
});
// --- NEW ---
// Endpoint to delete a template repository
router.delete('/github/templates/:repoName', projects_1.requireAdminAuth, async (req, res) => {
    try {
        const { repoName } = req.params;
        (0, projects_1.log)('github.templates.delete.received', { repoName });
        await GithubService.deleteTemplateRepo(repoName);
        res.status(200).json({ ok: true, message: 'Template deleted successfully.' });
    }
    catch (error) {
        (0, projects_1.log)('github.templates.delete.error', { error: error.message });
        res.status(500).json({ ok: false, error: 'Failed to delete template', detail: error.message });
    }
});
exports.default = router;
