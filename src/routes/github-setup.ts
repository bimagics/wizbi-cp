// src/routes/github-setup.ts
// GitHub App Manifest Flow — one-click setup for GitHub integration.
// Handles: manifest generation, OAuth-like callback, webhook for installation events,
// and status endpoint to check current configuration.

import { Router, Request, Response } from 'express';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import crypto from 'crypto';
import { requireAdminAuth, log } from './projects';
import { clearSecretCache } from '../services/secrets';
import { resetGitHubClient, ensureTemplateBase } from '../services/github';

const router = Router();
const secretClient = new SecretManagerServiceClient();
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || process.env.PROJECT_ID || '';
const GITHUB_OWNER = process.env.GITHUB_OWNER || '';

// Secret names managed by this flow
const SECRETS = {
    APP_ID: 'GITHUB_APP_ID',
    PRIVATE_KEY: 'GITHUB_PRIVATE_KEY',
    INSTALLATION_ID: 'GITHUB_INSTALLATION_ID',
    WEBHOOK_SECRET: 'GITHUB_WEBHOOK_SECRET',
};

// ── Helper: Store a secret in Secret Manager ──────────────────
async function storeSecret(name: string, value: string): Promise<void> {
    const secretPath = `projects/${GCP_PROJECT_ID}/secrets/${name}`;

    // Ensure the secret resource exists
    try {
        await secretClient.getSecret({ name: secretPath });
    } catch {
        await secretClient.createSecret({
            parent: `projects/${GCP_PROJECT_ID}`,
            secretId: name,
            secret: { replication: { automatic: {} } },
        });
        log('github-setup.secret.created', { name });
    }

    // Add new version
    await secretClient.addSecretVersion({
        parent: secretPath,
        payload: { data: Buffer.from(value, 'utf-8') },
    });
    log('github-setup.secret.stored', { name });
}

// ── Helper: Read a secret (returns null if not set/placeholder) ──
async function readSecret(name: string): Promise<string | null> {
    try {
        const [version] = await secretClient.accessSecretVersion({
            name: `projects/${GCP_PROJECT_ID}/secrets/${name}/versions/latest`,
        });
        const value = (version.payload?.data?.toString() || '').trim();
        if (!value || value.toLowerCase() === 'placeholder') return null;
        return value;
    } catch {
        return null;
    }
}

// ── GET /api/github/setup/status ──────────────────────────────
// Returns the current GitHub App configuration status.
router.get('/github/setup/status', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
        const [appId, privateKey, installationId] = await Promise.all([
            readSecret(SECRETS.APP_ID),
            readSecret(SECRETS.PRIVATE_KEY),
            readSecret(SECRETS.INSTALLATION_ID),
        ]);

        const appCreated = !!(appId && privateKey);
        const appInstalled = !!installationId;

        res.json({
            ok: true,
            status: {
                appCreated,
                appInstalled,
                configured: appCreated && appInstalled,
                appId: appId ? appId.substring(0, 6) + '...' : null,
                githubOwner: GITHUB_OWNER,
            },
        });
    } catch (error: any) {
        log('github-setup.status.error', { error: error.message });
        res.status(500).json({ ok: false, error: 'Failed to check GitHub setup status' });
    }
});

// ── GET /api/github/setup/start ───────────────────────────────
// Generates the manifest and returns the GitHub URL to redirect to.
router.get('/github/setup/start', requireAdminAuth, async (req: Request, res: Response) => {
    try {
        // Determine the base URL for redirect/webhook
        const protocol = req.protocol;
        const host = req.get('host');
        const baseUrl = `${protocol}://${host}`;

        // Generate a unique app name based on project
        const appName = `wizbi-${GCP_PROJECT_ID}`.substring(0, 34); // GitHub limit: 34 chars

        const manifest = {
            name: appName,
            url: baseUrl,
            hook_attributes: {
                url: `${baseUrl}/api/github/setup/webhook`,
                active: true,
            },
            redirect_url: `${baseUrl}/api/github/setup/callback`,
            public: false,
            default_permissions: {
                contents: 'write',         // Create repos from templates, customize files
                administration: 'write',   // Create repos, manage settings
                actions: 'write',          // Trigger deployments, set secrets
                members: 'write',          // Create/manage teams
                metadata: 'read',          // List repos
            },
            default_events: [
                'installation',            // Know when app is installed/uninstalled
                'push',                    // Track deployments (optional)
            ],
        };

        // Build the redirect URL for org or personal account
        const githubUrl = GITHUB_OWNER
            ? `https://github.com/organizations/${GITHUB_OWNER}/settings/apps/new`
            : `https://github.com/settings/apps/new`;

        // Generate a state parameter for CSRF protection
        const state = crypto.randomBytes(16).toString('hex');

        log('github-setup.start', { appName, githubUrl, baseUrl });

        res.json({
            ok: true,
            githubUrl: `${githubUrl}?state=${state}`,
            manifest: JSON.stringify(manifest),
            state,
        });
    } catch (error: any) {
        log('github-setup.start.error', { error: error.message });
        res.status(500).json({ ok: false, error: 'Failed to generate manifest' });
    }
});

