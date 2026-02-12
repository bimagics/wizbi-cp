// src/routes/settings.ts
// Settings & Secrets Management API
// Allows Super Admins to view and update secrets via the Admin Panel.

import { Router, Request, Response } from 'express';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { requireAdminAuth, log } from './projects';

const router = Router();
const secretClient = new SecretManagerServiceClient();
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || process.env.PROJECT_ID || '';

// ── Secret Definitions ──────────────────────────────────────────
// Defines all secrets the system manages, grouped by category.
const SECRET_DEFINITIONS = [
    // GitHub App
    { name: 'GITHUB_APP_ID', category: 'github', label: 'GitHub App ID', sensitive: false },
    { name: 'GITHUB_PRIVATE_KEY', category: 'github', label: 'GitHub Private Key', sensitive: true },
    { name: 'GITHUB_INSTALLATION_ID', category: 'github', label: 'GitHub Installation ID', sensitive: false },

];

// ── GET /api/settings/secrets ─────────────────────────────────
// Returns all secrets with their configuration status (not values).
router.get('/settings/secrets', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
        const results = await Promise.all(
            SECRET_DEFINITIONS.map(async (def) => {
                try {
                    const [version] = await secretClient.accessSecretVersion({
                        name: `projects/${GCP_PROJECT_ID}/secrets/${def.name}/versions/latest`,
                    });
                    const value = version.payload?.data?.toString() || '';
                    const isConfigured = value !== '' && value !== 'placeholder';

                    return {
                        name: def.name,
                        category: def.category,
                        label: def.label,
                        sensitive: def.sensitive,
                        configured: isConfigured,
                        // For non-sensitive fields, show a masked preview
                        preview: !def.sensitive && isConfigured ? maskValue(value) : undefined,
                    };
                } catch (err: any) {
                    // Secret doesn't exist
                    return {
                        name: def.name,
                        category: def.category,
                        label: def.label,
                        sensitive: def.sensitive,
                        configured: false,
                    };
                }
            })
        );

        // Group by category
        const grouped: Record<string, any[]> = {};
        for (const r of results) {
            if (!grouped[r.category]) grouped[r.category] = [];
            grouped[r.category].push(r);
        }

        res.json({ ok: true, secrets: results, grouped });
    } catch (error: any) {
        log('settings.secrets.list.error', { error: error.message });
        res.status(500).json({ ok: false, error: 'Failed to list secrets' });
    }
});

// ── PUT /api/settings/secrets/:name ───────────────────────────
// Updates a single secret value in Secret Manager.
router.put('/settings/secrets/:name', requireAdminAuth, async (req: Request, res: Response) => {
    const { name } = req.params;
    const { value } = req.body;

    // Validate the secret name is in our whitelist
    const def = SECRET_DEFINITIONS.find(d => d.name === name);
    if (!def) {
        return res.status(400).json({ ok: false, error: `Unknown secret: ${name}` });
    }

    if (!value || typeof value !== 'string' || value.trim().length === 0) {
        return res.status(400).json({ ok: false, error: 'Secret value cannot be empty' });
    }

    try {
        const secretPath = `projects/${GCP_PROJECT_ID}/secrets/${name}`;

        // Check if the secret exists, create if not
        try {
            await secretClient.getSecret({ name: secretPath });
        } catch {
            await secretClient.createSecret({
                parent: `projects/${GCP_PROJECT_ID}`,
                secretId: name,
                secret: { replication: { automatic: {} } },
            });
            log('settings.secret.created', { name });
        }

        // Add new version with the provided value
        await secretClient.addSecretVersion({
            parent: secretPath,
            payload: { data: Buffer.from(value.trim(), 'utf-8') },
        });

        log('settings.secret.updated', { name, updatedBy: (req as any).user?.email || 'unknown' });
        res.json({ ok: true, message: `Secret '${def.label}' updated successfully.` });
    } catch (error: any) {
        log('settings.secret.update.error', { name, error: error.message });
        res.status(500).json({ ok: false, error: `Failed to update secret: ${error.message}` });
    }
});

// ── Helpers ────────────────────────────────────────────────────
function maskValue(value: string): string {
    if (value.length <= 6) return '••••••';
    return value.substring(0, 3) + '•••' + value.substring(value.length - 3);
}

export default router;
