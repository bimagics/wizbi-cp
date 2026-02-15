// src/mcp/index.ts
// Built-in MCP Server — makes wizbi-cp agent-ready from day one.
// Exposes all Control Plane operations as MCP tools and resources.
// Transport: Streamable HTTP on /api/mcp (compatible with all MCP clients).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { Express, Request, Response } from 'express';
import { registerTools } from './tools';
import { registerResources } from './resources';
import { log } from '../middleware/auth';

/**
 * Creates and configures the MCP server, then mounts it on the Express app.
 * The server is available at:
 *   - GET  /api/mcp/sse  — SSE connection endpoint
 *   - POST /api/mcp/messages — Message endpoint for MCP protocol
 */
export function mountMcpServer(app: Express): void {
    const server = new McpServer({
        name: 'wizbi-control-plane',
        version: '1.0.0',
    });

    // Register all tools and resources
    registerTools(server);
    registerResources(server);

    // Track active transports by session
    const transports: Record<string, SSEServerTransport> = {};

    // SSE connection endpoint
    app.get('/api/mcp/sse', async (req: Request, res: Response) => {
        log('mcp.sse.connect', { ip: req.ip });

        const transport = new SSEServerTransport('/api/mcp/messages', res);
        transports[transport.sessionId] = transport;

        res.on('close', () => {
            log('mcp.sse.disconnect', { sessionId: transport.sessionId });
            delete transports[transport.sessionId];
        });

        await server.connect(transport);
    });

    // Message endpoint for MCP protocol
    app.post('/api/mcp/messages', async (req: Request, res: Response) => {
        const sessionId = req.query.sessionId as string;
        const transport = transports[sessionId];

        if (!transport) {
            return res.status(400).json({ error: 'Unknown session. Connect to /api/mcp/sse first.' });
        }

        await transport.handlePostMessage(req, res);
    });

    log('mcp.server.mounted', { endpoints: ['/api/mcp/sse', '/api/mcp/messages'] });
}
