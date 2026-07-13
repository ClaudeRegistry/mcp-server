// buildServer(): create an McpServer with the three catalog tools registered.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { searchPlugins, getPlugin, listCategories } from './catalog.js';

export function buildServer() {
  const server = new McpServer({ name: 'clauderegistry', version: '1.0.0' });

  server.registerTool(
    'search_plugins',
    {
      title: 'Search Claude Code plugins',
      description:
        'Search the ClaudeRegistry marketplace of Claude Code plugins by keyword and/or category. Returns matches with their install command.',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe('keywords, e.g. "database migration"'),
        category: z
          .string()
          .optional()
          .describe('e.g. "database", "devops", "git"'),
      },
    },
    async ({ query, category }) => {
      const results = await searchPlugins(query, category);
      return {
        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        structuredContent: { results },
      };
    }
  );

  server.registerTool(
    'get_plugin',
    {
      title: 'Get a Claude Code plugin',
      description:
        'Get the full details of a single ClaudeRegistry plugin by its id, including install commands and component counts.',
      inputSchema: {
        id: z
          .string()
          .describe('the plugin id, e.g. "sql-safety-net"'),
      },
    },
    async ({ id }) => {
      const plugin = await getPlugin(id);
      if (!plugin) {
        const msg = {
          error: 'not_found',
          message: `No plugin found with id "${id}". Use search_plugins to discover available plugin ids.`,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(msg, null, 2) }],
          structuredContent: msg,
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(plugin, null, 2) }],
        structuredContent: plugin,
      };
    }
  );

  server.registerTool(
    'list_categories',
    {
      title: 'List plugin categories',
      description:
        'List the distinct plugin categories in the ClaudeRegistry marketplace with a count of plugins in each, plus the total plugin count.',
      inputSchema: {},
    },
    async () => {
      const result = await listCategories();
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  return server;
}
