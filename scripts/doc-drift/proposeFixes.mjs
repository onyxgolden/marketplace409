#!/usr/bin/env node
/**
 * proposeFixes.mjs — FORGE document freshness, Phase 2: draft fix proposals.
 *
 * Read-only. Takes a Phase-1 drift report (JSON) and, for each STALE
 * `C3.link` finding, gathers deterministic evidence (repo search, git
 * history) and emits draft fix proposals with source links, revision,
 * timestamp and a rule-based confidence score. No document is modified and
 * no proposal is applied — every proposal is for owner review.
 *
 * A finding's evidence carries the sanitized target (fragment stripped), so
 * the proposer re-extracts the document's links to recover the full raw
 * target (including any #fragment) and to tell inline links apart from
 * reference-style links (whose fix belongs on the definition line).
 *
 * Usage:
 *   node scripts/doc-drift/proposeFixes.mjs \
 *     --root <repo-root> --report <drift-report.json> \
 *     [--as-of <ISO-8601>] [--out <proposals.json>] [--md-out <proposals.md>]
 *
 * Exit codes: 0 = proposals written; 2 = bad arguments / unreadable inputs.
 * Proposals are advisory by design, so findings never change the exit code.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, dirname, basename, sep } from 'node:path';
import {
  STATES,
  sanitizeTarget,
  reportableTarget,
  extractLinks,
  extractHeadingIds,
  extractReferenceDefinitions,
  slugifyHeading,
} from './checkDocDrift.mjs';

export const PROPOSER_VERSION = '1.0.0';

/* ------------------------------------------------------------------ */
/* Small deterministic helpers                                         */
/* ------------------------------------------------------------------ */

/** Classic Levenshtein distance over two short strings. */
export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Walk a repo tree (excluding .git and node_modules) and index Markdown files by lowercase basename. */
export function indexMarkdownByBasename(root) {
  const byBase = new Map(); // lowerBasename -> [repoRelativePath]
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable directory: skip, do not fail
    }
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(abs);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        const rel = relative(root, abs).split(sep).join('/');
        const key = e.name.toLowerCase();
        if (!byBase.has(key)) byBase.set(key, []);
        byBase.get(key).push(rel);
      }
    }
  }
  for (const list of byBase.values()) list.sort();
  return byBase;
}

/** Run git log on a path; returns [] when git is unavailable or the path has no history. */
export function gitHistory(root, repoPath, { follow = false, diffFilter = null, limit = 5 } = {}) {
  const args = ['log', `--format=${'%H'}|${'%ad'}|${'%s'}`, '--date=iso', `-${limit}`];
  if (follow) args.push('--follow');
  if (diffFilter) args.push(`--diff-filter=${diffFilter}`);
  args.push('--', repoPath);
  try {
    const out = execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
    }).trim();
    if (!out) return [];
    return out.split('\n').map((line) => {
      const [sha, date, ...subjectParts] = line.split('|');
      return { sha, date, subject: subjectParts.join('|') };
    });
  } catch {
    return [];
  }
}

/** Find the 1-based line number of a reference definition `[id]:` in markdown, or -1. */
export function findDefinitionLine(markdown, id) {
  const lines = markdown.split('\n');
  const needle = `[${id.toLowerCase()}]:`;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().toLowerCase().startsWith(needle)) return i + 1;
  }
  return -1;
}

/** Replace the first occurrence of `oldTarget` inside a line with `newTarget`. */
export function rewriteLineTarget(line, oldTarget, newTarget) {
  const idx = line.indexOf(oldTarget);
  if (idx === -1) return null;
  return line.slice(0, idx) + newTarget + line.slice(idx + oldTarget.length);
}

/** Escape a string for use inside a RegExp. */
export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Count `[text][id]` usages of a reference id in markdown (case-insensitive).
 * Used to tell whether a near-match definition id is load-bearing.
 */
export function countIdUsages(markdown, id) {
  const re = new RegExp(`\\][\\s]*\\[${escapeRegExp(id)}\\]`, 'gi');
  return (markdown.match(re) || []).length;
}

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function safeSlug(anchor) {
  return slugifyHeading(decodeURIComponentSafe(anchor));
}

/* ------------------------------------------------------------------ */
/* Proposal generation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Adapt a Phase-1 `C3.link` STALE result to the proposer's finding shape.
 * Returns null when the result is not a usable link finding.
 */
