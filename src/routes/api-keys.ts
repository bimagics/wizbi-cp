// src/routes/api-keys.ts
// API Key management — create, list, and revoke API keys for programmatic access.

import { Router, Request, Response } from 'express';
import { getDb } from '../services/firebaseAdmin';
import { requireAdminAuth, log, generateApiKey, hashApiKey, AuthenticatedRequest } from '../middleware/auth';

const router = Router();
const API_KEYS_COLLECTION = getDb().collection('apiKeys');

// --- List all API keys (masked) ---
router.get('/api-keys', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
        const snap = await API_KEYS_COLLECTION.orderBy('createdAt', 'desc').get();
        const keys = snap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                name: data.name,
                prefix: data.prefix,          // First 12 chars: "wizbi_a1b2c3..."
                active: data.active,
                createdAt: data.createdAt,
                createdBy: data.createdBy,
                lastUsed: data.lastUsed || null,
                scopes: data.scopes || ['admin'],
            };
        });
        res.json({ ok: true, keys });
    } catch (e: any) {
        log('api-keys.list.error', { error: e.message });
        res.status(500).json({ ok: false, error: 'Failed to list API keys' });
    }
});

// --- Create a new API key ---
router.post('/api-keys', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    const { name, scopes } = req.body || {};
    if (!name) {
        return res.status(400).json({ ok: false, error: 'Missing key name' });
    }
    try {
        const rawKey = generateApiKey();
        const keyHash = hashApiKey(rawKey);
        const prefix = rawKey.substring(0, 12) + '...';

        const keyDoc = {
            name,
            keyHash,
            prefix,
            active: true,
            scopes: scopes || ['admin'],
            createdAt: new Date().toISOString(),
            createdBy: req.userProfile?.email || 'unknown',
            lastUsed: null,
            // API keys inherit the creator's profile for authorization
            profile: {
                uid: `apikey-${Date.now()}`,
                email: req.userProfile?.email || 'api-key',
                roles: { superAdmin: true },
            },
        };

        const docRef = await API_KEYS_COLLECTION.add(keyDoc);
        log('api-keys.create.success', { id: docRef.id, name, createdBy: keyDoc.createdBy });

        // Return the raw key ONLY on creation — it's never stored or shown again
        res.status(201).json({
            ok: true,
            id: docRef.id,
            key: rawKey,
            name,
            prefix,
            message: 'Save this key now — it will not be shown again.',
        });
    } catch (e: any) {
        log('api-keys.create.error', { error: e.message });
        res.status(500).json({ ok: false, error: 'Failed to create API key' });
    }
});

// --- Revoke (deactivate) an API key ---
router.delete('/api-keys/:id', requireAdminAuth, async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const docRef = API_KEYS_COLLECTION.doc(id);
        const doc = await docRef.get();
        if (!doc.exists) {
            return res.status(404).json({ ok: false, error: 'API key not found' });
        }
        await docRef.update({ active: false, revokedAt: new Date().toISOString() });
        log('api-keys.revoke.success', { id });
        res.json({ ok: true, message: 'API key revoked.' });
    } catch (e: any) {
        log('api-keys.revoke.error', { id, error: e.message });
        res.status(500).json({ ok: false, error: 'Failed to revoke API key' });
    }
});

export default router;
