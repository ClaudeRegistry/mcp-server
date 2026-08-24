// HTTP wiring: stateless Streamable HTTP MCP server behind Express.

import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { buildServer } from './server.js';

const app = express();
app.use(express.json());

// Permissive CORS for a public read-only server.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Mcp-Session-Id, Mcp-Protocol-Version'
  );
  res.set('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.post('/mcp', async (req, res) => {
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal error' },
        id: null,
      });
    }
  }
});

app.get('/mcp', (_req, res) =>
  res
    .status(405)
    .set('Allow', 'POST')
    .json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message:
          'Method Not Allowed. Use POST for MCP; this is a stateless server.',
      },
      id: null,
    })
);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/', (_req, res) =>
  res
    .type('text/plain')
    .send(
      'Sigistry MCP server. POST /mcp (Streamable HTTP). Tools: search_plugins, get_plugin, list_categories, verify_plugin.'
    )
);

const PORT = process.env.PORT || 8787;
app.listen(PORT, () =>
  console.log(`Sigistry MCP server on :${PORT}/mcp`)
);