export function adaptFinding(result) {
  if (!result || result.check !== 'C3.link' || result.state !== STATES.STALE) return null;
  const ev = result.evidence || {};
  if (typeof ev.line !== 'number' || typeof ev.linkTarget !== 'string' || typeof ev.reason !== 'string') return null;
  if (typeof result.target !== 'string' || !result.target) return null;
  return { file: result.target, line: ev.line, linkTarget: ev.linkTarget, reason: ev.reason };
}

/**
 * Build draft proposals for one adapted finding.
 * Returns an array (possibly empty) of proposal objects; never throws.
 */
export function proposeForFinding({ root, finding, readDoc, basenameIndex, targetHeadingsCache }) {
  const proposals = [];
  const push = (p) =>
    proposals.push({
      id: null, // assigned by the caller after sorting
      revision: 1,
      check: 'link-fix-proposal',
      finding: {
        check: 'C3.link',
        target: finding.file,
        line: finding.line,
        linkTarget: finding.linkTarget,
        reason: finding.reason,
      },
      file: finding.file,
      edit: null,
      confidence: 'low',
      confidenceReasons: [],
      sources: [],
      ...p,
    });

  if (finding.linkTarget === '[redacted:absolute-path]') return proposals; // cannot safely propose
  const docText = readDoc(finding.file);
  if (docText === null) return proposals; // unreadable doc: nothing to propose
  const lines = docText.split('\n');

  // Recover the full raw link (fragment included) behind this finding.
  const links = extractLinks(docText);
  const link =
    links.find((l) => l.line === finding.line && reportableTarget(l.target) === finding.linkTarget) ||
    links.find((l) => l.line === finding.line && sanitizeTarget(String(l.target)) === finding.linkTarget);
  if (!link) return proposals;
  if (link.target == null && finding.reason !== 'reference-undefined') return proposals;
  const rawTarget = String(link.target ?? '');

  // Decide where the fix belongs: inline/autolink -> the usage line;
  // reference/shortcut -> the definition line.
  const isInline = /\]\(/.test(link.text) || /^</.test(link.text);
  let editLineNum = finding.line;
  let editOldTarget = rawTarget;
  if (!isInline) {
    const rawId = link.undefinedRef || null;
    let defId = rawId;
    let defTarget;
    if (!defId) {
      const m = link.text.match(/\[([^\]]*)\]\[([^\]]*)\]/) || link.text.match(/\[([^\]]+)\]/);
      defId = m ? m[2] || m[1] : null;
      if (!defId) return proposals;
      const defs = extractReferenceDefinitions(docText);
      defTarget = defs.get(defId.toLowerCase());
      if (defTarget === undefined) return proposals; // definition vanished; nothing sane to edit
      const dl = findDefinitionLine(docText, defId);
      if (dl !== -1) editLineNum = dl;
      editOldTarget = defTarget;
    } else {
      // reference-undefined is handled in its own branch below.
    }
  }

  const buildEdit = (newTarget) => {
    const oldLine = lines[editLineNum - 1] ?? '';
    const newLine = rewriteLineTarget(oldLine, editOldTarget, newTarget);
    return newLine === null ? null : { line: editLineNum, oldText: oldLine, newText: newLine };
  };
  const docDir = dirname(finding.file);

  if (finding.reason === 'target-absent' || finding.reason === 'unresolvable-target') {
    const pathPart = sanitizeTarget(rawTarget);
    if (!pathPart) return proposals;
    const base = basename(pathPart).toLowerCase();
    const candidates = (basenameIndex.get(base) || []).filter((c) => c !== finding.file);

    const absGuess = pathPart.startsWith('/') ? pathPart.slice(1) : join(docDir, pathPart).split(sep).join('/');
    const deleted = gitHistory(root, absGuess, { diffFilter: 'D', limit: 3 });
    const moved = gitHistory(root, absGuess, { follow: true, limit: 5 });
    const sources = [
      ...deleted.map((h) => ({ type: 'git-deletion', sha: h.sha, date: h.date, subject: h.subject, path: absGuess })),
      ...moved.slice(0, 3).map((h) => ({ type: 'git-history', sha: h.sha, date: h.date, subject: h.subject, path: absGuess })),
      ...candidates.map((c) => ({ type: 'repo-file', path: c })),
    ];

    if (candidates.length === 1) {
      const rel = relative(docDir, candidates[0]).split(sep).join('/');
      const newTarget = rawTarget.replace(pathPart, rel.startsWith('.') ? rel : `./${rel}`);
      const edit = buildEdit(newTarget);
      push({
        edit,
        confidence: edit ? 'high' : 'medium',
        confidenceReasons: [
          'exactly one same-basename Markdown file exists in the repo (probable move/rename)',
          ...(edit ? [] : ['proposed target text not found on the edit line; owner must apply manually']),
        ],
        sources,
      });
    } else if (candidates.length > 1) {
      push({
        edit: null,
        confidence: 'medium',
        confidenceReasons: [`${candidates.length} same-basename candidates exist; owner must pick the intended one`],
        sources,
      });
    } else {
      push({
        edit: null,
        confidence: 'low',
        confidenceReasons:
          deleted.length > 0
            ? ['target was deleted in git history and no same-name file exists; needs owner judgment']
            : ['no same-basename Markdown file found in the repo; needs owner judgment'],
        sources,
      });
    }
    return proposals;
  }

  if (finding.reason === 'anchor-absent') {
    const hashIdx = rawTarget.indexOf('#');
    if (hashIdx === -1) return proposals;
    const pathPart = rawTarget.slice(0, hashIdx);
    const wantSlug = safeSlug(rawTarget.slice(hashIdx + 1));
    const targetRel =
      pathPart === '' ? finding.file : pathPart.startsWith('/') ? pathPart.slice(1) : join(docDir, pathPart).split(sep).join('/');

    let headings = targetHeadingsCache.get(targetRel);
    if (headings === undefined) {
      const targetText = readDoc(targetRel);
      headings = targetText === null ? [] : [...extractHeadingIds(targetText)];
      targetHeadingsCache.set(targetRel, headings);
    }
    const ranked = headings
      .map((h) => ({ slug: h, distance: levenshtein(wantSlug, h) }))
      .filter((r) => r.distance <= 3 && r.slug !== wantSlug)
      .sort((a, b) => a.distance - b.distance || (a.slug < b.slug ? -1 : 1));
    const sources = ranked.map((r) => ({ type: 'doc-heading', path: targetRel, slug: r.slug }));

    if (ranked.length === 1 && ranked[0].distance <= 2) {
      const newTarget = `${rawTarget.slice(0, hashIdx + 1)}${ranked[0].slug}`;
      const edit = buildEdit(newTarget);
      push({
        edit,
        confidence: edit ? 'high' : 'medium',
        confidenceReasons: [`single close heading slug "${ranked[0].slug}" (edit distance ${ranked[0].distance})`],
        sources,
      });
    } else if (ranked.length > 1) {
      push({
        edit: null,
        confidence: 'medium',
        confidenceReasons: [`${ranked.length} similar heading slugs exist; owner must pick the intended section`],
        sources,
      });
    } else {
      push({
        edit: null,
        confidence: 'low',
        confidenceReasons: ['no similar heading slug found in the target document'],
        sources: [{ type: 'doc-heading-list', path: targetRel, count: headings.length }],
      });
    }
    return proposals;
  }

  if (finding.reason === 'reference-undefined') {
    const id = link.undefinedRef;
    if (!id) return proposals;
    const defs = extractReferenceDefinitions(docText);
    const close = [...defs.keys()]
      .map((d) => ({ id: d, distance: levenshtein(id.toLowerCase(), d.toLowerCase()) }))
      .filter((r) => r.distance > 0 && r.distance <= 2)
      .sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : 1));
    if (close.length >= 1) {
      // If the near-match definition is referenced elsewhere, it is
      // load-bearing: the usage is the typo, not the definition.
      const loadBearing = countIdUsages(docText, close[0].id) > 0;
      const oldLine = lines[finding.line - 1] ?? '';
      let usageFixed = oldLine.replace(`][${id}]`, `][${close[0].id}]`);
      if (usageFixed === oldLine) usageFixed = oldLine.replace(`[${id}][]`, `[${close[0].id}][]`);
      const edit = usageFixed === oldLine ? null : { line: finding.line, oldText: oldLine, newText: usageFixed };
      push({
        edit,
        confidence: edit ? (loadBearing ? 'high' : 'medium') : 'low',
        confidenceReasons: [
          `single near-match definition "[${close[0].id}]" (edit distance ${close[0].distance})`,
          loadBearing
            ? `definition "[${close[0].id}]" is referenced elsewhere, so the usage id is the typo`
            : 'definition id may instead be the typo; owner should confirm which side is wrong',
          ...(edit ? [] : ['usage text pattern not found on the line; owner must apply manually']),
        ],
        sources: [{ type: 'doc-definition', path: finding.file, id: close[0].id }],
      });
    } else {
      push({
        edit: null,
        confidence: 'low',
        confidenceReasons: ['no near-match reference definition found in the document'],
        sources: [],
      });
    }
    return proposals;
  }

  return proposals;
}

