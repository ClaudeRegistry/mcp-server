// buildServer(): create an McpServer with the catalog tools registered:
// search_plugins, get_plugin, list_categories, search_skills, get_skill,
// and the local-recipe verify_plugin.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { searchPlugins, getPlugin, listCategories, searchSkills, getSkill } from './catalog.js';

// Shared read-only annotations: these tools never mutate anything, always
// return the same result for the same input, and operate over the bounded
// Sigistry catalog (a closed domain, not an open world).
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
      'verification status: "verified" (passed the eight-check security methodology), "stale" (verified at a pinned commit the repo has since moved past), "listed" (in the registry but not audited), "failed", or "unknown". Prefer verified plugins. Methodology: https://sigistry.com/verification'
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

// Output shape of a single skill search hit.
const skillHitSchema = z.object({
  name: z.string().describe('stable skill name, e.g. "assessment-scoring"'),
  description: z.string().describe('the skill trigger: when an agent should load it'),
  plugin: z.string().describe('parent plugin id that ships this skill'),
  verification: z.string().describe('verification status of the parent plugin; prefer "verified"'),
  installCommand: z.string().describe('Claude Code command installing the parent plugin (skill loads automatically)'),
  detailUrl: z.string().describe('human-readable page for this skill'),
});

export function buildServer() {
  const server = new McpServer({ name: 'sigistry', version: '1.5.0' });

  server.registerTool(
    'search_plugins',
    {
      title: 'Search Claude Code plugins',
      description:
        'Search the Sigistry marketplace of Claude Code plugins by keyword and/or category. Returns matches with their install command and verification status (the registry runs an eight-check security audit; prefer "verified" plugins when recommending an install).',
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
        'Get the full details of a single Sigistry plugin by its id, including install commands, component counts, and its security-audit result (per-check pass/fail from the Verified by Sigistry methodology).',
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
        'List the distinct plugin categories in the Sigistry marketplace with a count of plugins in each, plus the total plugin count.',
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
    'search_skills',
    {
      title: 'Search verified Claude Code skills',
      description:
        'Search the Sigistry catalog of verified skills (SKILL.md instruction sets for AI agents) by keyword, optionally filtered to one parent plugin. Every skill passed the skill-safety check: no command shadowing, honestly-scoped triggers, no injection or concealment language, no unsafe scripts. Use get_skill to fetch the full portable source of a match.',
      inputSchema: {
        query: z.string().optional().describe('keywords, e.g. "changelog" or "security review"'),
        plugin: z.string().optional().describe('restrict to skills shipped by this plugin id'),
      },
      outputSchema: {
        results: z.array(skillHitSchema).describe('up to 20 matching skills, best matches first'),
      },
      annotations: { title: 'Search verified skills', ...READ_ONLY },
    },
    async ({ query, plugin }) => {
      const results = await searchSkills(query, plugin);
      return {
        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        structuredContent: { results },
      };
    }
  );

  server.registerTool(
    'get_skill',
    {
      title: 'Get a verified skill (with portable source)',
      description:
        'Get one Sigistry skill by name, including the full raw SKILL.md source. The source is portable: it can be applied directly in any SKILL.md-aware agent (Claude Code, Claude Desktop, and others) without installing anything, or installed natively in Claude Code via the parent plugin, which keeps it verified and updated. The returned skill passed the Sigistry skill-safety check at the parent plugin\'s verification date.',
      inputSchema: {
        name: z.string().describe('the skill name, e.g. "assessment-scoring" (find names via search_skills)'),
      },
      outputSchema: {
        ...skillHitSchema.shape,
        pluginCategory: z.string().nullable().describe('category of the parent plugin'),
        verifiedDate: z.string().nullable().describe('date of the verification run covering this skill'),
        hosting: z.string().describe('"registry" (vendored here) or "external" (author repo, verified at a pinned commit)'),
        repo: z.string().optional().describe('author repo (owner/name), when externally hosted'),
        commit: z.string().optional().describe('pinned commit the source is served from, when externally hosted'),
        sourceUrl: z.string().describe('GitHub location of the skill directory'),
        source: z
          .string()
          .nullable()
          .describe('the complete raw SKILL.md (frontmatter + body); null only if the fetch failed'),
      },
      annotations: { title: 'Get a verified skill', ...READ_ONLY },
    },
    async ({ name }) => {
      const skill = await getSkill(name);
      if (!skill) {
        const msg = {
          error: 'not_found',
          message: `No skill named "${name}". Use search_skills to discover available skill names.`,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(msg, null, 2) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(skill, null, 2) }],
        structuredContent: skill,
      };
    }
  );

  // verify_plugin deliberately does NO server-side work. It returns the
  // recipe for the calling agent to run the open-source verifier ON THE
  // USER'S MACHINE: the plugin's code never leaves their computer, the check
  // results come from the same script that gates the Verified badge, and the
  // server never fetches, stores, or executes anything on anyone's behalf.
  const VERIFIER_RAW_URL =
    'https://raw.githubusercontent.com/Sigistry/marketplace/main/scripts/verify-plugins.mjs';

  server.registerTool(
    'verify_plugin',
    {
      title: 'Verify a Claude Code plugin (pre-publish, runs locally)',
      description:
        'Get the recipe to run the Sigistry verification methodology (the eight static checks that gate the Verified badge: manifest integrity, hook safety, agent tool scopes, command hygiene, skill structure, skill safety, no secrets, documentation) against a plugin BEFORE publishing it. The verification runs entirely on the local machine via a dependency-free open-source Node script; the plugin code never leaves the user\'s computer and this server performs no computation. Call this when the user wants their plugin or skill checked, then follow the returned steps: download the script, run it against the plugin directory, and fix any FAIL findings it reports.',
      inputSchema: {
        pluginPath: z
          .string()
          .optional()
          .describe('local path to the plugin directory, used to fill in the run command (optional)'),
      },
      outputSchema: {
        runsWhere: z.string().describe('always "local": verification executes on the user\'s machine'),
        methodologyVersion: z.string(),
        methodologyUrl: z.string(),
        checks: z
          .array(z.object({ id: z.string(), title: z.string(), what: z.string() }))
          .describe('the eight checks the script will run'),
        steps: z.array(z.string()).describe('what the agent should do, in order'),
        commands: z.object({
          macos_linux: z.string().describe('download + run one-liner for bash/zsh'),
          windows: z.string().describe('download + run one-liner for PowerShell'),
          alternative_clone: z.string().describe('equivalent via cloning the marketplace repo'),
        }),
        interpreting: z.string(),
        nextSteps: z.string(),
      },
      annotations: {
        title: 'Verify a Claude Code plugin',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ pluginPath }) => {
      const target = pluginPath && pluginPath.trim() ? pluginPath.trim() : 'path/to/your-plugin';
      const result = {
        runsWhere: 'local',
        methodologyVersion: '1.2',
        methodologyUrl: 'https://sigistry.com/verification',
        checks: [
          { id: 'manifest-integrity', title: 'Manifest integrity', what: 'plugin.json valid and complete (name, version, license, description)' },
          { id: 'hook-safety', title: 'Hook safety', what: 'hooks are advisory-only and fail-safe: no network, no fs writes, no credential access, no dynamic evaluation; subprocess only for constant read-only git commands' },
          { id: 'agent-tool-scope', title: 'Agent tool scopes', what: 'every subagent declares an explicit least-privilege tools list; analysis agents carry no Write/Edit' },
          { id: 'command-hygiene', title: 'Command hygiene', what: 'every command has frontmatter with a description' },
          { id: 'skill-structure', title: 'Skill structure', what: 'skills/<name>/SKILL.md with name+description; referenced reference files exist' },
          { id: 'skill-safety', title: 'Skill safety', what: 'no command shadowing, honestly-scoped triggers, no injection or concealment language, no unsafe scripts (pipe-to-shell, hidden payloads, credential access)' },
          { id: 'no-secrets', title: 'No secrets', what: 'no credentials, keys, or tokens anywhere in the plugin' },
          { id: 'docs', title: 'Documentation', what: 'a substantive README with the registry install commands' },
        ],
        steps: [
          'Download the verifier script (a single dependency-free Node file, static analysis only; feel free to read it before running).',
          `Run it against the plugin directory (Node 18+ required): it prints PASS/FAIL per check with the exact file and problem for every failure.`,
          'Fix any FAIL findings and re-run until the script reports verification-ready (exit code 0).',
          'Offer the user the next step: submit to the registry to earn the Verified badge.',
        ],
        commands: {
          macos_linux: `curl -fsSL ${VERIFIER_RAW_URL} -o /tmp/cr-verify.mjs && node /tmp/cr-verify.mjs "${target}"`,
          windows: `iwr ${VERIFIER_RAW_URL} -OutFile $env:TEMP\\cr-verify.mjs; node $env:TEMP\\cr-verify.mjs "${target}"`,
          alternative_clone: `git clone https://github.com/Sigistry/marketplace && node marketplace/scripts/verify-plugins.mjs "${target}"`,
        },
        interpreting:
          'Exit code 0 means all applicable checks passed (verification-ready). Each FAIL line names the file and the exact problem; n/a means the plugin has no such component (e.g. no hooks). The same script, run by registry CI, gates the Verified badge on submission.',
        nextSteps:
          'When verification-ready: submit via PR to github.com/Sigistry/marketplace (see CONTRIBUTING.md). Vendor under plugins/<name>/ for the Verified tier, or keep the repo external and add a commit pin for Verified-at-commit. Details: https://sigistry.com/verification',
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  return server;
}
