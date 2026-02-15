// src/services/agent.ts
// Gemini-powered AI Agent service that bridges to MCP tools.
// Uses Gemini's native function calling to execute Control Plane operations.

import { VertexAI, Content, Part, FunctionDeclarationSchemaType, Tool as GeminiTool } from '@google-cloud/vertexai';
import { getDb } from './firebaseAdmin';
import admin from 'firebase-admin';
import * as GcpService from './gcp';
import * as GithubService from './github';
import * as BillingService from './billing';

const db = getDb();
const PROJECTS = db.collection('projects');
const ORGS = db.collection('orgs');
const USERS = db.collection('users');

// ────────────────────────────────────────────────────────
// Tool definitions — mirrors src/mcp/tools.ts
// ────────────────────────────────────────────────────────

interface AgentToolDef {
    name: string;
    description: string;
    parameters: Record<string, { type: string; description: string; required?: boolean; items?: any }>;
    handler: (params: any) => Promise<string>;
}

const AGENT_TOOLS: AgentToolDef[] = [
    // ── Organizations ──
    {
        name: 'list_organizations',
        description: 'List all organizations in the control plane',
        parameters: {},
        handler: async () => {
            const snap = await ORGS.orderBy('name').get();
            return JSON.stringify(snap.docs.map(d => ({ id: d.id, ...d.data() })), null, 2);
        },
    },
    {
        name: 'create_organization',
        description: 'Create a new organization with GCP folder and GitHub team',
        parameters: { name: { type: 'string', description: 'Organization name', required: true } },
        handler: async ({ name }: { name: string }) => {
            let gcpFolderId: string | undefined;
            let githubTeamId: number | undefined;
            let githubTeamSlug: string | undefined;
            try { gcpFolderId = await GcpService.createGcpFolderForOrg(name); } catch (e: any) { /* skip */ }
            try {
                const team = await GithubService.createGithubTeam(name);
                githubTeamId = team.id; githubTeamSlug = team.slug;
            } catch (e: any) { /* skip */ }
            const docRef = await ORGS.add({
                name,
                ...(gcpFolderId && { gcpFolderId }),
                ...(githubTeamId && { githubTeamId }),
                ...(githubTeamSlug && { githubTeamSlug }),
                createdAt: new Date().toISOString(),
            });
            return JSON.stringify({ ok: true, id: docRef.id, gcpFolderId, githubTeamSlug });
        },
    },
    {
        name: 'delete_organization',
        description: 'Delete an organization (must have no active projects)',
        parameters: { id: { type: 'string', description: 'Organization ID', required: true } },
        handler: async ({ id }: { id: string }) => {
            const projectsSnap = await PROJECTS.where('orgId', '==', id).limit(1).get();
            if (!projectsSnap.empty) return JSON.stringify({ error: 'Cannot delete organization with active projects.' });
            const orgDoc = await ORGS.doc(id).get();
            if (!orgDoc.exists) return JSON.stringify({ error: 'Organization not found.' });
            const orgData = orgDoc.data()!;
            await ORGS.doc(id).update({ state: 'deleting' });
            try {
                if (orgData.gcpFolderId) await GcpService.deleteGcpFolder(orgData.gcpFolderId);
                if (orgData.githubTeamSlug) await GithubService.deleteGithubTeam(orgData.githubTeamSlug);
                await ORGS.doc(id).delete();
            } catch (e: any) {
                await ORGS.doc(id).update({ state: 'delete_failed', error: e.message });
                return JSON.stringify({ error: `Deletion failed: ${e.message}` });
            }
            return JSON.stringify({ ok: true, message: 'Organization deleted.' });
        },
    },

    // ── Projects ──
    {
        name: 'list_projects',
        description: 'List all projects, optionally filtered by organization',
        parameters: { orgId: { type: 'string', description: 'Filter by organization ID' } },
        handler: async ({ orgId }: { orgId?: string }) => {
            let query: admin.firestore.Query = PROJECTS;
            if (orgId) query = query.where('orgId', '==', orgId);
            const snap = await query.orderBy('createdAt', 'desc').limit(100).get();
            return JSON.stringify(snap.docs.map(d => ({ id: d.id, ...d.data() })), null, 2);
        },
    },
    {
        name: 'get_project',
        description: 'Get detailed information about a specific project',
        parameters: { id: { type: 'string', description: 'Project ID', required: true } },
        handler: async ({ id }: { id: string }) => {
            const doc = await PROJECTS.doc(id).get();
            if (!doc.exists) return JSON.stringify({ error: 'Project not found.' });
            return JSON.stringify({ id: doc.id, ...doc.data() }, null, 2);
        },
    },
    {
        name: 'get_project_logs',
        description: 'Get provisioning logs for a project',
        parameters: { id: { type: 'string', description: 'Project ID', required: true } },
        handler: async ({ id }: { id: string }) => {
            const logsSnap = await PROJECTS.doc(id).collection('logs').orderBy('serverTimestamp', 'asc').get();
            return JSON.stringify(logsSnap.docs.map(d => ({ id: d.id, ...d.data() })), null, 2);
        },
    },

    // ── Templates ──
    {
        name: 'list_templates',
        description: 'List available project templates',
        parameters: {},
        handler: async () => {
            try {
                const templates = await GithubService.listTemplateRepos();
                return JSON.stringify(templates, null, 2);
            } catch (e: any) {
                return JSON.stringify({ error: e.message });
            }
        },
    },

    // ── Users ──
    {
        name: 'list_users',
        description: 'List all users and their roles',
        parameters: {},
        handler: async () => {
            const snap = await USERS.get();
            return JSON.stringify(snap.docs.map(d => ({
                uid: d.id, email: d.data().email, roles: d.data().roles || {},
            })), null, 2);
        },
    },

    // ── Billing ──
    {
        name: 'get_project_billing',
        description: 'Get billing information and monthly cost for a GCP project',
        parameters: { id: { type: 'string', description: 'Project ID', required: true } },
        handler: async ({ id }: { id: string }) => {
            const doc = await PROJECTS.doc(id).get();
            if (!doc.exists) return JSON.stringify({ error: 'Project not found.' });
            const gcpProjectId = doc.data()?.gcpProjectId || id;
            try {
                const data = await BillingService.getFullBillingData(gcpProjectId);
                return JSON.stringify(data, null, 2);
            } catch (e: any) {
                return JSON.stringify({ error: e.message });
            }
        },
    },

    // ── System ──
    {
        name: 'get_system_health',
        description: 'Check the health of the control plane system',
        parameters: {},
        handler: async () => {
            try {
                await db.collection('_health').doc('ping').set({ ts: new Date().toISOString() }, { merge: true });
                return JSON.stringify({ ok: true, ts: new Date().toISOString(), firestore: 'connected' });
            } catch (e: any) {
                return JSON.stringify({ error: `Health check failed: ${e.message}` });
            }
        },
    },
];