/* ------------------------------------------------------------------ */
/* Driver                                                              */
/* ------------------------------------------------------------------ */

export function runProposer({ root, report, asOf }) {
  const docCache = new Map();
  const readDoc = (repoPath) => {
    if (docCache.has(repoPath)) return docCache.get(repoPath);
    let text = null;
    try {
      text = readFileSync(join(root, repoPath), 'utf8');
    } catch {
      text = null;
    }
    docCache.set(repoPath, text);
    return text;
  };

  const basenameIndex = indexMarkdownByBasename(root);
  const targetHeadingsCache = new Map();

  const findings = [];
  for (const r of report.results || []) {
    const f = adaptFinding(r);
    if (f) findings.push(f);
  }
  // Deterministic order: by file, then line, then target.
  findings.sort((a, b) =>
    a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.linkTarget < b.linkTarget ? -1 : 1),
  );

  const all = [];
  for (const finding of findings) {
    const made = proposeForFinding({ root, finding, readDoc, basenameIndex, targetHeadingsCache });
    for (const p of made) all.push(p);
  }
  all.forEach((p, i) => {
    p.id = `P-${String(i + 1).padStart(4, '0')}`;
  });

  const counts = { high: 0, medium: 0, low: 0 };
  for (const p of all) counts[p.confidence]++;

  return {
    tool: 'forge-doc-proposals',
    version: PROPOSER_VERSION,
    generatedAt: asOf,
    driftReport: {
      tool: report.tool,
      version: report.version,
      generatedAt: report.generatedAt,
      repoHead: report.repoHead,
    },
    findingsConsidered: findings.length,
    proposalCounts: counts,
    proposals: all,
  };
}

