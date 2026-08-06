// Vendored copy of the ClaudeRegistry verification checks (standalone mode).
// Source of truth: marketplace repo scripts/verify-plugins.mjs — keep the two
// in sync when the methodology version bumps.
// Static analysis only: reads files under a directory, never executes anything.

import fs from 'node:fs';
import path from 'node:path';

export const METHODOLOGY_VERSION = '1.0';
export const METHODOLOGY_URL = 'https://clauderegistry.com/verification';

const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);

function frontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) out[kv[1].toLowerCase()] = kv[2].trim();
  }
  return out;
}

function walk(dir, base = dir) {
  if (!exists(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}

function checkManifestIntegrity(pluginDir) {
  const problems = [];
  const pj = path.join(pluginDir, '.claude-plugin', 'plugin.json');
  if (!exists(pj)) problems.push('missing .claude-plugin/plugin.json');
  else {
    try {
      const parsed = JSON.parse(read(pj));
      if (!parsed.name) problems.push('plugin.json missing name');
      if (!parsed.version) problems.push('plugin.json missing version');
      if (!parsed.license) problems.push('plugin.json missing license');
      if (!parsed.description) problems.push('plugin.json missing description');
    } catch {
      problems.push('plugin.json is not valid JSON');
    }
  }
  return problems.length
    ? { status: 'fail', detail: problems.join('; ') }
    : {
        status: 'pass',
        detail: 'plugin.json valid and complete (marketplace-entry cross-check runs at submission)',
      };
}

const HOOK_FORBIDDEN = [
  [/\bfetch\s*\(|\bXMLHttpRequest\b|\bhttps?\.request\b|\bnet\.connect\b|\bWebSocket\b/, 'network call'],
  [/\bwriteFileSync?\s*\(|\bappendFileSync?\s*\(|\bcreateWriteStream\b|\bunlinkSync?\s*\(|\brmSync\s*\(/, 'filesystem write'],
  [/\.env\b|\bid_rsa\b|\.aws\b|credentials/i, 'credential/env access'],
  [/\beval\s*\(|\bFunction\s*\(/, 'dynamic code evaluation'],
];

const SUBPROCESS_ALLOWLIST = [
  'git rev-parse', 'git diff', 'git describe', 'git rev-list', 'git status',
  'git log', 'git branch', 'git ls-files', 'git tag', 'git show', 'git config --get',
];

function analyzeSubprocess(src, rel) {
  const problems = [];
  if (!/\bchild_process\b|\bexecSync?\s*\(|\bspawnSync?\s*\(|\bexecFile\b/.test(src)) {
    return { problems };
  }
  if (/(?:sh|exec\w*|spawn\w*)\s*\(\s*`[^`]*\$\{/.test(src)) {
    problems.push(`${rel}: subprocess command built dynamically from interpolated input`);
  }
  const literals = [...src.matchAll(/\b(?:sh|execSync|execFileSync)\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const cmd of literals) {
    if (!SUBPROCESS_ALLOWLIST.some((a) => cmd.startsWith(a))) {
      problems.push(`${rel}: non-allowlisted subprocess command "${cmd}"`);
    }
  }
  if (literals.length === 0 && problems.length === 0) {
    problems.push(`${rel}: subprocess used but commands not statically resolvable`);
  }
  return { problems };
}

function checkHookSafety(pluginDir) {
  const hj = path.join(pluginDir, 'hooks', 'hooks.json');
  if (!exists(hj)) return { status: 'n/a', detail: 'no hooks' };
  const problems = [];
  let config;
  try {
    config = JSON.parse(read(hj));
  } catch {
    return { status: 'fail', detail: 'hooks.json is not valid JSON' };
  }
  const cmds = JSON.stringify(config).match(/\$\{CLAUDE_PLUGIN_ROOT\}[^"\\]*/g) ?? [];
  const scripts = cmds.map((c) => c.replace('${CLAUDE_PLUGIN_ROOT}', '').replace(/^[\\/]/, ''));
  if (scripts.length === 0) problems.push('hooks.json references no ${CLAUDE_PLUGIN_ROOT} script');
  for (const rel of scripts) {
    const sp = path.join(pluginDir, rel);
    if (!exists(sp)) {
      problems.push(`referenced script missing: ${rel}`);
      continue;
    }
    const src = read(sp);
    for (const [re, label] of HOOK_FORBIDDEN) {
      if (re.test(src)) problems.push(`${rel}: ${label}`);
    }
    problems.push(...analyzeSubprocess(src, rel).problems);
    if (!/process\.exit\(0\)/.test(src)) problems.push(`${rel}: no unconditional exit(0) fail-safe`);
    if (!/catch/.test(src)) problems.push(`${rel}: no try/catch fail-safe`);
  }
  return problems.length
    ? { status: 'fail', detail: problems.join('; ') }
    : {
        status: 'pass',
        detail: `${scripts.length} hook script(s): advisory-only, no network, no fs writes, no credential access, subprocess (if any) limited to constant read-only git commands, fail-safe exit(0)`,
      };
}

function checkAgentToolScope(pluginDir) {
  const files = walk(path.join(pluginDir, 'agents')).filter((f) => f.endsWith('.md'));
  if (files.length === 0) return { status: 'n/a', detail: 'no agents' };
  const problems = [];
  for (const f of files) {
    const fm = frontmatter(read(path.join(pluginDir, 'agents', f)));
    if (!fm) {
      problems.push(`${f}: no frontmatter`);
      continue;
    }
    const tools = fm.tools ?? '';
    if (!tools) {
      problems.push(`${f}: no explicit tools restriction (inherits everything)`);
      continue;
    }
    const readOnlyByName = /audit|analyz|review|scan|report|read-only|checker/i.test(f + (fm.description ?? ''));
    const hasWrite = /"(Write|Edit)"/.test(tools);
    const isRemediator = /reconcil|migrat|remediat|fix|harden|writer|writ(e|ing)|generat|author|apply/i.test(
      f + (fm.description ?? '')
    );
    if (readOnlyByName && hasWrite && !isRemediator) {
      problems.push(`${f}: analysis-type agent declares Write/Edit`);
    }
  }
  return problems.length
    ? { status: 'fail', detail: problems.join('; ') }
    : { status: 'pass', detail: `all ${files.length} agent(s) declare explicit least-privilege tools` };
}

function checkCommandHygiene(pluginDir) {
  const files = walk(path.join(pluginDir, 'commands')).filter((f) => f.endsWith('.md'));
  if (files.length === 0) return { status: 'n/a', detail: 'no commands' };
  const problems = [];
  for (const f of files) {
    const fm = frontmatter(read(path.join(pluginDir, 'commands', f)));
    if (!fm) problems.push(`${f}: no frontmatter`);
    else if (!fm.description) problems.push(`${f}: no description`);
  }
  return problems.length
    ? { status: 'fail', detail: problems.join('; ') }
    : { status: 'pass', detail: `all ${files.length} command(s) carry frontmatter with a description` };
}

function checkSkillStructure(pluginDir) {
  const skillsDir = path.join(pluginDir, 'skills');
  if (!exists(skillsDir)) return { status: 'n/a', detail: 'no skills' };
  const problems = [];
  let count = 0;
  for (const e of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    count++;
    const sk = path.join(skillsDir, e.name, 'SKILL.md');
    if (!exists(sk)) {
      problems.push(`${e.name}: missing SKILL.md`);
      continue;
    }
    const fm = frontmatter(read(sk));
    if (!fm?.name || !fm?.description) problems.push(`${e.name}: SKILL.md missing name/description frontmatter`);
    const refs = read(sk).match(/references\/[A-Za-z0-9._-]+\.md/g) ?? [];
    for (const r of new Set(refs)) {
      if (!exists(path.join(skillsDir, e.name, r))) problems.push(`${e.name}: referenced ${r} missing`);
    }
  }
  return problems.length
    ? { status: 'fail', detail: problems.join('; ') }
    : { status: 'pass', detail: `all ${count} skill(s) have valid SKILL.md and every referenced reference file exists` };
}

const SECRET_PATTERNS = [
  [/AKIA[0-9A-Z]{16}/, 'AWS access key', 'all'],
  [/\bsk-[A-Za-z0-9]{20,}/, 'API secret key', 'all'],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token', 'all'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\s]{40,}/, 'private key', 'all'],
  [/\bpassword\s*=\s*["'][^"']{6,}["']/i, 'hardcoded password', 'code'],
];

function checkNoSecrets(pluginDir) {
  const hits = [];
  for (const f of walk(pluginDir)) {
    if (!/\.(md|json|mjs|js|cjs|ts|py|sh|yaml|yml)$/.test(f)) continue;
    const isDoc = f.endsWith('.md');
    const src = read(path.join(pluginDir, f));
    for (const [re, label, scope] of SECRET_PATTERNS) {
      if (scope === 'code' && isDoc) continue;
      const m = src.match(re);
      if (m && !/example|placeholder|redact|xxxx|your[-_]/i.test(src.slice(Math.max(0, m.index - 80), m.index + 80))) {
        hits.push(`${f}: ${label}`);
      }
    }
  }
  return hits.length
    ? { status: 'fail', detail: hits.join('; ') }
    : { status: 'pass', detail: 'no credentials or secrets in any plugin file' };
}

function checkDocs(pluginDir) {
  const rd = path.join(pluginDir, 'README.md');
  if (!exists(rd)) return { status: 'fail', detail: 'no README.md' };
  const src = read(rd);
  const problems = [];
  if (!/\/plugin install /.test(src)) problems.push('README has no install command');
  if (src.length < 500) problems.push('README too thin to document the plugin');
  return problems.length
    ? { status: 'fail', detail: problems.join('; ') }
    : { status: 'pass', detail: 'README documents purpose, installation, and usage' };
}

const CHECKS = [
  ['manifest-integrity', 'Manifest integrity', checkManifestIntegrity],
  ['hook-safety', 'Hook safety', checkHookSafety],
  ['agent-tool-scope', 'Agent tool scopes', checkAgentToolScope],
  ['command-hygiene', 'Command hygiene', checkCommandHygiene],
  ['skill-structure', 'Skill structure', checkSkillStructure],
  ['no-secrets', 'No secrets', checkNoSecrets],
  ['docs', 'Documentation', checkDocs],
];

export function runChecksOnDir(pluginDir) {
  const checks = [];
  let ok = true;
  for (const [id, title, fn] of CHECKS) {
    let r;
    try {
      r = fn(pluginDir);
    } catch (err) {
      r = { status: 'fail', detail: `check crashed: ${String(err.message ?? err).slice(0, 120)}` };
    }
    checks.push({ id, title, ...r });
    if (r.status === 'fail') ok = false;
  }
  return { ready: ok, checks };
}
