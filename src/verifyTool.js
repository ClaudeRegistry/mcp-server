// verify_plugin tool backend: materialize a plugin (inline files or a shallow
// GitHub clone) into a temp dir and run the vendored verification checks.
// Hard caps + per-IP rate limiting: this is an authless public endpoint.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { runChecksOnDir, METHODOLOGY_VERSION, METHODOLOGY_URL } from './verify.js';

// ---- caps -----------------------------------------------------------------
const MAX_FILES = 80;
const MAX_TOTAL_BYTES = 400 * 1024; // inline mode
const MAX_FILE_PATH_LEN = 200;
const CLONE_TIMEOUT_MS = 60 * 1000;
const MAX_CLONE_BYTES = 25 * 1024 * 1024; // post-clone size guard

// ---- per-IP rate limiting (in-memory; single-instance server) -------------
const WINDOW_MS = 60 * 60 * 1000;
const LIMITS = { files: 30, repo: 10 };
const buckets = new Map(); // `${ip}:${mode}` -> [timestamps]

export function checkRate(ip, mode) {
  const key = `${ip || 'unknown'}:${mode}`;
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= LIMITS[mode]) return false;
  arr.push(now);
  buckets.set(key, arr);
  // Opportunistic cleanup so the map cannot grow unbounded.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t >= WINDOW_MS)) buckets.delete(k);
    }
  }
  return true;
}

// ---- helpers --------------------------------------------------------------
function safeRelPath(p) {
  if (typeof p !== 'string' || !p || p.length > MAX_FILE_PATH_LEN) return null;
  const norm = p.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) return null;
  const parts = norm.split('/');
  if (parts.some((seg) => seg === '' || seg === '.' || seg === '..')) return null;
  if (parts.some((seg) => !/^[\w.@ -]+$/.test(seg))) return null;
  return parts.join(path.sep);
}

function dirSize(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.name === '.git') continue;
    total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
    if (total > MAX_CLONE_BYTES) return total;
  }
  return total;
}

function finish(dir, sourceLabel) {
  const { ready, checks } = runChecksOnDir(dir);
  return {
    ready,
    source: sourceLabel,
    methodologyVersion: METHODOLOGY_VERSION,
    methodologyUrl: METHODOLOGY_URL,
    checks,
    nextSteps: ready
      ? 'Verification-ready. Submit via PR to github.com/ClaudeRegistry/marketplace (see CONTRIBUTING.md): vendor under plugins/<name>/ for the Verified tier, or add a commit pin for Verified-at-commit.'
      : 'Fix the FAIL items above and run verify_plugin again. Each detail names the file and the exact problem.',
  };
}

// ---- inline files mode ----------------------------------------------------
export function verifyFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('files must be a non-empty array of { path, content }');
  }
  if (files.length > MAX_FILES) {
    throw new Error(`too many files (max ${MAX_FILES}); send the plugin's source files only`);
  }
  let total = 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crv-'));
  try {
    for (const f of files) {
      const rel = safeRelPath(f?.path);
      if (!rel) throw new Error(`invalid file path: ${JSON.stringify(f?.path ?? null)}`);
      const content = String(f?.content ?? '');
      total += Buffer.byteLength(content);
      if (total > MAX_TOTAL_BYTES) {
        throw new Error(`total payload exceeds ${Math.round(MAX_TOTAL_BYTES / 1024)}KB; send source files only (skip lockfiles, images, build output)`);
      }
      const dest = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content);
    }
    return finish(tmp, `${files.length} inline file(s)`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- GitHub repo mode -----------------------------------------------------
export function verifyRepo(repo, ref, subPath) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) {
    throw new Error('repo must be "owner/name" on GitHub');
  }
  const cleanRef = ref ? String(ref) : 'HEAD';
  if (!/^[\w][\w./-]{0,99}$/.test(cleanRef)) {
    throw new Error('ref must be a branch, tag, or commit SHA');
  }
  let cleanSub = '.';
  if (subPath) {
    const rel = safeRelPath(String(subPath));
    if (!rel) throw new Error('path must be a relative path inside the repo');
    cleanSub = rel;
  }

  const url = `https://github.com/${repo}.git`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crv-'));
  const git = (args, opts = {}) =>
    execFileSync('git', args, {
      cwd: tmp,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: CLONE_TIMEOUT_MS,
      ...opts,
    });
  try {
    git(['init', '-q']);
    git(['remote', 'add', 'origin', url]);
    git(['fetch', '-q', '--depth', '1', 'origin', cleanRef]);
    git(['checkout', '-q', 'FETCH_HEAD']);
    if (dirSize(tmp) > MAX_CLONE_BYTES) {
      throw new Error('repository too large to verify remotely; run the verifier locally instead');
    }
    const target = path.join(tmp, cleanSub);
    if (!fs.existsSync(target)) {
      throw new Error(`path "${cleanSub}" not found in ${repo}@${cleanRef}`);
    }
    const commit = git(['rev-parse', 'HEAD']).trim();
    const result = finish(target, `github.com/${repo}@${commit.slice(0, 7)}${cleanSub === '.' ? '' : `:${cleanSub}`}`);
    return { ...result, repo, commit };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
