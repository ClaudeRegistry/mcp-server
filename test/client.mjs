import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const base = process.env.MCP_URL || 'http://localhost:8787/mcp';
const client = new Client({ name: 'smoke-test', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(base)));

console.log('tools:', (await client.listTools()).tools.map((t) => t.name));
console.log(
  'list_categories:',
  (await client.callTool({ name: 'list_categories', arguments: {} })).content[0]
    .text
);
console.log(
  'search:',
  (
    await client.callTool({
      name: 'search_plugins',
      arguments: { query: 'migration' },
    })
  ).content[0].text
);
console.log(
  'get_plugin:',
  (
    await client.callTool({
      name: 'get_plugin',
      arguments: { id: 'sql-safety-net' },
    })
  ).content[0].text
);

await client.close();
