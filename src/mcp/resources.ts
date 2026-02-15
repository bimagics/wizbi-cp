// src/mcp/resources.ts
// MCP Resources — read-only data endpoints for AI context.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../services/firebaseAdmin';
import * as GithubService from '../services/github';

const db = getDb();
const PROJECTS = db.collection('projects');
const ORGS = db.collection('orgs');

export function registerResources(server: McpServer): void {

    // All organizations
    server.resource(
        'orgs',
        'wizbi://orgs',
        { description: 'All organizations in the control plane', mimeType: 'application/json' },
        async () => {
            const snap = await ORGS.orderBy('name').get();
            const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            return { contents: [{ uri: 'wizbi://orgs', text: JSON.stringify(items, null, 2), mimeType: 'application/json' }] };
        }
    );

    // All projects
    server.resource(
        'projects',
        'wizbi://projects',
        { description: 'All projects with their current state', mimeType: 'application/json' },
        async () => {
            const snap = await PROJECTS.orderBy('createdAt', 'desc').limit(100).get();
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            return { contents: [{ uri: 'wizbi://projects', text: JSON.stringify(list, null, 2), mimeType: 'application/json' }] };
        }
    );

    // Available templates
    server.resource(
        'templates',
        'wizbi://templates',
        { description: 'Available project templates', mimeType: 'application/json' },
        async () => {
            try {
                const templates = await GithubService.listTemplateRepos();
                return { contents: [{ uri: 'wizbi://templates', text: JSON.stringify(templates, null, 2), mimeType: 'application/json' }] };
            } catch {
                return { contents: [{ uri: 'wizbi://templates', text: '[]', mimeType: 'application/json' }] };
            }
        }
    );

    // System health
    server.resource(
        'health',
        'wizbi://health',
        { description: 'System health status', mimeType: 'application/json' },
        async () => {
            try {
                await db.collection('_health').doc('ping').set({ ts: new Date().toISOString() }, { merge: true });
                const health = { ok: true, ts: new Date().toISOString(), firestore: 'connected' };
                return { contents: [{ uri: 'wizbi://health', text: JSON.stringify(health, null, 2), mimeType: 'application/json' }] };
            } catch (e: any) {
                return { contents: [{ uri: 'wizbi://health', text: JSON.stringify({ ok: false, error: e.message }), mimeType: 'application/json' }] };
            }
        }
    );
}
