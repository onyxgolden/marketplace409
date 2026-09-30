/**
 * proposePatch.mjs — Slice 3: narrow deterministic patch writer.
 *
 * Closes the loop evidence -> implicated code -> PROPOSED patch. The writer
 * never applies, commits, pushes, merges, or deploys; it returns a patch
 * object (or an honest noPatch) and the existing branch/PR/review machinery
 * moves it from there. No model calls, fully deterministic.
 *
 * Repair classes are tightly defined; this slice implements exactly one:
 *
 *   Class 1 "wrong-path-literal": a failure log names a path that does not
 *   exist in the repo, and exactly one brain-known path is a unique tier-1
 *   close match (basename equality or shared trailing directory chain -- the
 *   same tier-1 rule Slice 2's reranker uses). The writer rewrites the bad
 *   literal to the matched path, preserving a trailing glob/filename segment.
 *   Historical case: the Capture NSIS upload path
 *   forge-capture-app/app/target/release/bundle/nsis/*.exe ->
 *   forge-capture-app/target/release/bundle/nsis/*.exe (PR #433).
 *
 * Safety rails (all enforced, noPatch when any fails):
 * - one file, one hunk, one repair class, max 20 changed lines
 * - the bad literal must be named by the evidence (mentioned_paths/error_lines)
 * - the patched file must still parse (node --check / JSON.parse / js-yaml)
 * - never proposed: *.manifest.json, node_modules, .git, outside the repo root
 * - workflow files (.github/workflows/*) are proposable but flagged
 *   application:"manual" -- the API token lacks workflow scope, so a human
 *   applies them via the GitHub web UI (the documented flow)
 * - ambiguous matches, missing literals, multi-file hits -> noPatch, never a guess
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { matchEvidenceTier, TIER_BASENAME_OR_SUFFIX, normalizeEvidencePath } from "../query/rerankImplicatedCode.mjs";
import { extractMentionedPaths } from "../signals/collectEvidence.mjs";

export const REPAIR_CLASS_WRONG_PATH_LITERAL = "wrong-path-literal";
export const MAX_PATCH_LINES = 20;
const HUNK_CONTEXT = 3;
const HUNK_SPLIT_GAP = HUNK_CONTEXT * 2;

/** Split a path on separators without lowercasing (for building replacements). */
function splitPath(p) {
  return String(p || "").replace(/\\/g, "/").replace(/^\.\//, "").split("/").filter(Boolean);
}

/**
 * Pick the single missing path from the evidence. Class 1 handles exactly one
 * wrong path; zero or several -> noPatch (never guess which).
 * pathExists: (rawPath) -> boolean, injected for hermetic tests.
 */
export function selectBadPath(mentionedPaths, pathExists) {
  const list = Array.isArray(mentionedPaths) ? mentionedPaths : [];
  const missing = [];
  for (const p of list) {
    const norm = normalizeEvidencePath(p);
    if (!norm || !norm.includes("/")) continue;
    if (!pathExists(p)) missing.push(p);
  }
  if (missing.length === 0) return { badPath: null, reason: "no-missing-path" };
  if (missing.length > 1) return { badPath: null, reason: "multiple-missing-paths" };
  return { badPath: missing[0] };
}

/** True when the (possibly globbed) path resolves to something in the repo. */
export function pathExistsInRepo(repoRoot, p) {
  const norm = normalizeEvidencePath(p);
  const cut = norm.search(/[*?[]/);
  const check = (cut === -1 ? norm : norm.slice(0, cut)).replace(/\/+$/, "");
  if (!check) return false;
  const root = path.resolve(repoRoot);
  const abs = path.resolve(root, check);
  if (abs !== root && !abs.startsWith(root + path.sep)) return false;
  return fs.existsSync(abs);
}

/**
 * Find the unique tier-1 close match for the bad path among the brain's known
 * paths, reusing Slice 2's tier-1 rule verbatim. Exactly one candidate at
 * tier <= TIER_BASENAME_OR_SUFFIX, otherwise noPatch.
 */
export function findUniqueMatch(badPath, candidates) {
  const badNorm = normalizeEvidencePath(badPath);
  const hits = [];
  for (const c of candidates || []) {
    const cNorm = normalizeEvidencePath(c);
    if (!cNorm || cNorm === badNorm) continue;
    const m = matchEvidenceTier({ source_path: c }, { mentioned_paths: [badPath] });
    if (m.tier <= TIER_BASENAME_OR_SUFFIX) hits.push({ candidate: c, tier: m.tier });
  }
  const uniq = [...new Map(hits.map((h) => [normalizeEvidencePath(h.candidate), h])).values()];
  if (uniq.length === 0) return { matched: null, reason: "no-close-match" };
  if (uniq.length > 1) return { matched: null, reason: "ambiguous-match" };
  return { matched: uniq[0].candidate, tier: uniq[0].tier };
}

/**
 * Build the replacement literal: the matched path's directory portion plus the
 * bad literal's trailing segment (glob or filename preserved).
 * Capture case: bad .../nsis/*.exe + matched .../nsis/*.exe -> .../nsis/*.exe.
 */
export function buildReplacement(badPath, matchedPath) {
  const badSegs = splitPath(badPath);
  const mSegs = splitPath(matchedPath);
  if (badSegs.length < 2 || mSegs.length < 2) return null;
  return [...mSegs.slice(0, -1), badSegs[badSegs.length - 1]].join("/");
}

/** Replace every occurrence of the bad literal; null when the literal is absent. */
export function applyWrongPathLiteral(content, badPath, replacement) {
  if (!String(content).includes(badPath)) return null;
  return String(content).split(badPath).join(replacement);
}

/**
 * Line hunks between original and patched text. Literal replacement never
 * changes line counts, so hunks are maximal runs of changed lines; a gap of
 * more than 2*context unchanged lines splits hunks (standard unified shape).
 */
export function diffHunks(original, patched) {
  const a = String(original).split("\n");
  const b = String(patched).split("\n");
  const changed = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) changed.push(i);
  }
  if (changed.length === 0) return [];
  const groups = [];
  let start = changed[0];
  let prev = changed[0];
  for (let k = 1; k < changed.length; k += 1) {
    if (changed[k] - prev > HUNK_SPLIT_GAP) {
      groups.push([start, prev]);
      start = changed[k];
    }
    prev = changed[k];
  }
  groups.push([start, prev]);
  return groups.map(([s, e]) => {
    const ctxStart = Math.max(0, s - HUNK_CONTEXT);
    return {
      oldStart: ctxStart + 1,
      changedStart: s,
      oldLines: a.slice(ctxStart, e + HUNK_CONTEXT + 1),
      newLines: b.slice(ctxStart, e + HUNK_CONTEXT + 1),
      changedLines: e - s + 1,
    };
  });
}