export function mdCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function formatMarkdownProposals(result) {
  const out = [];
  out.push(`# FORGE document fix proposals (Phase 2 draft)`);
  out.push(``);
  out.push(`- Generated: ${result.generatedAt}`);
  out.push(`- Drift report: ${result.driftReport.generatedAt} (head ${String(result.driftReport.repoHead).slice(0, 10)})`);
  out.push(`- Findings considered: ${result.findingsConsidered}`);
  out.push(
    `- Proposals: ${result.proposals.length} (high ${result.proposalCounts.high}, medium ${result.proposalCounts.medium}, low ${result.proposalCounts.low})`,
  );
  out.push(``);
  out.push(`> Drafts only — nothing has been applied. Review each proposal before use.`);
  out.push(``);
  out.push(`| ID | File | Line | Finding | Confidence | Proposed change |`);
  out.push(`| --- | --- | --- | --- | --- | --- |`);
  for (const p of result.proposals) {
    const change = p.edit ? `\`${mdCell(p.edit.oldText.trim())}\` → \`${mdCell(p.edit.newText.trim())}\`` : '— (owner judgment needed)';
    out.push(
      `| ${p.id} | ${mdCell(p.file)} | ${p.edit ? p.edit.line : '—'} | ${mdCell(p.finding.reason)} | ${p.confidence} | ${change} |`,
    );
  }
  out.push(``);
  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = { root: process.cwd(), report: null, asOf: new Date().toISOString(), out: null, mdOut: null };
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
    else if (a === '--report') args.report = take(a);
    else if (a === '--as-of') args.asOf = take(a);
    else if (a === '--out') args.out = take(a);
    else if (a === '--md-out') args.mdOut = take(a);
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (!args.report) {
    console.error('Missing required --report <drift-report.json>.');
    process.exit(2);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let report;
  try {
    report = JSON.parse(readFileSync(args.report, 'utf8'));
  } catch {
    console.error(`Cannot read drift report: ${args.report}`);
    process.exit(2);
  }
  if (!report || !Array.isArray(report.results)) {
    console.error('Drift report is not a valid Phase-1 report (missing results array).');
    process.exit(2);
  }
  const result = runProposer({ root: args.root, report, asOf: args.asOf });
  const json = JSON.stringify(result, null, 2) + '\n';
  if (args.out) writeFileSync(args.out, json, 'utf8');
  else process.stdout.write(json);
  if (args.mdOut) writeFileSync(args.mdOut, `${formatMarkdownProposals(result)}\n`, 'utf8');
  console.error(
    JSON.stringify({
      tool: 'forge-doc-proposals',
      version: PROPOSER_VERSION,
      findingsConsidered: result.findingsConsidered,
      proposals: result.proposals.length,
      counts: result.proposalCounts,
    }),
  );
}

const invokedAsScript =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`, 'file://').href;
if (invokedAsScript) main();
