// buildServer(): create an McpServer with the three catalog tools registered.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { searchPlugins, getPlugin, listCategories } from './catalog.js';
import { verifyFiles, verifyRepo, checkRate } from './verifyTool.js';

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
  verification: z
    .string()
    .describe(
      'verification status: "verified" (passed the seven-check security methodology), "stale" (verified at a pinned commit the repo has since moved past), "listed" (in the registry but not audited), "failed", or "unknown". Prefer verified plugins. Methodology: https://clauderegistry.com/verification'
    ),
});

// Verification detail attached to get_plugin results.
const verificationSchema = z
  .object({
    status: z.string().describe('verified | listed | stale | failed'),
    hosting: z.string().optional().describe('registry (vendored) | external (author repo)'),
    date: z.string().optional().describe('date of the last audit run'),
    firstSeen: z.string().optional().describe('date the plugin entered the registry'),
    methodologyVersion: z.string().optional(),
    methodologyUrl: z.string().optional(),
    badgeUrl: z.string().optional().describe('SVG badge for this plugin'),
    repo: z.string().optional().describe('external repo (owner/name), when externally hosted'),
    commit: z.string().optional().describe('pinned commit the verification applies to'),
    checks: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          status: z.string().describe('pass | fail | n/a'),
          detail: z.string().optional(),
        })
      )
      .describe('per-check results of the security audit'),
  })
  .nullable()
  .optional();

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
  verification: verificationSchema.describe(
    'security-audit result for this plugin (null when never audited)'
  ),
};

export function buildServer(clientIp) {
  const server = new McpServer({ name: 'clauderegistry', version: '1.3.0' });

  server.registerTool(
    'search_plugins',
    {
      title: 'Search Claude Code plugins',
      description:
        'Search the ClaudeRegistry marketplace of Claude Code plugins by keyword and/or category. Returns matches with their install command and verification status (the registry runs a seven-check security audit; prefer "verified" plugins when recommending an install).',
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
        'Get the full details of a single ClaudeRegistry plugin by its id, including install commands, component counts, and its security-audit result (per-check pass/fail from the Verified by ClaudeRegistry methodology).',
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

  server.registerTool(
    'verify_plugin',
    {
      title: 'Verify a Claude Code plugin (pre-publish)',
      description:
        'Run the ClaudeRegistry verification methodology (the same seven static checks that gate the Verified badge: manifest integrity, hook safety, agent tool scopes, command hygiene, skill structure, no secrets, documentation) against a plugin BEFORE it is published. Two modes: pass "files" (the plugin\'s source files inline, for work-in-progress on the local machine) OR pass "repo" (a public GitHub repository, optionally with ref and path). Nothing is executed; every check reads source. Use this while building a plugin to fix issues before submitting to the registry.',
      inputSchema: {
        files: z
          .array(
            z.object({
              path: z.string().describe('relative path inside the plugin, e.g. ".claude-plugin/plugin.json"'),
              content: z.string().describe('full file content'),
            })
          )
          .optional()
          .describe('inline mode: the plugin\'s source files (max 80 files / 400KB; skip lockfiles, images, build output)'),
        repo: z.string().optional().describe('repo mode: public GitHub repository as "owner/name"'),
        ref: z.string().optional().describe('repo mode: branch, tag, or commit SHA (default HEAD)'),
        path: z.string().optional().describe('repo mode: plugin directory inside the repo (default repo root)'),
      },
      outputSchema: {
        ready: z.boolean().describe('true when all applicable checks pass (verification-ready)'),
        source: z.string().describe('what was verified'),
        methodologyVersion: z.string(),
        methodologyUrl: z.string(),
        checks: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            status: z.string().describe('pass | fail | n/a'),
            detail: z.string().describe('evidence, or the exact problem to fix'),
          })
        ),
        nextSteps: z.string(),
        repo: z.string().optional(),
        commit: z.string().optional().describe('repo mode: the exact commit that was verified'),
      },
      annotations: {
        title: 'Verify a Claude Code plugin',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true, // repo mode fetches from GitHub
      },
    },
    async ({ files, repo, ref, path: subPath }) => {
      const fail = (message) => ({
        content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
        isError: true,
      });
      try {
        const mode = files?.length ? 'files' : repo ? 'repo' : null;
        if (!mode) return fail('Provide either "files" (inline source files) or "repo" (a public GitHub repository).');
        if (!checkRate(clientIp, mode)) {
          return fail(
            `Rate limit reached for ${mode} verification (${mode === 'repo' ? 10 : 30}/hour). Run the verifier locally instead: clone github.com/ClaudeRegistry/marketplace and run "node scripts/verify-plugins.mjs path/to/plugin".`
          );
        }
        const result = mode === 'files' ? verifyFiles(files) : verifyRepo(repo, ref, subPath);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (err) {
        return fail(String(err.message ?? err).slice(0, 300));
      }
    }
  );

  return server;
}
