// src/mcp/tools.ts
// MCP Tools — maps 1:1 to REST API endpoints.
// Each tool wraps the service logic directly (no HTTP round-trip).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb } from '../services/firebaseAdmin';
import admin from 'firebase-admin';
import * as GcpService from '../services/gcp';
import * as GithubService from '../services/github';

import * as BillingService from '../services/billing';

const db = getDb();
const PROJECTS = db.collection('projects');
const ORGS = db.collection('orgs');
const USERS = db.collection('users');
const SETTINGS = db.collection('settings');

// Helper: structured log for MCP tool calls
function toolLog(tool: string, meta: Record<string, any> = {}) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), severity: 'INFO', evt: `mcp.tool.${tool}`, ...meta }));
}

export function registerTools(server: McpServer): void {

    // ─── Organizations ───────────────────────────────────────

    server.tool(
        'list_organizations',
        'List all organizations in the control plane',
        {},
        async () => {
            toolLog('list_organizations');
            const snap = await ORGS.orderBy('name').get();
            const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            return { content: [{ type: 'text' as const, text: JSON.stringify(items, null, 2) }] };
        }
    );

    server.tool(
        'create_organization',
        'Create a new organization with GCP folder and GitHub team',
        { name: z.string().describe('Organization name') },
        async ({ name }) => {
            toolLog('create_organization', { name });
            let gcpFolderId: string | undefined;
            let githubTeamId: number | undefined;
            let githubTeamSlug: string | undefined;

            try { gcpFolderId = await GcpService.createGcpFolderForOrg(name); } catch (e: any) {
                toolLog('create_organization.gcp_folder.skipped', { reason: e.message });
            }
            try {
                const team = await GithubService.createGithubTeam(name);
                githubTeamId = team.id; githubTeamSlug = team.slug;
            } catch (e: any) {
                toolLog('create_organization.github_team.skipped', { reason: e.message });
            }

            const docRef = await ORGS.add({
                name,
                ...(gcpFolderId && { gcpFolderId }),
                ...(githubTeamId && { githubTeamId }),
                ...(githubTeamSlug && { githubTeamSlug }),
                createdAt: new Date().toISOString(),
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, id: docRef.id, gcpFolderId, githubTeamSlug }) }] };
        }
    );

    server.tool(
        'delete_organization',
        'Delete an organization (must have no active projects)',
        { id: z.string().describe('Organization ID') },
        async ({ id }) => {
            toolLog('delete_organization', { id });
            const projectsSnap = await PROJECTS.where('orgId', '==', id).limit(1).get();
            if (!projectsSnap.empty) {
                return { content: [{ type: 'text' as const, text: 'Error: Cannot delete organization with active projects.' }], isError: true };
            }
            const orgDoc = await ORGS.doc(id).get();
            if (!orgDoc.exists) return { content: [{ type: 'text' as const, text: 'Error: Organization not found.' }], isError: true };
            const orgData = orgDoc.data()!;
            await ORGS.doc(id).update({ state: 'deleting' });
            try {
                if (orgData.gcpFolderId) await GcpService.deleteGcpFolder(orgData.gcpFolderId);
                if (orgData.githubTeamSlug) await GithubService.deleteGithubTeam(orgData.githubTeamSlug);
                await ORGS.doc(id).delete();
            } catch (e: any) {
                await ORGS.doc(id).update({ state: 'delete_failed', error: e.message });
                return { content: [{ type: 'text' as const, text: `Deletion failed: ${e.message}` }], isError: true };
            }
            return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, message: 'Organization deleted.' }) }] };
        }
    );

    // ─── Projects ────────────────────────────────────────────

    server.tool(
        'list_projects',
        'List all projects, optionally filtered by organization',
        { orgId: z.string().optional().describe('Filter by organization ID') },
        async ({ orgId }) => {
            toolLog('list_projects', { orgId });
            let query: admin.firestore.Query = PROJECTS;
            if (orgId) query = query.where('orgId', '==', orgId);
            const snap = await query.orderBy('createdAt', 'desc').limit(100).get();
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            return { content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }] };
        }
    );

    server.tool(
        'get_project',
        'Get detailed information about a specific project',
        { id: z.string().describe('Project ID') },
        async ({ id }) => {
            toolLog('get_project', { id });
            const doc = await PROJECTS.doc(id).get();
            if (!doc.exists) return { content: [{ type: 'text' as const, text: 'Error: Project not found.' }], isError: true };
            return { content: [{ type: 'text' as const, text: JSON.stringify({ id: doc.id, ...doc.data() }, null, 2) }] };
        }
    );

    server.tool(
        'create_project',
        'Create a new project and trigger full provisioning (GCP + GitHub + CI/CD)',
        {
            orgId: z.string().describe('Parent organization ID'),
            displayName: z.string().describe('Human-readable project name'),
            shortName: z.string().describe('Short name (used in GCP project ID)'),
            template: z.string().describe('Template repository name to use'),
        },
        async ({ orgId, displayName, shortName, template }) => {
            toolLog('create_project', { orgId, displayName, shortName, template });
            const orgDoc = await ORGS.doc(orgId).get();
            if (!orgDoc.exists) return { content: [{ type: 'text' as const, text: 'Error: Organization not found.' }], isError: true };
            const orgName = orgDoc.data()?.name || 'unknown';
            const orgSlug = orgName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            const formattedShortName = shortName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            const projectId = `wizbi-${orgSlug}-${formattedShortName}`;

            const existing = await PROJECTS.doc(projectId).get();
            if (existing.exists) return { content: [{ type: 'text' as const, text: `Error: Project ID '${projectId}' already exists.` }], isError: true };

            await PROJECTS.doc(projectId).set({
                displayName, orgId, shortName, template,
                createdAt: new Date().toISOString(),
                state: 'pending_gcp',
                externalLinks: [],
            });

            // Note: Full provisioning runs in the background via the API
            // The MCP tool returns immediately — use get_project or get_project_logs to track progress
            return {
                content: [{
                    type: 'text' as const, text: JSON.stringify({
                        ok: true, id: projectId,
                        message: 'Project created. Provisioning started in background. Use get_project_logs to track progress.',
                    })
                }]
            };
        }
    );

    server.tool(
        'get_project_logs',
        'Get provisioning logs for a project',
        { id: z.string().describe('Project ID') },
        async ({ id }) => {
            toolLog('get_project_logs', { id });
            const logsSnap = await PROJECTS.doc(id).collection('logs').orderBy('serverTimestamp', 'asc').get();
            const logs = logsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            return { content: [{ type: 'text' as const, text: JSON.stringify(logs, null, 2) }] };
        }
    );

    server.tool(
        'delete_project',
        'Delete a project and its GCP/GitHub resources',
        { id: z.string().describe('Project ID') },
        async ({ id }) => {
            toolLog('delete_project', { id });
            const doc = await PROJECTS.doc(id).get();
            if (!doc.exists) return { content: [{ type: 'text' as const, text: 'Error: Project not found.' }], isError: true };
            await PROJECTS.doc(id).update({ state: 'deleting' });
            try {
                await GcpService.deleteGcpProject(id);
                await GithubService.deleteGithubRepo(id);
                const logsSnap = await PROJECTS.doc(id).collection('logs').get();
                const batch = db.batch();
                logsSnap.docs.forEach(d => batch.delete(d.ref));
                await batch.commit();
                await PROJECTS.doc(id).delete();
            } catch (e: any) {
                await PROJECTS.doc(id).update({ state: 'delete_failed', error: e.message });
                return { content: [{ type: 'text' as const, text: `Deletion failed: ${e.message}` }], isError: true };
            }
            return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, message: 'Project deleted.' }) }] };
        }
    );

    // ─── Links ───────────────────────────────────────────────

    server.tool(
        'add_project_link',
        'Add an external link to a project',
        {
            projectId: z.string().describe('Project ID'),
            url: z.string().describe('Link URL'),
            name: z.string().describe('Link display name'),
            color: z.string().describe('Link color (hex)'),
            icon: z.string().describe('Icon name (e.g., GITHUB, CLOUDRUN, WEB)'),
        },
        async ({ projectId, url, name, color, icon }) => {
            toolLog('add_project_link', { projectId, name });
            const newLink = { id: new Date().getTime().toString(), url, name, color, icon };
            await PROJECTS.doc(projectId).update({
                externalLinks: admin.firestore.FieldValue.arrayUnion(newLink),
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, link: newLink }) }] };
        }
    );

    server.tool(
        'remove_project_link',
        'Remove an external link from a project',
        {
            projectId: z.string().describe('Project ID'),
            linkId: z.string().describe('Link ID to remove'),
        },
        async ({ projectId, linkId }) => {
            toolLog('remove_project_link', { projectId, linkId });
            const doc = await PROJECTS.doc(projectId).get();
            if (!doc.exists) return { content: [{ type: 'text' as const, text: 'Project not found.' }], isError: true };
            const linkToDelete = (doc.data()?.externalLinks || []).find((l: any) => l.id === linkId);
            if (!linkToDelete) return { content: [{ type: 'text' as const, text: 'Link not found.' }], isError: true };
            await PROJECTS.doc(projectId).update({
                externalLinks: admin.firestore.FieldValue.arrayRemove(linkToDelete),
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }] };
        }
    );

    // ─── Templates ───────────────────────────────────────────

    server.tool(
        'list_templates',
        'List available project templates',
        {},
        async () => {
            toolLog('list_templates');
            try {
                const templates = await GithubService.listTemplateRepos();
                return { content: [{ type: 'text' as const, text: JSON.stringify(templates, null, 2) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
            }
        }
    );

    server.tool(
        'create_template',
        'Create a new project template from template-base',
        {
            name: z.string().describe('Template name (will be prefixed with template-)'),
            description: z.string().describe('Template description'),
        },
        async ({ name, description }) => {
            toolLog('create_template', { name });
            try {
                const newRepo = await GithubService.createNewTemplate(name, description);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, repo: newRepo }) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
            }
        }
    );

    server.tool(
        'delete_template',
        'Delete a template repository',
        { repoName: z.string().describe('Template repository name') },
        async ({ repoName }) => {
            toolLog('delete_template', { repoName });
            try {
                await GithubService.deleteTemplateRepo(repoName);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, message: 'Template deleted.' }) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
            }
        }
    );

    // ─── Users ───────────────────────────────────────────────

    server.tool(
        'list_users',
        'List all users and their roles',
        {},
        async () => {
            toolLog('list_users');
            const snap = await USERS.get();
            const users = snap.docs.map(doc => ({
                uid: doc.id,
                email: doc.data().email,
                roles: doc.data().roles || {},
            }));
            return { content: [{ type: 'text' as const, text: JSON.stringify(users, null, 2) }] };
        }
    );

    server.tool(
        'update_user_roles',
        'Update a user\'s roles (superAdmin, orgAdmin)',
        {
            uid: z.string().describe('User UID'),
            superAdmin: z.boolean().optional().describe('Set superAdmin status'),
            orgAdmin: z.array(z.string()).optional().describe('Array of org IDs the user can admin'),
        },
        async ({ uid, superAdmin, orgAdmin }) => {
            toolLog('update_user_roles', { uid, superAdmin, orgAdmin });
            const roles: Record<string, any> = {};
            if (superAdmin !== undefined) roles.superAdmin = superAdmin;
            if (orgAdmin !== undefined) roles.orgAdmin = orgAdmin;
            await USERS.doc(uid).update({ roles });
            return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, message: 'User roles updated.' }) }] };
        }
    );

    // ─── System ──────────────────────────────────────────────

    server.tool(
        'get_system_health',
        'Check the health of the control plane system',
        {},
        async () => {
            toolLog('get_system_health');
            try {
                await db.collection('_health').doc('ping').set({ ts: new Date().toISOString() }, { merge: true });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, ts: new Date().toISOString(), firestore: 'connected' }) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: `Health check failed: ${e.message}` }], isError: true };
            }
        }
    );

    // ─── Billing ─────────────────────────────────────────────

    server.tool(
        'get_project_billing',
        'Get billing information and monthly cost for a GCP project',
        { id: z.string().describe('Project ID') },
        async ({ id }) => {
            toolLog('get_project_billing', { id });
            const doc = await PROJECTS.doc(id).get();
            if (!doc.exists) return { content: [{ type: 'text' as const, text: 'Error: Project not found.' }], isError: true };
            const gcpProjectId = doc.data()?.gcpProjectId || id;
            try {
                const data = await BillingService.getFullBillingData(gcpProjectId);
                return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
            }
        }
    );
}