/** Render one hunk as unified diff text (@@ -l,c +l,c @@). */
export function renderUnifiedDiff(relPath, original, hunks) {
  const a = String(original).split("\n");
  const lines = [`--- a/${relPath}`, `+++ b/${relPath}`];
  for (const h of hunks) {
    const ctxStart = h.oldStart - 1;
    // Absolute index of the first changed line: ctxStart + HUNK_CONTEXT only
    // when leading context was not clamped at the start of the file.
    const changedStart = Number.isInteger(h.changedStart) ? h.changedStart : ctxStart + HUNK_CONTEXT;
    lines.push(`@@ -${h.oldStart},${h.oldLines.length} +${h.oldStart},${h.newLines.length} @@`);
    h.oldLines.forEach((line, i) => {
      const absIdx = ctxStart + i;
      const isChanged = absIdx >= changedStart && absIdx < changedStart + h.changedLines;
      if (!isChanged) {
        lines.push(` ${line}`);
        return;
      }
      const oldLine = a[absIdx];
      lines.push(`-${oldLine !== undefined ? oldLine : ""}`);
      lines.push(`+${h.newLines[i]}`);
    });
  }
  return lines.join("\n");
}

/**
 * Paths the writer never proposes: manifests (generated, never recommitted),
 * node_modules, .git internals. Workflow files are NOT excluded -- they are
 * proposed with application:"manual" (see proposePatch).
 */
