// --- CREATE THIS NEW FILE ---
// File path: src/routes/github.ts

import { Router } from 'express';
import { requireAdminAuth } from './projects';
import * as GithubService from '../services/github';

const router = Router();

// Endpoint to dynamically fetch available template repositories
router.get('/github/templates', requireAdminAuth, async (req, res) => {
    try {
        const templates = await GithubService.listTemplateRepos();
        res.json({ ok: true, templates });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: 'Failed to fetch templates', detail: error.message });
    }
});

export default router;
