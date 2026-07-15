// buildServer(): create an McpServer with the three catalog tools registered.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { searchPlugins, getPlugin, listCategories } from './catalog.js';

// Shared read-only annotations: these tools never mutate anything, always
// return the same result for the same input, and operate over the bounded
// ClaudeRegistry catalog (a closed domain, not an open world).
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

// Output shape of a single search hit (a trimmed plugin summary).
const searchHitSchema = z.object({
  id: z.string().describe('stable plugin id, e.g. "sql-safety-net"'),
  name: z.string().describe('human-readable plugin name'),
  description: z.string().optional().describe('one-line summary'),
  category: z.string().optional().describe('marketplace category'),
  installCommand: z.string().describe('Claude Code install command'),
});

// Output shape of a full plugin record (get_plugin).
const pluginSchema = {
  id: z.string(),
  name: z.string(),
  version: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).describe('keywords from the marketplace entry'),
  author: z
    .object({ name: z.string().optional(), url: z.string().optional() })
    .optional(),
  license: z.string().optional(),
  commands: z.array(z.string()).describe('relative paths to command files'),
  agents: z.array(z.string()).describe('relative paths to agent files'),
  skills: z.array(z.string()).describe('relative paths to skill manifests'),
  counts: z
    .object({
      commands: z.number().int(),
      agents: z.number().int(),
      skills: z.number().int(),
    })
    .describe('component counts'),
  homepage: z.string().optional(),
  installMarketplace: z
    .string()
    .describe('command to add the marketplace to Claude Code'),
  installCommand: z.string().describe('command to install this plugin'),
  searchableText: z.string().describe('lowercased text used for matching'),
};

export function buildServer() {
  const server = new McpServer({ name: 'clauderegistry', version: '1.1.0' });

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
      outputSchema: {
        results: z
          .array(searchHitSchema)
          .describe('up to 15 matching plugins, best matches first'),
      },
      annotations: { title: 'Search Claude Code plugins', ...READ_ONLY },
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
      outputSchema: pluginSchema,
      annotations: { title: 'Get a Claude Code plugin', ...READ_ONLY },
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
      outputSchema: {
        categories: z
          .array(
            z.object({
              category: z.string(),
              count: z.number().int().describe('plugins in this category'),
            })
          )
          .describe('categories sorted by descending plugin count'),
        total: z.number().int().describe('total number of plugins'),
      },
      annotations: { title: 'List plugin categories', ...READ_ONLY },
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
