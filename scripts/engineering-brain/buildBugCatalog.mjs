#!/usr/bin/env node
/**
 * buildBugCatalog.mjs — FORGE Engineering Brain: bug / fix catalog.
 *
 * Read-only. Mines the repository's git history for fix-like commits and
 * builds a structured, deterministic catalog of what broke and how it was
 * fixed: commit SHA, date, subject, files touched, linked PR, and a
 * rule-based classification. The Brain consults this catalog when something
 * breaks so it recognizes known failure patterns instead of starting cold.
 *
 * The catalog is a pure function of git history: the same repository state
 * and --as-of value always produce byte-identical output. Only commit
 * subject lines and repo-relative paths are recorded — no bodies, no
 * diffs, no secrets.
 *
 * Usage:
 *   node scripts/engineering-brain/buildBugCatalog.mjs \
 *     --root <repo-root> [--as-of <ISO-8601>] \
 *     [--out <bug-catalog.json>] [--md-out <bug-catalog.md>] \
 *     [--max-records <n>]
 *
 * Exit codes: 0 = catalog written; 2 = bad arguments / git unavailable.
 */

import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export const BUG_CATALOG_VERSION = '1.0.0';
export const DEFAULT_MAX_RECORDS = 1000;

const FIX_SUBJECT_RE = /\bfix(?:es|ed|ing)?\b|\bbug(?:fix)?\b|\brepair(?:ed|s)?\b|\bhotfix\b|\bcorrect(?:s|ed|ing)?\b/i;
const CONVENTIONAL_FIX_RE = /^\s*fix(\(.+\))?[:!]/i;
const REVERT_RE = /^\s*revert\b/i;
const CONVENTIONAL_NONFIX_RE = /^\s*(feat|chore|docs|style|refactor|perf|test|build|ci)(\(.+\))?[:!]/i;
const TEST_RE = /\btest(?:s|ing|ed)?\b/i;
const DOCS_RE = /\bdocs?\b|\breadme\b/i;
const PR_RE = /\(#(\d+)\)|\b[pP]ull request #(\d+)/;

/** Classify a fix-like commit subject. Returns 'fix' | 'revert' | 'test-fix' | 'docs-fix'. */
export function classifyFix(subject) {
  if (REVERT_RE.test(subject)) return 'revert';
  if (TEST_RE.test(subject)) return 'test-fix';
  if (DOCS_RE.test(subject)) return 'docs-fix';
  return 'fix';
}

/** True when the subject line looks like a bug fix or revert. */
export function isFixLike(subject) {
  if (REVERT_RE.test(subject)) return true;
  if (CONVENTIONAL_FIX_RE.test(subject)) return true;
  // A conventional non-fix prefix (feat:, chore:, ...) wins over a stray
  // "fix" later in the subject — e.g. "feat(x): draft fix proposals".
  if (CONVENTIONAL_NONFIX_RE.test(subject)) return false;
  return FIX_SUBJECT_RE.test(subject);
}

/** Extract a PR number from a commit subject, or null. */
export function extractPrNumber(subject) {
  const m = subject.match(PR_RE);
  if (!m) return null;
  return Number(m[1] || m[2]);
}

function runGit(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 60000,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * List fix-like commits: [{ sha, date, subject }], oldest first.
 * Throws when git is unavailable or the directory is not a repo.
 */
export function listFixCommits(root) {
  const out = runGit(root, [
    'log',
    '--format=%H|%aI|%s',
    '--no-merges',
    '--reverse',
  ]).trim();
  if (!out) return [];
  const commits = [];
  for (const line of out.split('\n')) {
    const sep1 = line.indexOf('|');
    const sep2 = line.indexOf('|', sep1 + 1);
    if (sep1 === -1 || sep2 === -1) continue;
    const sha = line.slice(0, sep1);
    const date = line.slice(sep1 + 1, sep2);
    const subject = line.slice(sep2 + 1);
    if (isFixLike(subject)) commits.push({ sha, date, subject });
  }
  return commits;
}

/** Repo-relative files touched by a commit. Returns [] on any failure. */
export function filesForCommit(root, sha) {
  try {
    const out = runGit(root, ['show', '--name-only', '--format=', sha]).trim();
    if (!out) return [];
    return [...new Set(out.split('\n').map((f) => f.trim()).filter(Boolean))].sort();
  } catch {
    return [];
  }
}

export function buildCatalog({ root, maxRecords = DEFAULT_MAX_RECORDS }) {
  const head = runGit(root, ['rev-parse', 'HEAD']).trim();
  const commits = listFixCommits(root).slice(-maxRecords);
  const records = commits.map((c) => ({
    sha: c.sha,
    date: c.date,
    subject: c.subject,
    pr: extractPrNumber(c.subject),
    class: classifyFix(c.subject),
    files: filesForCommit(root, c.sha),
  }));
  return { repoHead: head, records };
}

export function mdCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function formatMarkdownCatalog(result) {
  const out = [];
  out.push(`# FORGE Engineering Brain — bug catalog`);
  out.push(``);
  out.push(`- Generated: ${result.generatedAt}`);
  out.push(`- Repo head: ${String(result.repoHead).slice(0, 10)}`);
  out.push(`- Records: ${result.records.length}`);
  out.push(``);
  out.push(`> What broke and how it was fixed — mined from git history. Subject lines and file paths only.`);
  out.push(``);
  out.push(`| Date | Class | PR | Subject | Files |`);
  out.push(`| --- | --- | --- | --- | --- |`);
  for (const r of result.records) {
    out.push(
      `| ${r.date.slice(0, 10)} | ${r.class} | ${r.pr === null ? '—' : `#${r.pr}`} | ${mdCell(r.subject)} | ${mdCell(r.files.join(', '))} |`,
    );
  }
  out.push(``);
  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    asOf: new Date().toISOString(),
    out: null,
    mdOut: null,
    maxRecords: DEFAULT_MAX_RECORDS,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = (name) => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) {
        console.error(`Missing value for ${name}.`);
        process.exit(2);
      }
      i++;
      return v;
    };
    if (a === '--root') args.root = take(a);
    else if (a === '--as-of') args.asOf = take(a);
    else if (a === '--out') args.out = take(a);
    else if (a === '--md-out') args.mdOut = take(a);
    else if (a === '--max-records') {
      const n = Number(take(a));
      if (!Number.isInteger(n) || n <= 0) {
        console.error('Invalid --max-records value.');
        process.exit(2);
      }
      args.maxRecords = n;
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let catalog;
  try {
    catalog = buildCatalog({ root: args.root, maxRecords: args.maxRecords });
  } catch {
    console.error('Cannot read git history — is this a git repository?');
    process.exit(2);
  }
  const result = {
    tool: 'forge-bug-catalog',
    version: BUG_CATALOG_VERSION,
    generatedAt: args.asOf,
    repoHead: catalog.repoHead,
    recordCount: catalog.records.length,
    records: catalog.records,
  };
  const json = JSON.stringify(result, null, 2) + '\n';
  if (args.out) writeFileSync(args.out, json, 'utf8');
  else process.stdout.write(json);
  if (args.mdOut) writeFileSync(args.mdOut, `${formatMarkdownCatalog(result)}\n`, 'utf8');
  console.error(
    JSON.stringify({ tool: 'forge-bug-catalog', version: BUG_CATALOG_VERSION, records: catalog.records.length }),
  );
}

const invokedAsScript =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`, 'file://').href;
if (invokedAsScript) main();
