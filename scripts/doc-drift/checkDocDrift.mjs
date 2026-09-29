#!/usr/bin/env node
/**
 * checkDocDrift.mjs — FORGE document freshness drift detector (Phase 1, read-only).
 *
 * Measures three SEPARATE concerns and never mixes them:
 *   (a) governance authority/approval — NOT measured here (owner decision only);
 *   (b) source-to-index synchronization — C1 (committed snapshot) and C2 (live index);
 *   (c) document-content drift — C3 (internal link resolution) and C4 (review-age signal).
 *
 * States: CURRENT (one specified check passed) / STALE (demonstrated mismatch) /
 * REVIEW_PENDING (needs human semantic judgment) / UNKNOWN (provenance unavailable).
 * Age alone never yields STALE. No composite document rating is produced.
 *
 * Data boundary: the detector scans file paths, link targets, SHAs, and timestamps
 * only. Report artifacts contain repo-relative paths and sanitized link targets
 * only — never document body excerpts, user/private data, secrets, secret query
 * strings, private URLs, or raw document contents.
 *
 * Determinism: given identical inputs and an identical --as-of, the JSON and
 * Markdown reports are byte-identical (stable key/path ordering). The real
 * generation timestamp is written to stderr execution metadata, never into the
 * deterministic report fixture.
 *
 * Usage:
 *   node scripts/doc-drift/checkDocDrift.mjs [--root <repo>] [--as-of <ISO-8601>]
 *       [--out <report.json>] [--md-out <summary.md>]
 *
 * Exit codes: 0 = no STALE findings; 1 = one or more STALE findings;
 *             2 = fatal (bad arguments, unreadable inputs).
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const STATES = Object.freeze({
  CURRENT: 'CURRENT',
  STALE: 'STALE',
  REVIEW_PENDING: 'REVIEW_PENDING',
  UNKNOWN: 'UNKNOWN',
});

export const TOOL_VERSION = '1.0.0';
export const REVIEW_AGE_DAYS = 90;
export const MS_PER_DAY = 86_400_000;

/**
 * Explicit documented rule: a link target counts as an intentional future
 * placeholder ONLY when it matches one of these patterns. A missing target
 * that does not match is dead — intent is never assumed.
 */
export const PLACEHOLDER_PATTERNS = [
  /^#?todo\b/i,
  /\btbd\b/i,
  /coming[- ]soon/i,
  /under[- ]construction/i,
  /^placeholder\b/i,
];

const EXTERNAL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const LINK_RE = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
const FENCED_BLOCK_RE = /```[\s\S]*?```/g;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm;
const STAMP_RE = /(?:last\s+updated|updated|date)\s*[:\-–]?\s*(\d{4}-\d{2}-\d{2})/i;

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

/** Repo-relative path with forward slashes; never emits absolute paths. */
export function toRepoPath(root, absPath) {
  return relative(root, absPath).split(sep).join('/');
}

/**
 * Sanitize a link target for report output: strip query strings and fragments
 * (never echo potentially secret query strings), strip embedded credentials.
 */
export function sanitizeTarget(target) {
  let t = String(target).trim();
  const hash = t.indexOf('#');
  if (hash >= 0) t = t.slice(0, hash);
  const q = t.indexOf('?');
  if (q >= 0) t = t.slice(0, q);
  t = t.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^@/]*@/, (m) =>
    m.replace(/:\/\/[^@/]*@/, '://'),
  );
  return t;
}

export function isExternalTarget(target) {
  return EXTERNAL_SCHEME.test(target) || target.startsWith('//');
}

export function isPlaceholderTarget(target) {
  return PLACEHOLDER_PATTERNS.some((re) => re.test(target));
}