// ────────────────────────────────────────────────────────
// Convert to Gemini Function Declarations
// ────────────────────────────────────────────────────────

function toGeminiFunctionDeclarations(): GeminiTool[] {
    const declarations = AGENT_TOOLS.map(tool => {
        const properties: Record<string, any> = {};
        const required: string[] = [];

        for (const [key, val] of Object.entries(tool.parameters)) {
            properties[key] = {
                type: val.type === 'string' ? FunctionDeclarationSchemaType.STRING :
                    val.type === 'boolean' ? FunctionDeclarationSchemaType.BOOLEAN :
                        val.type === 'array' ? FunctionDeclarationSchemaType.ARRAY :
                            FunctionDeclarationSchemaType.STRING,
                description: val.description,
            };
            if (val.items) properties[key].items = val.items;
            if (val.required) required.push(key);
        }

        return {
            name: tool.name,
            description: tool.description,
            parameters: Object.keys(properties).length > 0 ? {
                type: FunctionDeclarationSchemaType.OBJECT,
                properties,
                ...(required.length > 0 ? { required } : {}),
            } : undefined,
        };
    });

    return [{ functionDeclarations: declarations }];
}

// ────────────────────────────────────────────────────────
// Chat Session Manager
// ────────────────────────────────────────────────────────

interface ChatSession {
    history: Content[];
    lastActive: number;
}

const sessions = new Map<string, ChatSession>();

// Clean up stale sessions every 30 minutes
setInterval(() => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, session] of sessions) {
        if (session.lastActive < cutoff) sessions.delete(id);
    }
}, 30 * 60 * 1000);