// ── GET /api/github/setup/callback ────────────────────────────
// GitHub redirects here with a temp code after the user creates the app.
// We exchange the code for app credentials and store them.
router.get('/github/setup/callback', async (req: Request, res: Response) => {
    const { code } = req.query;

    if (!code || typeof code !== 'string') {
        return res.status(400).send('Missing code parameter from GitHub.');
    }

    try {
        log('github-setup.callback.start', { codeLength: code.length });

        // Exchange the temporary code for app credentials
        const response = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
            method: 'POST',
            headers: {
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'WIZBI-CP',
            },
        });

        if (!response.ok) {
            const errorBody = await response.text();
            log('github-setup.callback.github_error', { status: response.status, body: errorBody });
            return res.status(502).send(`GitHub API error: ${response.status}. The code may have expired (1 hour limit). Please try again.`);
        }

        const data = await response.json() as any;

        // Extract credentials
        const appId = String(data.id);
        const pem = data.pem;
        const webhookSecret = data.webhook_secret;
        const appName = data.name;
        const appSlug = data.slug;

        if (!appId || !pem) {
            log('github-setup.callback.missing_credentials', { hasId: !!appId, hasPem: !!pem });
            return res.status(502).send('GitHub did not return the expected credentials.');
        }

        // Store all credentials in Secret Manager
        await Promise.all([
            storeSecret(SECRETS.APP_ID, appId),
            storeSecret(SECRETS.PRIVATE_KEY, pem),
            ...(webhookSecret ? [storeSecret(SECRETS.WEBHOOK_SECRET, webhookSecret)] : []),
        ]);

        log('github-setup.callback.success', { appId, appName, appSlug });

        // Clear the secret cache so the GitHub service picks up fresh credentials
        clearSecretCache();
        resetGitHubClient();

        // Build the install URL so the user can install the app on their org
        const installUrl = `https://github.com/apps/${appSlug}/installations/new`;

        // Redirect to admin panel with success status
        const adminUrl = `/admin/?github_setup=success&app_name=${encodeURIComponent(appName || '')}&install_url=${encodeURIComponent(installUrl)}`;
        res.redirect(adminUrl);

    } catch (error: any) {
        log('github-setup.callback.error', { error: error.message });
        res.redirect(`/admin/?github_setup=error&message=${encodeURIComponent(error.message)}`);
    }
});

// ── POST /api/github/setup/webhook ────────────────────────────
// Receives GitHub webhook events. The key event is 'installation' which
// gives us the installation_id when the app is installed on an org.
// NOTE: This endpoint has NO auth — it uses webhook signature verification.
router.post('/github/setup/webhook', async (req: Request, res: Response) => {
    const event = req.headers['x-github-event'] as string;
    const signature = req.headers['x-hub-signature-256'] as string;

    log('github-setup.webhook.received', { event });

    // Verify webhook signature if we have a webhook secret
    const webhookSecret = await readSecret(SECRETS.WEBHOOK_SECRET);
    if (webhookSecret && signature) {
        const payload = JSON.stringify(req.body);
        const expectedSig = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
            log('github-setup.webhook.invalid_signature');
            return res.status(401).json({ error: 'Invalid signature' });
        }
    }

    // Handle installation event
    if (event === 'installation') {
        const action = req.body.action; // 'created', 'deleted', 'suspend', etc.
        const installationId = req.body.installation?.id;

        if (action === 'created' && installationId) {
            log('github-setup.webhook.installation_created', { installationId });
            try {
                await storeSecret(SECRETS.INSTALLATION_ID, String(installationId));
                clearSecretCache();
                resetGitHubClient();
                log('github-setup.webhook.installation_stored', { installationId });

                // Auto-create template-base in the user's org (fire-and-forget)
                ensureTemplateBase()
                    .then(r => log('github-setup.template-base.auto', r))
                    .catch(e => log('github-setup.template-base.error', { error: e.message }));
            } catch (error: any) {
                log('github-setup.webhook.store_error', { error: error.message });
            }
        } else if (action === 'deleted') {
            log('github-setup.webhook.installation_deleted');
        }
    }

    res.status(200).json({ ok: true });
});

// ── POST /api/github/setup/save-installation ──────────────────
// Manual fallback: if webhook doesn't fire, allow admin to paste installation ID.
router.post('/github/setup/save-installation', requireAdminAuth, async (req: Request, res: Response) => {
    const { installationId } = req.body;

    if (!installationId || typeof installationId !== 'string') {
        return res.status(400).json({ ok: false, error: 'Missing installationId' });
    }

    try {
        await storeSecret(SECRETS.INSTALLATION_ID, installationId.trim());
        clearSecretCache();
        resetGitHubClient();
        log('github-setup.manual_installation.saved', { installationId });

        // Auto-create template-base in the user's org (fire-and-forget)
        ensureTemplateBase()
            .then(r => log('github-setup.template-base.auto', r))
            .catch(e => log('github-setup.template-base.error', { error: e.message }));

        res.json({ ok: true, message: 'Installation ID saved successfully.' });
    } catch (error: any) {
        log('github-setup.manual_installation.error', { error: error.message });
        res.status(500).json({ ok: false, error: 'Failed to save installation ID' });
    }
});

export default router;