/** GitHub-style heading slug used for same-document anchor resolution. */
export function slugifyHeading(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

export function stripFencedBlocks(markdown) {
  return markdown.replace(FENCED_BLOCK_RE, '');
}

/**
 * Extract inline Markdown links (and images) with 1-based line numbers.
 * Links inside fenced code blocks are ignored.
 */
export function extractLinks(markdown) {
  const links = [];
  const lines = stripFencedBlocks(markdown).split('\n');
  lines.forEach((lineText, idx) => {
    LINK_RE.lastIndex = 0;
    let m;
    while ((m = LINK_RE.exec(lineText)) !== null) {
      links.push({ text: m[0].slice(0, 80), target: m[1], line: idx + 1 });
    }
  });
  return links;
}

export function extractHeadingIds(markdown) {
  const ids = new Set();
  HEADING_RE.lastIndex = 0;
  let m;
  while ((m = HEADING_RE.exec(markdown)) !== null) {
    ids.add(slugifyHeading(m[2]));
  }
  return ids;
}

/** First YYYY-MM-DD review stamp found in the document, or null. */
export function parseReviewStamp(markdown) {
  const m = STAMP_RE.exec(markdown);
  if (!m) return null;
  const d = new Date(`${m[1]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function classifyAge(stampDate, asOfDate) {
  if (!stampDate || Number.isNaN(stampDate.getTime())) return STATES.UNKNOWN;
  const ageDays = (asOfDate.getTime() - stampDate.getTime()) / MS_PER_DAY;
  // Age alone never yields STALE — only REVIEW_PENDING or CURRENT.
  return ageDays > REVIEW_AGE_DAYS ? STATES.REVIEW_PENDING : STATES.CURRENT;
}

// ---------------------------------------------------------------------------
// Git adapter (injectable for tests)
// ---------------------------------------------------------------------------

export function defaultGit(root) {
  const run = (args) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  return {
    headSha() {
      return run(['rev-parse', 'HEAD']);
    },
    objectExists(sha) {
      try {
        run(['cat-file', '-t', sha]);
        return true;
      } catch {
        return false;
      }
    },
    isAncestor(sha, head) {
      try {
        execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', sha, head]);
        return true;
      } catch {
        return false;
      }
    },
    commitsBetween(sha, head) {
      try {
        return Number.parseInt(run(['rev-list', '--count', `${sha}..${head}`]), 10);
      } catch {
        return null;
      }
    },
    isShallow() {
      try {
        return run(['rev-parse', '--is-shallow-repository']) === 'true';
      } catch {
        return false;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

function walkMarkdown(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walkMarkdown(abs, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(abs);
    }
  }
  return out;
}

/** Deterministic, sorted list of absolute Markdown paths in the corpus. */
export function listCorpus(root) {
  const files = [];
  for (const sub of ['docs', 'engineering-brain']) {
    const dir = join(root, sub);
    if (existsSync(dir) && statSync(dir).isDirectory()) walkMarkdown(dir, files);
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(join(root, entry.name));
    }
  }
  return [...new Set(files)].sort();
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * C1 — committed snapshot synchronization, labeled `synchronized-to-selected-HEAD`.
 * This measures sync lag against the selected HEAD, NOT intrinsic record
 * freshness. A snapshot indexed from an immutable historical commit is not
 * corrupt merely because HEAD advanced: SHA inequality marks only the
 * synchronization check STALE, never the indexed documents, and never implies
 * the live Brain is unusable.
 */
export function checkSnapshotSync({ root, git }) {
  const target = 'engineering-brain/index-manifest.json';
  const abs = join(root, target);
  if (!existsSync(abs)) {
    return {
      check: 'C1.snapshot-sync',
      target,
      state: STATES.UNKNOWN,
      evidence: { reason: 'manifest-missing', note: 'committed snapshot absent' },
    };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(abs, 'utf8'));
  } catch {
    return {
      check: 'C1.snapshot-sync',
      target,
      state: STATES.UNKNOWN,
      evidence: { reason: 'manifest-unreadable' },
    };
  }
  const indexedSha = manifest && manifest.commit_sha;
  if (typeof indexedSha !== 'string' || !/^[0-9a-f]{5,64}$/i.test(indexedSha)) {
    return {
      check: 'C1.snapshot-sync',
      target,
      state: STATES.UNKNOWN,
      evidence: { reason: 'sha-missing-or-malformed' },
    };
  }
  let head;
  try {
    head = git.headSha();
  } catch {
    return {
      check: 'C1.snapshot-sync',
      target,
      state: STATES.UNKNOWN,
      evidence: { reason: 'head-unresolvable', indexedSha },
    };
  }
  if (!git.objectExists(indexedSha)) {
    const shallow = typeof git.isShallow === 'function' && git.isShallow();
    return {
      check: 'C1.snapshot-sync',
      target,
      state: STATES.UNKNOWN,
      evidence: {
        reason: shallow ? 'indexed-sha-unverifiable-shallow-clone' : 'indexed-sha-not-in-repo',
        indexedSha,
        checkedHead: head,
        note: shallow
          ? 'this clone is shallow; the indexed SHA cannot be validated here — rerun on a full clone'
          : 'indexed SHA is not present in this repository',
      },
    };
  }
  if (indexedSha.toLowerCase() === head.toLowerCase()) {
    return {
      check: 'C1.snapshot-sync',
      target,
      state: STATES.CURRENT,
      evidence: {
        comparison: 'synchronized-to-selected-HEAD',
        indexedSha,
        checkedHead: head,
        scope: 'committed-snapshot-only',
      },
    };
  }
  const ancestor = git.isAncestor(indexedSha, head);
  const gap = ancestor ? git.commitsBetween(indexedSha, head) : null;
  return {
    check: 'C1.snapshot-sync',
    target,
    state: STATES.STALE,
    evidence: {
      comparison: 'synchronized-to-selected-HEAD',
      indexedSha,
      checkedHead: head,
      indexedShaIsAncestorOfHead: ancestor,
      commitsBehindHead: gap,
      scope: 'committed-snapshot-only',
      note:
        'Sync lag only: indexed documents are NOT marked stale and this ' +
        'says nothing about the live Brain.',
    },
  };
}

/**
 * C2 — live Supabase index synchronization. Phase 1 performs NO authenticated
 * live DB call without Jason's separate authorization, so this check always
 * reports UNKNOWN with the reason stated.
 */
export function checkLiveIndex() {
  return {
    check: 'C2.live-index-sync',
    target: 'supabase:engineering_brain_runs (latest)',
    state: STATES.UNKNOWN,
    evidence: {
      reason: 'no-authorized-db-access',
      note:
        'Phase 1 performs no authenticated live DB call without separate ' +
        'owner authorization. Live-index freshness is UNKNOWN — never STALE ' +
        'or CURRENT on this basis.',
    },
  };
}

function readDirNames(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return null;
  }
}

/**
 * Resolve one internal link target against the containing document's directory.
 * Returns { kind: 'resolved'|'dead'|'unresolved', note? }.
 * `readDir` is injectable for tests; defaults to reading the real directory.
 */
export function resolveLinkTarget({ docDir, target, readDir = readDirNames }) {
  const raw = target.trim();
  if (raw === '' || raw === '#') return { kind: 'resolved', note: 'top-of-document' };
  if (isExternalTarget(raw)) return { kind: 'resolved', note: 'external-skipped' };
  if (isPlaceholderTarget(raw)) {
    return { kind: 'resolved', note: 'intentional-placeholder-per-rule' };
  }
  const hashIdx = raw.indexOf('#');
  const pathPart = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
  const anchor = hashIdx >= 0 ? raw.slice(hashIdx + 1) : null;

  // Pure same-document anchor: validated by the caller against heading IDs.
  if (pathPart === '') return { kind: 'needs-anchor-check', anchor };

  const candidate = resolve(docDir, pathPart);
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return { kind: 'resolved' };
  }
  // Case-insensitive fallback within the target directory.
  const names = readDir(dirname(candidate));
  if (names === null) return { kind: 'dead', note: 'directory-unreadable' };
  const base = candidate.split(sep).pop().toLowerCase();
  const matches = names.filter((n) => n.toLowerCase() === base);
  if (matches.length === 1) {
    return { kind: 'resolved', note: 'case-variant-match' };
  }
  if (matches.length > 1) {
    return { kind: 'unresolved', note: 'ambiguous-case-variants' };
  }
  return { kind: 'dead', note: 'target-absent' };
}

/**
 * C3 — internal link resolution for one document. Emits one result per dead
 * or unresolved link, plus a per-document summary result.
 */
export function checkDocLinks({ docRepoPath, markdown, docDir, readDir }) {
  const results = [];
  const headingIds = extractHeadingIds(markdown);
  const links = extractLinks(markdown);
  let resolved = 0;
  let external = 0;
  let placeholders = 0;

  const sorted = [...links].sort((a, b) => a.line - b.line || (a.target < b.target ? -1 : 1));
  for (const link of sorted) {
    const outcome = resolveLinkTarget({ docDir, target: link.target, readDir });
    if (outcome.kind === 'needs-anchor-check') {
      const slug = slugifyHeading(decodeURIComponent(outcome.anchor || ''));
      if (headingIds.has(slug)) {
        resolved += 1;
      } else {
        results.push({
          check: 'C3.link',
          target: docRepoPath,
          state: STATES.STALE,
          evidence: {
            line: link.line,
            linkTarget: sanitizeTarget(link.target),
            reason: 'anchor-absent',
          },
        });
      }
      continue;
    }
    if (outcome.note === 'external-skipped') {
      external += 1;
      continue;
    }
    if (outcome.note === 'intentional-placeholder-per-rule') {
      placeholders += 1;
      continue;
    }
    if (outcome.kind === 'resolved') {
      resolved += 1;
      continue;
    }
    if (outcome.kind === 'unresolved') {
      results.push({
        check: 'C3.link',
        target: docRepoPath,
        state: STATES.REVIEW_PENDING,
        evidence: {
          line: link.line,
          linkTarget: sanitizeTarget(link.target),
          reason: outcome.note || 'ambiguous',
        },
      });
      continue;
    }
    results.push({
      check: 'C3.link',
      target: docRepoPath,
      state: STATES.STALE,
      evidence: {
        line: link.line,
        linkTarget: sanitizeTarget(link.target),
        reason: outcome.note || 'target-absent',
      },
    });
  }

  const hasFindings = results.length > 0;
  results.push({
    check: 'C3.links-summary',
    target: docRepoPath,
    state: hasFindings ? STATES.STALE : STATES.CURRENT,
    evidence: {
      linksExtracted: links.length,
      resolved,
      externalSkipped: external,
      intentionalPlaceholders: placeholders,
      findings: results.length,
      note: hasFindings
        ? 'see per-link findings above'
        : 'all internal links resolved',
    },
  });
  return results;
}

/** C4 — review-age signal for one document. Age alone never yields STALE. */
export function checkDocAge({ docRepoPath, markdown, asOf }) {
  const stamp = parseReviewStamp(markdown);
  const state = classifyAge(stamp, asOf);
  return {
    check: 'C4.review-age',
    target: docRepoPath,
    state,
    evidence: {
      stamp: stamp ? stamp.toISOString().slice(0, 10) : null,
      asOf: asOf.toISOString(),
      thresholdDays: REVIEW_AGE_DAYS,
      note:
        state === STATES.REVIEW_PENDING
          ? 'stamp older than threshold: human judgment needed, not drift evidence'
          : state === STATES.UNKNOWN
            ? 'no parseable review stamp'
            : 'stamp within threshold',
    },
  };
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

export function runDriftCheck({ root, asOf, git = defaultGit(root), readDir = readDirNames }) {
  const results = [];
  let head = null;
  try {
    head = git.headSha();
  } catch {
    head = null;
  }

  results.push(checkSnapshotSync({ root, git }));
  results.push(checkLiveIndex());

  const corpus = listCorpus(root);
  for (const abs of corpus) {
    const docRepoPath = toRepoPath(root, abs);
    const markdown = readFileSync(abs, 'utf8');
    const docDir = dirname(abs);
    // C3 link findings (sorted), then the per-doc summary, then C4.
    results.push(...checkDocLinks({ docRepoPath, markdown, docDir, readDir }));
    results.push(checkDocAge({ docRepoPath, markdown, asOf }));
  }

  const report = {
    tool: 'forge-doc-drift',
    version: TOOL_VERSION,
    asOf: asOf.toISOString(),
    repoHead: head,
    results,
  };
  return { report, summary: formatMarkdownSummary(report) };
}

function stateCell(state) {
  return state;
}

export function formatMarkdownSummary(report) {
  const lines = [];
  lines.push('# FORGE document drift report');
  lines.push('');
  lines.push(`- as-of: ${report.asOf}`);
  lines.push(`- repo HEAD: ${report.repoHead || 'unknown'}`);
  lines.push(`- checks: ${report.results.length}`);
  const counts = {};
  for (const r of report.results) counts[r.state] = (counts[r.state] || 0) + 1;
  lines.push(
    `- states: ${Object.entries(counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`,
  );
  lines.push('');
  lines.push('| check | target | state | evidence |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of report.results) {
    const ev = JSON.stringify(r.evidence);
    lines.push(`| ${r.check} | ${r.target} | ${stateCell(r.state)} | ${ev} |`);
  }
  lines.push('');
  lines.push(
    '_CURRENT applies to one check only. STALE marks a demonstrated mismatch. ' +
      'REVIEW_PENDING needs human judgment. UNKNOWN means provenance unavailable._',
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { root: process.cwd(), asOf: null, out: null, mdOut: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--root') args.root = resolve(argv[++i] || '');
    else if (a === '--as-of') args.asOf = argv[++i] || null;
    else if (a === '--out') args.out = argv[++i] || null;
    else if (a === '--md-out') args.mdOut = argv[++i] || null;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

function main() {
  const started = Date.now();
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(2);
  }
  if (args.help) {
    process.stdout.write(
      'Usage: node scripts/doc-drift/checkDocDrift.mjs [--root <repo>] [--as-of <ISO-8601>] [--out <report.json>] [--md-out <summary.md>]\n',
    );
    process.exit(0);
  }

  let asOf;
  if (args.asOf) {
    const t = Date.parse(args.asOf);
    if (Number.isNaN(t)) {
      process.stderr.write(`error: --as-of is not a valid ISO-8601 timestamp: ${args.asOf}\n`);
      process.exit(2);
    }
    asOf = new Date(t);
  } else {
    asOf = new Date();
  }

  const root = resolve(args.root);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    process.stderr.write(`error: --root is not a directory: ${root}\n`);
    process.exit(2);
  }

  let report;
  let summary;
  try {
    ({ report, summary } = runDriftCheck({ root, asOf }));
  } catch (err) {
    process.stderr.write(`error: drift check failed: ${err.message}\n`);
    process.exit(2);
  }

  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out) {
    writeFileSync(args.out, json, 'utf8');
  } else {
    process.stdout.write(json);
  }
  if (args.mdOut) {
    writeFileSync(args.mdOut, `${summary}\n`, 'utf8');
  }

  const stale = report.results.filter((r) => r.state === STATES.STALE).length;
  // Execution metadata goes to stderr — never into the deterministic report.
  process.stderr.write(
    `${JSON.stringify({
      tool: 'forge-doc-drift',
      version: TOOL_VERSION,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      staleFindings: stale,
      exitCode: stale > 0 ? 1 : 0,
    })}\n`,
  );
  process.exit(stale > 0 ? 1 : 0);
}

const invokedAsCli =
  process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (invokedAsCli) main();
