// --- REPLACE THE ENTIRE FILE CONTENT ---
// File path: src/routes/github.ts

import { Router, Request, Response } from 'express'; // <-- FIX: Import Request and Response
import { requireAdminAuth, log } from './projects';
import * as GithubService from '../services/github';

const router = Router();

// Endpoint to dynamically fetch available template repositories
// It finds all repos in the org with a name starting with "template-"
router.get('/github/templates', requireAdminAuth, async (req: Request, res: Response) => { // <-- FIX: Add types
    try {
        log('github.templates.list.received');
        const templates = await GithubService.listTemplateRepos();
        res.json({ ok: true, templates });
    } catch (error: any) {
        log('github.templates.list.error', { error: error.message });
        res.status(500).json({ ok: false, error: 'Failed to fetch templates', detail: error.message });
    }
});

export default router;