export function isExcludedPath(relPath) {
  const norm = normalizeEvidencePath(relPath);
  const base = norm.split("/").pop();
  return (
    norm === ".git"
    || norm.startsWith(".git/")
    || norm === "node_modules"
    || norm.startsWith("node_modules/")
    || norm.includes("/node_modules/")
    // The engineering-brain index manifest (engineering-brain/index-manifest.json)
    // must never be a patch target; match *-manifest.json / *.manifest.json too.
    || /(^|[.-])manifest\.json$/i.test(base)
  );
}

/** Workflow files can be proposed but never pushed via API: human applies via web UI. */
export function isWorkflowPath(relPath) {
  const norm = normalizeEvidencePath(relPath);
  return norm === ".github/workflows" || norm.startsWith(".github/workflows/");
}

/** Parse-check the patched content per extension. Unknown extensions -> noPatch. */
export function syntaxCheck(filePath, content) {
  const ext = path.extname(String(filePath)).toLowerCase();
  try {
    if (ext === ".json") {
      JSON.parse(content);
      return { ok: true };
    }
    if (ext === ".yml" || ext === ".yaml") {
      yaml.load(String(content));
      return { ok: true };
    }
    if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-syntax-"));
      try {
        const tmp = path.join(dir, `check${ext}`);
        fs.writeFileSync(tmp, String(content));
        execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      return { ok: true };
    }
    return { ok: false, reason: `unsupported extension for parse check: ${ext || "(none)"}` };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e).slice(0, 200) };
  }
}

/** Extract path-like literals from added (+) diff lines -- the recorded correction. */
export function extractAddedPaths(diffText) {
  const added = [];
  for (const line of String(diffText || "").split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added.push(line.slice(1));
  }
  return extractMentionedPaths(added.join("\n"));
}

/**
 * Build the brain's known-path index: repo tracked files + their directory
 * prefixes, plus corrected paths extracted from related past fixes' diffs.
 * The fix-commit SHAs come from the bundle's past_fixes (bug catalog records).
 */
export function buildPathIndex({ repoRoot, bundle }) {
  const paths = new Set();
  try {
    const out = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" });
    for (const f of out.split("\n").map((s) => s.trim()).filter(Boolean)) {
      paths.add(f);
      const segs = f.split("/");
      for (let i = 1; i < segs.length; i += 1) paths.add(segs.slice(0, i).join("/"));
    }
  } catch {
    // Not a git repo: no repo paths. Past-fix paths below still apply.
  }
  for (const fix of ((bundle && bundle.past_fixes) || []).slice(0, 5)) {
    const sha = fix && fix.record && fix.record.sha;
    if (!sha) continue;
    try {
      const diff = execFileSync("git", ["show", "--format=", sha, "--"], { cwd: repoRoot, encoding: "utf8" });
      for (const p of extractAddedPaths(diff)) paths.add(p);
    } catch {
      // Unresolvable fix commit: skip, never fail the whole index.
    }
  }
  return [...paths];
}