const SYSTEM_INSTRUCTION = `You are the WIZBI Control Plane AI Assistant — a helpful infrastructure management agent.

You have access to tools that manage the WIZBI Control Plane, which provisions cloud infrastructure on GCP.

Your capabilities include:
- Listing, creating, and deleting organizations
- Listing, viewing, and managing projects
- Viewing project provisioning logs
- Managing project templates
- Viewing users and their roles
- Checking project billing and costs
- Monitoring system health

When the user asks about their infrastructure, use the available tools to fetch real data.
Present information clearly — use tables and lists when showing multiple items.
For destructive operations (delete), always confirm with the user first by describing what will happen.
Keep responses concise and actionable.`;

// ────────────────────────────────────────────────────────
// Main Chat Function
// ────────────────────────────────────────────────────────

export interface StreamChunk {
    type: 'text' | 'tool_call' | 'tool_result' | 'error' | 'done';
    content: string;
    toolName?: string;
}

export async function* chat(
    message: string,
    sessionId: string,
): AsyncGenerator<StreamChunk> {
    const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '';
    const location = process.env.VERTEX_AI_LOCATION || 'us-central1';

    if (!projectId) {
        yield { type: 'error', content: 'GCP_PROJECT_ID not set. Cannot initialize Vertex AI.' };
        return;
    }

    const vertexAI = new VertexAI({ project: projectId, location });
    const model = vertexAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        systemInstruction: { role: 'system', parts: [{ text: SYSTEM_INSTRUCTION }] },
        tools: toGeminiFunctionDeclarations(),
    });

    // Get or create session
    let session = sessions.get(sessionId);
    if (!session) {
        session = { history: [], lastActive: Date.now() };
        sessions.set(sessionId, session);
    }
    session.lastActive = Date.now();

    // Start chat with history
    const chatSession = model.startChat({ history: session.history });

    try {
        // Send user message
        const result = await chatSession.sendMessage(message);
        let response = result.response;

        // Add user message to history
        session.history.push({ role: 'user', parts: [{ text: message }] });

        // Handle function calling loop
        let maxIterations = 10; // prevent infinite loops
        while (maxIterations-- > 0) {
            const candidate = response.candidates?.[0];
            if (!candidate) break;

            const parts = candidate.content?.parts || [];
            const functionCalls = parts.filter((p: Part) => 'functionCall' in p);

            if (functionCalls.length === 0) {
                // No function calls — extract text from parts
                const textParts = parts.filter((p: Part) => 'text' in p);
                const text = textParts.map((p: any) => p.text).join('');
                if (text) {
                    yield { type: 'text', content: text };
                    session.history.push({ role: 'model', parts: [{ text }] });
                }
                break;
            }

            // Execute function calls
            const functionResponses: Part[] = [];
            const modelParts: Part[] = [];

            for (const part of functionCalls) {
                const fc = (part as any).functionCall;
                const toolName = fc.name;
                const toolArgs = fc.args || {};

                yield { type: 'tool_call', content: JSON.stringify(toolArgs), toolName };

                // Find and execute the tool
                const tool = AGENT_TOOLS.find(t => t.name === toolName);
                let toolResult: string;
                if (tool) {
                    try {
                        toolResult = await tool.handler(toolArgs);
                    } catch (e: any) {
                        toolResult = JSON.stringify({ error: e.message });
                    }
                } else {
                    toolResult = JSON.stringify({ error: `Unknown tool: ${toolName}` });
                }

                yield { type: 'tool_result', content: toolResult, toolName };

                modelParts.push({ functionCall: { name: toolName, args: toolArgs } } as Part);
                functionResponses.push({
                    functionResponse: { name: toolName, response: { result: toolResult } }
                } as Part);
            }

            // Add model's function call + our results to history
            session.history.push({ role: 'model', parts: modelParts });
            session.history.push({ role: 'user', parts: functionResponses });

            // Send function results back to Gemini to get next response
            const followUp = await chatSession.sendMessage(functionResponses);
            response = followUp.response;
        }

        yield { type: 'done', content: '' };
    } catch (e: any) {
        console.error('[agent] Chat error:', e);
        yield { type: 'error', content: e.message || 'An unexpected error occurred.' };
    }
}
