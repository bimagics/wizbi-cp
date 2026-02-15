// src/routes/agent.ts
// AI Agent chat endpoint with SSE streaming.

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { chat } from '../services/agent';
import crypto from 'crypto';

const router = Router();

/**
 * POST /api/agent/chat
 * Body: { message: string, sessionId?: string }
 * Response: SSE stream of chat chunks
 */
router.post('/agent/chat', requireAuth, async (req: Request, res: Response) => {
    const { message, sessionId } = req.body || {};

    if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'message is required' });
    }

    // Use provided sessionId or generate one
    const sid = sessionId || crypto.randomUUID();

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Session-Id', sid);
    res.flushHeaders();

    try {
        for await (const chunk of chat(message, sid)) {
            const data = JSON.stringify(chunk);
            res.write(`data: ${data}\n\n`);
        }
    } catch (e: any) {
        const errorData = JSON.stringify({ type: 'error', content: e.message });
        res.write(`data: ${errorData}\n\n`);
    }

    res.end();
});

/**
 * GET /api/agent/tools
 * Returns the list of available tools for the UI to display.
 */
router.get('/agent/tools', requireAuth, (_req: Request, res: Response) => {
    // Return a summary of available tools (matches the service's AGENT_TOOLS)
    const tools = [
        { name: 'list_organizations', description: 'List all organizations' },
        { name: 'create_organization', description: 'Create a new organization' },
        { name: 'delete_organization', description: 'Delete an organization' },
        { name: 'list_projects', description: 'List all projects' },
        { name: 'get_project', description: 'Get project details' },
        { name: 'get_project_logs', description: 'View provisioning logs' },
        { name: 'list_templates', description: 'List project templates' },
        { name: 'list_users', description: 'List users and roles' },
        { name: 'get_project_billing', description: 'Get project costs' },
        { name: 'get_system_health', description: 'Check system health' },
    ];
    res.json({ tools, count: tools.length });
});

export default router;
