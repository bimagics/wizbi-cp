// src/routes/github.ts
// Template management routes.

import { Router, Request, Response } from 'express';
import { requireAdminAuth, log } from './projects';
import * as GithubService from '../services/github';

const router = Router();

// Endpoint to dynamically fetch available template repositories
router.get('/github/templates', requireAdminAuth, async (req: Request, res: Response) => {
    try {
        log('github.templates.list.received');
        const templates = await GithubService.listTemplateRepos();
        res.json({ ok: true, templates });
    } catch (error: any) {
        log('github.templates.list.error', { error: error.message });
        res.status(500).json({ ok: false, error: 'Failed to fetch templates', detail: error.message });
    }
});

// Endpoint to create a new template repository
router.post('/github/templates', requireAdminAuth, async (req: Request, res: Response) => {
    try {
        const { name, description } = req.body;
        if (!name || !description) {
            return res.status(400).json({ ok: false, error: 'Missing name or description' });
        }
        log('github.templates.create.received', { name });
        const newRepo = await GithubService.createNewTemplate(name, description);
        res.status(201).json({ ok: true, repo: newRepo });
    } catch (error: any) {
        log('github.templates.create.error', { error: error.message });
        res.status(500).json({ ok: false, error: 'Failed to create template', detail: error.message });
    }
});

// Endpoint to update a template's description
router.put('/github/templates/:repoName', requireAdminAuth, async (req: Request, res: Response) => {
    try {
        const { repoName } = req.params;
        const { description } = req.body;
        if (description === undefined) { // Allow empty description
            return res.status(400).json({ ok: false, error: 'Missing description field' });
        }
        log('github.templates.update.received', { repoName });
        await GithubService.updateTemplateDescription(repoName, description);
        res.status(200).json({ ok: true });
    } catch (error: any) {
        log('github.templates.update.error', { error: error.message });
        res.status(500).json({ ok: false, error: 'Failed to update template', detail: error.message });
    }
});

// --- NEW ---
// Endpoint to delete a template repository
router.delete('/github/templates/:repoName', requireAdminAuth, async (req: Request, res: Response) => {
    try {
        const { repoName } = req.params;
        log('github.templates.delete.received', { repoName });
        await GithubService.deleteTemplateRepo(repoName);
        res.status(200).json({ ok: true, message: 'Template deleted successfully.' });
    } catch (error: any) {
        log('github.templates.delete.error', { error: error.message });
        res.status(500).json({ ok: false, error: 'Failed to delete template', detail: error.message });
    }
});


export default router;