/** git grep for the literal; null when git is unavailable. */
export function grepLiteralInRepo(repoRoot, literal) {
  try {
    const out = execFileSync("git", ["grep", "-l", "--fixed-strings", "--", literal, "--", "."], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

function resolveRepoPath(repoRoot, relPath) {
  const root = path.resolve(repoRoot);
  const abs = path.resolve(root, String(relPath).replace(/\\/g, "/"));
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return { abs, rel: path.relative(root, abs).replace(/\\/g, "/") };
}

/**
 * proposePatch({ bundle, evidence, repoRoot, pathIndex?, deps? }) ->
 *   { patch, explanation } | { noPatch: true, reason }
 *
 * bundle: diagnostic bundle (facets.implicated_code[].source_path, past_fixes).
 * evidence: { failed_step, error_lines[], mentioned_paths[] }.
 * pathIndex: override for the known-path pool (built via buildPathIndex when omitted).
 * deps: { readFile, grepLiteral } seams for hermetic tests.
 */
export function proposePatch({ bundle, evidence, repoRoot, pathIndex, deps = {} }) {
  const no = (reason, detail) => ({ noPatch: true, reason, ...(detail ? { detail } : {}) });
  const readFile = deps.readFile || ((abs) => fs.readFileSync(abs, "utf8"));
  const grepLiteral = deps.grepLiteral || grepLiteralInRepo;

  const mentioned = evidence && Array.isArray(evidence.mentioned_paths) ? evidence.mentioned_paths : [];
  if (mentioned.length === 0) return no("no-mentioned-paths");

  const exists = (p) => (deps.pathExists ? deps.pathExists(p) : pathExistsInRepo(repoRoot, p));
  const { badPath, reason: badReason } = selectBadPath(mentioned, exists);
  if (!badPath) return no(badReason);

  // Rail: the failure log must name what the patch touches.
  const evidenceText = [...mentioned, ...((evidence && evidence.error_lines) || [])].join("\n");
  if (!evidenceText.includes(badPath)) return no("bad-path-not-in-evidence");

  // Candidate files: implicated code first, repo-wide literal search as fallback.
  const implicated = ((bundle && bundle.facets && bundle.facets.implicated_code) || [])
    .map((e) => e && e.source_path)
    .filter(Boolean);
  const resolved = new Map();
  for (const sp of implicated) {
    const r = resolveRepoPath(repoRoot, sp);
    if (!r || isExcludedPath(r.rel)) continue;
    try {
      if (fs.statSync(r.abs).isFile()) resolved.set(r.rel, r.abs);
    } catch {
      // Missing implicated file: skip.
    }
  }
  let holders = [...resolved].filter(([, abs]) => {
    try {
      return readFile(abs).includes(badPath);
    } catch {
      return false;
    }
  }).map(([rel]) => rel);

  if (holders.length === 0) {
    const found = grepLiteral(repoRoot, badPath);
    if (Array.isArray(found)) {
      holders = found
        .map((f) => f.replace(/^\.\//, ""))
        .filter((f) => !isExcludedPath(f));
    }
  }
  if (holders.length === 0) return no("bad-path-literal-not-found");
  if (holders.length > 1) return no("ambiguous-literal", holders.slice().sort().join(", "));

  const relPath = holders[0];
  const absPath = resolveRepoPath(repoRoot, relPath).abs;

  const index = Array.isArray(pathIndex) ? pathIndex : buildPathIndex({ repoRoot, bundle });
  const { matched, reason: matchReason } = findUniqueMatch(badPath, index);
  if (!matched) return no(matchReason);

  const replacement = buildReplacement(badPath, matched);
  if (!replacement || normalizeEvidencePath(replacement) === normalizeEvidencePath(badPath)) {
    return no("empty-replacement");
  }

  let original;
  try {
    original = readFile(absPath);
  } catch {
    return no("cannot-read-file");
  }
  const patched = applyWrongPathLiteral(original, badPath, replacement);
  if (patched === null) return no("bad-path-literal-not-found");

  const hunks = diffHunks(original, patched);
  if (hunks.length !== 1) return no("multi-hunk");
  const changedLines = hunks.reduce((n, h) => n + h.changedLines, 0);
  if (changedLines > MAX_PATCH_LINES) return no("patch-too-large");

  const check = syntaxCheck(relPath, patched);
  if (!check.ok) return no("unparseable-patch", check.reason);

  const manual = isWorkflowPath(relPath);
  const patch = {
    path: relPath,
    original,
    patched,
    hunks,
    unifiedDiff: renderUnifiedDiff(relPath, original, hunks),
    repairClass: REPAIR_CLASS_WRONG_PATH_LITERAL,
    evidenceRef: {
      failed_step: (evidence && evidence.failed_step) || null,
      badPath,
      matchedPath: matched,
    },
    application: manual ? "manual" : "direct",
    applicationReason: manual
      ? "workflow files are applied via the GitHub web UI (API token lacks workflow scope)"
      : null,
  };
  const explanation = `Replace wrong path literal '${badPath}' with '${replacement}' `
    + `(unique tier-1 close match: ${matched}) in ${relPath}. `
    + `Evidence: ${patch.evidenceRef.failed_step || "CI failure"} named the bad path. `
    + (manual
      ? "Application: manual -- apply via the GitHub web UI."
      : "Application: direct -- safe to move through branch/PR/review.");
  return { patch, explanation };
}
