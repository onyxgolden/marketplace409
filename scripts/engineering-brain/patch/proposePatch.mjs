/**
 * proposePatch.mjs — Slice 3/4: narrow deterministic patch writer.
 *
 * Closes the loop evidence -> implicated code -> PROPOSED patch. The writer
 * never applies, commits, pushes, merges, or deploys; it returns a patch
 * object (or an honest noPatch) and the existing branch/PR/review machinery
 * moves it from there. No model calls, fully deterministic.
 *
 * Repair classes are tightly defined:
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
 *   Class 2 "wrong-identifier": the failure names an identifier that is not
 *   declared (ReferenceError / no-undef / "Cannot find name"), and exactly
 *   one declared identifier in the file is a unique close match
 *   (levenshtein 1..2, same first character). Whole-identifier replacement.
 *
 *   Class 3 "wrong-config-key": the failure names an unknown key
 *   ("Unknown compiler option 'X'", AJV "additional properties") in a
 *   well-known JSON config (tsconfig.json, package.json), and exactly one
 *   known key is a unique close match. Quoted-key replacement only.
 *
 *   Class 4 "version-pin-drift": npm reports no matching version for
 *   pkg@bad while the committed package-lock.json resolved pkg to a
 *   different version. The writer aligns package.json with the lockfile
 *   (preserving the range operator), never the reverse.
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
export const REPAIR_CLASS_WRONG_IDENTIFIER = "wrong-identifier";
export const REPAIR_CLASS_WRONG_CONFIG_KEY = "wrong-config-key";
export const REPAIR_CLASS_VERSION_PIN_DRIFT = "version-pin-drift";
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

/** git grep for the literal; extraArgs e.g. ["-w"] for whole-word. Null when git is unavailable. */
export function grepLiteralInRepo(repoRoot, literal, extraArgs = []) {
  try {
    const out = execFileSync("git", ["grep", "-l", ...extraArgs, "--fixed-strings", "--", literal, "--", "."], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

/** Escape a literal for use inside a RegExp. */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Classic Levenshtein edit distance (no dependency). */
export function levenshtein(a, b) {
  const s = String(a);
  const t = String(b);
  const m = s.length;
  const n = t.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Exactly one candidate at edit distance 1..2 with the same first character.
 * Distance 0 is excluded (identical strings are not corrections). Zero or
 * several -> noPatch, never a guess.
 */
export function uniqueCloseMatch(bad, candidates) {
  const hits = new Set();
  for (const c of candidates || []) {
    if (!c || c === bad) continue;
    const d = levenshtein(bad, c);
    if (d >= 1 && d <= 2 && c[0] === bad[0]) hits.add(c);
  }
  const uniq = [...hits];
  if (uniq.length === 0) return { matched: null, reason: "no-close-match" };
  if (uniq.length > 1) return { matched: null, reason: "ambiguous-match", detail: uniq.sort().join(", ") };
  return { matched: uniq[0] };
}

/** Whole-identifier RegExp: never matches inside a longer identifier. */
export function wholeWordRegExp(name) {
  return new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(name)}(?![A-Za-z0-9_$])`, "g");
}

function resolveRepoPath(repoRoot, relPath) {
  const root = path.resolve(repoRoot);
  const abs = path.resolve(root, String(relPath).replace(/\\/g, "/"));
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return { abs, rel: path.relative(root, abs).replace(/\\/g, "/") };
}

/**
 * tryWrongPathLiteral({ bundle, evidence, repoRoot, pathIndex?, deps? }) ->
 *   { patch, explanation } | { noPatch: true, reason }
 *
 * Class 1 attempt. bundle: diagnostic bundle
 * (facets.implicated_code[].source_path, past_fixes).
 * evidence: { failed_step, error_lines[], mentioned_paths[] }.
 * pathIndex: override for the known-path pool (built via buildPathIndex when omitted).
 * deps: { readFile, grepLiteral, pathExists } seams for hermetic tests.
 */
export function tryWrongPathLiteral({ bundle, evidence, repoRoot, pathIndex, deps = {} }) {
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

  const loc = locateSingleHolder({
    repoRoot,
    bundle,
    readFile,
    grepLiteral,
    contains: (content) => String(content).includes(badPath),
    grepTerm: badPath,
    notFoundReason: "bad-path-literal-not-found",
    ambiguousReason: "ambiguous-literal",
  });
  if (loc.noPatch) return loc;
  const { relPath, original } = loc;

  const index = Array.isArray(pathIndex) ? pathIndex : buildPathIndex({ repoRoot, bundle });
  const { matched, reason: matchReason } = findUniqueMatch(badPath, index);
  if (!matched) return no(matchReason);

  const replacement = buildReplacement(badPath, matched);
  if (!replacement || normalizeEvidencePath(replacement) === normalizeEvidencePath(badPath)) {
    return no("empty-replacement");
  }

  const patched = applyWrongPathLiteral(original, badPath, replacement);
  if (patched === null) return no("bad-path-literal-not-found");

  const manual = isWorkflowPath(relPath);
  const explanation = `Replace wrong path literal '${badPath}' with '${replacement}' `
    + `(unique tier-1 close match: ${matched}) in ${relPath}. `
    + `Evidence: ${(evidence && evidence.failed_step) || "CI failure"} named the bad path. `
    + (manual
      ? "Application: manual -- apply via the GitHub web UI."
      : "Application: direct -- safe to move through branch/PR/review.");
  return finalizePatch({
    relPath,
    original,
    patched,
    repairClass: REPAIR_CLASS_WRONG_PATH_LITERAL,
    evidenceRef: {
      failed_step: (evidence && evidence.failed_step) || null,
      badPath,
      matchedPath: matched,
    },
    manual,
    explanation,
  });
}

// ---------------------------------------------------------------------------
// Shared attempt machinery (Slice 4)
// ---------------------------------------------------------------------------

/**
 * Locate the single repo file holding the bad literal. Implicated files first,
 * repo-wide git grep as fallback. contains(content) is class-specific (plain
 * substring for paths, whole-word for identifiers, quoted-key for config).
 * Returns { relPath, absPath, original } or { noPatch: true, reason }.
 */
function locateSingleHolder({ repoRoot, bundle, readFile, grepLiteral, contains, grepTerm, notFoundReason, ambiguousReason }) {
  const no = (reason, detail) => ({ noPatch: true, reason, ...(detail ? { detail } : {}) });
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
  const holders = [];
  for (const [rel, abs] of resolved) {
    try {
      if (contains(readFile(abs))) holders.push({ rel, abs });
    } catch {
      // Unreadable implicated file: skip.
    }
  }
  if (holders.length === 0) {
    const found = grepLiteral(repoRoot, grepTerm);
    if (Array.isArray(found)) {
      for (const f of found) {
        const rel = String(f).replace(/^\.\//, "");
        if (isExcludedPath(rel)) continue;
        const r = resolveRepoPath(repoRoot, rel);
        if (r) holders.push({ rel: r.rel, abs: r.abs });
      }
    }
  }
  if (holders.length === 0) return no(notFoundReason);
  if (holders.length > 1) return no(ambiguousReason, holders.map((h) => h.rel).sort().join(", "));
  let original;
  try {
    original = readFile(holders[0].abs);
  } catch {
    return no("cannot-read-file");
  }
  if (!contains(original)) return no(notFoundReason);
  return { relPath: holders[0].rel, absPath: holders[0].abs, original };
}

/**
 * Shared closing rails: exactly one hunk, <= MAX_PATCH_LINES changed lines,
 * patched content must parse per extension. Builds the patch object.
 */
function finalizePatch({ relPath, original, patched, repairClass, evidenceRef, manual, explanation }) {
  const no = (reason, detail) => ({ noPatch: true, reason, ...(detail ? { detail } : {}) });
  if (patched === null || patched === undefined || patched === original) return no("empty-replacement");
  const hunks = diffHunks(original, patched);
  if (hunks.length !== 1) return no("multi-hunk");
  const changedLines = hunks.reduce((n, h) => n + h.changedLines, 0);
  if (changedLines > MAX_PATCH_LINES) return no("patch-too-large");
  const check = syntaxCheck(relPath, patched);
  if (!check.ok) return no("unparseable-patch", check.reason);
  const patch = {
    path: relPath,
    original,
    patched,
    hunks,
    unifiedDiff: renderUnifiedDiff(relPath, original, hunks),
    repairClass,
    evidenceRef,
    application: manual ? "manual" : "direct",
    applicationReason: manual
      ? "workflow files are applied via the GitHub web UI (API token lacks workflow scope)"
      : null,
  };
  return { patch, explanation };
}

/** Collapse values to a single distinct entry: { value } | { value: null, ambiguous }. */
function singleDistinct(values) {
  const uniq = [...new Set(values)];
  if (uniq.length === 0) return { value: null };
  if (uniq.length > 1) return { value: null, ambiguous: true };
  return { value: uniq[0] };
}

// ---------------------------------------------------------------------------
// Class 2: wrong-identifier — a typo'd identifier with one obvious correction
// ---------------------------------------------------------------------------

const BAD_IDENTIFIER_PATTERNS = [
  /ReferenceError:\s*([A-Za-z_$][A-Za-z0-9_$]*)\s+is not defined/,
  /Cannot find name\s+'([A-Za-z_$][A-Za-z0-9_$]*)'/,
  /'([A-Za-z_$][A-Za-z0-9_$]*)'\s+is not defined/,
];

/** Exactly one distinct bad identifier named by the failure, else trigger absent. */
export function extractBadIdentifier(errorLines) {
  const found = [];
  for (const line of errorLines || []) {
    for (const re of BAD_IDENTIFIER_PATTERNS) {
      const m = String(line).match(re);
      if (m) found.push(m[1]);
    }
  }
  const { value, ambiguous } = singleDistinct(found);
  if (ambiguous) return { bad: null, ambiguous: true };
  return { bad: value };
}

/**
 * Declaration names visible in a JS file, via regex (not a parser — no new
 * dependencies). Covers imports, functions, const/let/var, classes.
 * Documented gaps: destructured names, function params, object properties.
 */
export function extractDeclaredIdentifiers(content) {
  const names = new Set();
  const add = (n) => {
    if (n && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n)) names.add(n);
  };
  const text = String(content);
  const grab = (re) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) add(m[1]);
  };
  grab(/import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from/g);
  grab(/import\s*\*\s*as\s+([A-Za-z_$][A-Za-z0-9_$]*)/g);
  grab(/(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g);
  grab(/(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g);
  grab(/class\s+([A-Za-z_$][A-Za-z0-9_$]*)(?:\s|{|$)/g);
  let bm;
  const braceRe = /import\s*\{([^}]*)\}/g;
  while ((bm = braceRe.exec(text))) {
    for (const part of bm[1].split(",")) {
      const bits = part.trim().split(/\s+as\s+/);
      add(bits[bits.length - 1].trim());
    }
  }
  return [...names];
}

/** Whole-identifier substitution; null when the bad name never occurs standalone. */
export function applyWholeWord(content, bad, good) {
  const text = String(content);
  if (!wholeWordRegExp(bad).test(text)) return null;
  return text.replace(wholeWordRegExp(bad), good);
}

/**
 * Regex literal vs division, previous-token heuristic.
 * A `/` starts a regex literal unless the previous significant token ends an
 * expression (identifier, number, string/template/regex, `)`, `]`, `++`/`--`,
 * or an expression-ending keyword like `this`/`true`). `}` is ambiguous
 * (block vs object literal) and is treated conservatively as regex-possible:
 * genuine division after `}` almost always fails the regex-shape check below
 * and falls back to division anyway.
 */
const DIVISION_END_WORDS = new Set(["this", "super", "true", "false", "null"]);
const JS_KEYWORDS = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "enum", "export", "extends", "finally", "for",
  "function", "if", "implements", "import", "in", "instanceof", "interface",
  "let", "new", "of", "package", "private", "protected", "public", "return",
  "static", "switch", "throw", "try", "typeof", "var", "void", "while",
  "with", "yield", "await", ...DIVISION_END_WORDS,
]);

function isWordStart(c) {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "$";
}
function isWordChar(c) {
  return isWordStart(c) || (c >= "0" && c <= "9");
}
function isDigit(c) {
  return c >= "0" && c <= "9";
}

/**
 * Classify the previous significant token for the regex/division decision.
 * prev is { t, v? } with t one of: "other" (operators/openers/start),
 * "ident", "word" (non-expression-ending keyword), "endword", "num", "str",
 * "close" (`)`/`]`), "rbrace" (`}`), "incdec".
 */
function slashStartsRegex(prev) {
  if (!prev) return true;
  switch (prev.t) {
    case "other": return true;
    case "word": return true;
    case "rbrace": return true;
    default: return false; // ident, endword, num, str, close, incdec -> division
  }
}

function classifyWord(word) {
  if (DIVISION_END_WORDS.has(word)) return { t: "endword" };
  if (JS_KEYWORDS.has(word)) return { t: "word" };
  return { t: "ident" };
}

/**
 * Extent of the regex literal starting at `start` (which points at `/`),
 * or -1 when the slash-delimited span is not a valid regex shape. Honors
 * backslash escapes and `[...]` character classes; a newline before the
 * closing `/` means this is not a regex (division or invalid code).
 * Includes trailing flag characters in the extent.
 */
function regexLiteralExtent(source, start) {
  const n = source.length;
  let j = start + 1;
  while (j < n) {
    const c = source[j];
    if (c === "\\") { j += 2; continue; }
    if (c === "[") {
      j += 1;
      while (j < n) {
        const d = source[j];
        if (d === "\\") { j += 2; continue; }
        if (d === "]") { j += 1; break; }
        if (d === "\n" || d === "\r") return -1;
        j += 1;
      }
      continue;
    }
    if (c === "/") {
      j += 1;
      while (j < n && source[j] >= "a" && source[j] <= "z") j += 1;
      return j;
    }
    if (c === "\n" || c === "\r") return -1;
    j += 1;
  }
  return -1;
}

/** Set the previous-token marker on the enclosing code/expr frame, if any. */
function markPrev(stack, t) {
  const top = stack[stack.length - 1];
  if (top && (top.k === "code" || top.k === "expr")) top.prev = { t };
}

/**
 * Code mask for identifier-reference classification. Returns a Uint8Array the
 * length of the source: 1 for characters that are real code, 0 for characters
 * inside string literals, template-literal raw text, comments, or regex
 * literals. Template `${...}` interpolations are treated as code
 * (brace-depth tracked).
 *
 * Regex literals use the previous-token heuristic (see slashStartsRegex) plus
 * a regex-shape validity check; a `/` that fails the shape check is treated
 * as division. Residual heuristic risk errs toward skipping (fail closed: a
 * missed proposal, never a mutated pattern).
 */
function computeCodeMask(source) {
  const n = source.length;
  const mask = new Uint8Array(n);
  const stack = [{ k: "code", prev: { t: "other" } }];
  let i = 0;
  while (i < n) {
    const st = stack[stack.length - 1];
    const c = source[i];
    const nx = i + 1 < n ? source[i + 1] : "";
    const inCode = st.k === "code" || st.k === "expr";
    if (inCode) {
      if (c === "/" && nx === "/") { mask[i] = 0; mask[i + 1] = 0; i += 2; stack.push({ k: "line" }); continue; }
      if (c === "/" && nx === "*") { mask[i] = 0; mask[i + 1] = 0; i += 2; stack.push({ k: "block" }); continue; }
      if (c === "'") { mask[i] = 0; i += 1; stack.push({ k: "sq" }); continue; }
      if (c === '"') { mask[i] = 0; i += 1; stack.push({ k: "dq" }); continue; }
      if (c === "`" && st.k === "code") { mask[i] = 0; i += 1; stack.push({ k: "tpl" }); continue; }
      if (c === "/") {
        // Regex literal or division. Conservative: when the previous token
        // cannot end an expression AND the span has valid regex shape, mask
        // the whole literal out so its body can never be mutated.
        if (slashStartsRegex(st.prev)) {
          const ext = regexLiteralExtent(source, i);
          if (ext !== -1) {
            for (let k = i; k < ext; k++) mask[k] = 0;
            st.prev = { t: "str" };
            i = ext;
            continue;
          }
        }
        mask[i] = 1; st.prev = { t: "other" }; i += 1; continue;
      }
      if (st.k === "expr" && (c === "{" || c === "}")) {
        if (c === "{") { st.depth += 1; mask[i] = 1; st.prev = { t: "other" }; i += 1; continue; }
        if (st.depth === 0) { mask[i] = 0; i += 1; stack.pop(); continue; }
        st.depth -= 1;
        mask[i] = 1; st.prev = { t: "rbrace" }; i += 1; continue;
      }
      if (isWordStart(c)) {
        let j = i + 1;
        while (j < n && isWordChar(source[j])) j += 1;
        for (let k = i; k < j; k++) mask[k] = 1;
        st.prev = classifyWord(source.slice(i, j));
        i = j; continue;
      }
      if (isDigit(c) || (c === "." && isDigit(nx))) {
        let j = i + 1;
        while (j < n && (isWordChar(source[j]) || source[j] === ".")) j += 1;
        for (let k = i; k < j; k++) mask[k] = 1;
        st.prev = { t: "num" };
        i = j; continue;
      }
      if (c === ")" || c === "]") { mask[i] = 1; st.prev = { t: "close" }; i += 1; continue; }
      if (c === "}") { mask[i] = 1; st.prev = { t: "rbrace" }; i += 1; continue; }
      if ((c === "+" && nx === "+") || (c === "-" && nx === "-")) {
        mask[i] = 1; mask[i + 1] = 1; st.prev = { t: "incdec" }; i += 2; continue;
      }
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v") {
        mask[i] = 1; i += 1; continue; // whitespace: previous token unchanged
      }
      mask[i] = 1; st.prev = { t: "other" }; i += 1; continue;
    }
    if (st.k === "line") {
      mask[i] = 0;
      if (c === "\n") stack.pop();
      i += 1; continue;
    }
    if (st.k === "block") {
      mask[i] = 0;
      if (c === "*" && nx === "/") { mask[i + 1] = 0; i += 2; stack.pop(); continue; }
      i += 1; continue;
    }
    if (st.k === "sq" || st.k === "dq") {
      const q = st.k === "sq" ? "'" : '"';
      mask[i] = 0;
      if (c === "\\") { if (i + 1 < n) mask[i + 1] = 0; i += 2; continue; }
      if (c === q) { i += 1; stack.pop(); markPrev(stack, "str"); continue; }
      if (c === "\n") { i += 1; stack.pop(); markPrev(stack, "other"); continue; } // unterminated: bail
      i += 1; continue;
    }
    if (st.k === "tpl") {
      mask[i] = 0;
      if (c === "\\") { if (i + 1 < n) mask[i + 1] = 0; i += 2; continue; }
      if (c === "`") { i += 1; stack.pop(); markPrev(stack, "str"); continue; }
      if (c === "$" && nx === "{") { mask[i + 1] = 0; i += 2; stack.push({ k: "expr", depth: 0, prev: { t: "other" } }); continue; }
      i += 1; continue;
    }
  }
  return mask;
}

function prevCodeChar(source, mask, idx) {
  for (let j = idx - 1; j >= 0; j--) {
    if (!mask[j]) continue;
    const c = source[j];
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v") continue;
    return c;
  }
  return "";
}

function nextCodeChar(source, mask, idx) {
  for (let j = idx; j < source.length; j++) {
    if (!mask[j]) continue;
    const c = source[j];
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v") continue;
    return c;
  }
  return "";
}

/**
 * Identifier-reference substitution. Replaces ONLY occurrences that are real
 * JS identifier references in code. Skips, conservatively (fail closed):
 * - occurrences inside string literals, template raw text, comments, or
 *   regex literals;
 * - member access (`obj.name`, `obj?.name`) -- but not spread (`...name`);
 * - object-literal keys (`{ name: 1 }`) -- but not shorthand or ternaries.
 * Returns null when no safe occurrence exists. Over-skipping yields noPatch
 * (a missed proposal); under-skipping would yield a wrong patch, so the
 * rails err toward skipping.
 */
export function replaceIdentifierReferences(content, bad, good) {
  const text = String(content);
  const re = wholeWordRegExp(bad);
  const mask = computeCodeMask(text);
  const spans = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    let allCode = true;
    for (let k = start; k < end; k++) {
      if (!mask[k]) { allCode = false; break; }
    }
    if (!allCode) continue;
    spans.push([start, end]);
  }
  // Neighbor rules that need lookaround context.
  const kept = [];
  for (const [start, end] of spans) {
    const prev = prevCodeChar(text, mask, start);
    if (prev === ".") {
      const dotIdx = prevCodeIndex(text, mask, start);
      const before = prevCodeChar(text, mask, dotIdx);
      if (before !== ".") continue; // member access like obj.name / obj?.name
      // `...name` spread: a real reference, keep it.
    }
    const next = nextCodeChar(text, mask, end);
    if ((prev === "{" || prev === ",") && next === ":") continue; // object key
    kept.push([start, end]);
  }
  if (kept.length === 0) return null;
  let out = "";
  let cur = 0;
  for (const [s, e] of kept) { out += text.slice(cur, s) + good; cur = e; }
  out += text.slice(cur);
  return out;
}

function prevCodeIndex(source, mask, idx) {
  for (let j = idx - 1; j >= 0; j--) {
    if (!mask[j]) continue;
    const c = source[j];
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v") continue;
    return j;
  }
  return -1;
}

export function tryWrongIdentifier({ bundle, evidence, repoRoot, deps = {} }) {
  const no = (reason, detail) => ({ noPatch: true, reason, ...(detail ? { detail } : {}) });
  const readFile = deps.readFile || ((abs) => fs.readFileSync(abs, "utf8"));
  const grepLiteral = deps.grepLiteral || ((root, lit) => grepLiteralInRepo(root, lit, ["-w"]));

  const { bad, ambiguous } = extractBadIdentifier((evidence && evidence.error_lines) || []);
  if (ambiguous) return no("ambiguous-identifier-trigger");
  if (!bad) return no("trigger-absent");

  const loc = locateSingleHolder({
    repoRoot,
    bundle,
    readFile,
    grepLiteral,
    contains: (content) => wholeWordRegExp(bad).test(String(content)),
    grepTerm: bad,
    notFoundReason: "bad-identifier-not-found",
    ambiguousReason: "ambiguous-identifier",
  });
  if (loc.noPatch) return loc;
  const { relPath, original } = loc;

  const declared = extractDeclaredIdentifiers(original);
  if (declared.includes(bad)) return no("identifier-already-declared");
  const { matched, reason, detail } = uniqueCloseMatch(bad, declared);
  if (!matched) return no(reason === "ambiguous-match" ? "ambiguous-identifier-match" : reason, detail);

  const patched = replaceIdentifierReferences(original, bad, matched);
  if (patched === null) return no("bad-identifier-not-found");

  const manual = isWorkflowPath(relPath);
  const explanation = `Replace wrong identifier '${bad}' with '${matched}' `
    + `(unique close declaration in ${relPath}). `
    + `Evidence: ${(evidence && evidence.failed_step) || "CI failure"} reported '${bad}' as not defined. `
    + (manual
      ? "Application: manual -- apply via the GitHub web UI."
      : "Application: direct -- safe to move through branch/PR/review.");
  return finalizePatch({
    relPath,
    original,
    patched,
    repairClass: REPAIR_CLASS_WRONG_IDENTIFIER,
    evidenceRef: {
      failed_step: (evidence && evidence.failed_step) || null,
      badIdentifier: bad,
      matchedIdentifier: matched,
    },
    manual,
    explanation,
  });
}

// ---------------------------------------------------------------------------
// Class 3: wrong-config-key — a misspelled key in a well-known JSON config
// ---------------------------------------------------------------------------

/**
 * Known keys per well-known config basename. Only these files are eligible;
 * anything else -> trigger absent for this class. scripts.* keys and other
 * user-defined maps are intentionally not listed (never guess those).
 */
export const KNOWN_CONFIG_KEYS = {
  "tsconfig.json": [
    // top-level
    "compilerOptions", "files", "include", "exclude", "extends", "references",
    "typeAcquisition", "watchOptions",
    // compilerOptions (curated common set)
    "target", "module", "moduleResolution", "lib", "outDir", "rootDir",
    "strict", "strictNullChecks", "strictFunctionTypes",
    "strictBindCallApply", "strictPropertyInitialization",
    "noImplicitAny", "noImplicitThis", "alwaysStrict",
    "esModuleInterop", "allowSyntheticDefaultImports", "skipLibCheck",
    "forceConsistentCasingInFileNames", "resolveJsonModule",
    "declaration", "declarationMap", "sourceMap", "inlineSourceMap",
    "noEmit", "emitDeclarationOnly", "downlevelIteration",
    "experimentalDecorators", "emitDecoratorMetadata",
    "jsx", "allowJs", "checkJs", "types", "typeRoots",
    "baseUrl", "paths", "incremental", "composite",
    "noUnusedLocals", "noUnusedParameters", "noFallthroughCasesInSwitch",
    "isolatedModules", "verbatimModuleSyntax", "erasableSyntaxOnly",
  ],
  "package.json": [
    "name", "version", "description", "keywords", "homepage", "bugs",
    "license", "author", "contributors", "funding", "files", "main",
    "browser", "bin", "man", "directories", "repository", "scripts",
    "config", "dependencies", "devDependencies", "peerDependencies",
    "bundleDependencies", "optionalDependencies", "engines", "os", "cpu",
    "private", "publishConfig", "type", "exports", "imports", "workspaces",
  ],
};

const BAD_CONFIG_KEY_PATTERNS = [
  /Unknown compiler option\s+'([^']+)'/,
  /unknown option\s+'([^']+)'/i,
  /must NOT have additional propert(?:y|ies)\s+'([^']+)'/,
];

/** Exactly one distinct bad config key named by the failure, else trigger absent. */
export function extractBadConfigKey(errorLines) {
  const found = [];
  for (const line of errorLines || []) {
    for (const re of BAD_CONFIG_KEY_PATTERNS) {
      const m = String(line).match(re);
      if (m) found.push(m[1]);
    }
  }
  const { value, ambiguous } = singleDistinct(found);
  if (ambiguous) return { bad: null, ambiguous: true };
  return { bad: value };
}

/** Replace the double-quoted key only; values are untouched. Null when absent. */
export function applyQuotedKey(content, badKey, goodKey) {
  const text = String(content);
  const probe = new RegExp(`"${escapeRegExp(badKey)}"(\\s*:)`, "g");
  if (!probe.test(text)) return null;
  return text.replace(new RegExp(`"${escapeRegExp(badKey)}"(\\s*:)`, "g"), `"${goodKey}"$1`);
}

export function tryWrongConfigKey({ bundle, evidence, repoRoot, deps = {} }) {
  const no = (reason, detail) => ({ noPatch: true, reason, ...(detail ? { detail } : {}) });
  const readFile = deps.readFile || ((abs) => fs.readFileSync(abs, "utf8"));
  const grepLiteral = deps.grepLiteral || ((root, lit) => grepLiteralInRepo(root, lit));

  const { bad, ambiguous } = extractBadConfigKey((evidence && evidence.error_lines) || []);
  if (ambiguous) return no("ambiguous-config-key-trigger");
  if (!bad) return no("trigger-absent");

  const loc = locateSingleHolder({
    repoRoot,
    bundle,
    readFile,
    grepLiteral,
    contains: (content) => new RegExp(`"${escapeRegExp(bad)}"(\\s*:)`).test(String(content)),
    grepTerm: `"${bad}"`,
    notFoundReason: "bad-config-key-not-found",
    ambiguousReason: "ambiguous-config-key",
  });
  if (loc.noPatch) return loc;
  const { relPath, original } = loc;

  const base = String(relPath).split("/").pop();
  const known = KNOWN_CONFIG_KEYS[base];
  if (!known) return no("unknown-config-file");
  const { matched, reason, detail } = uniqueCloseMatch(bad, known);
  if (!matched) return no(reason === "ambiguous-match" ? "ambiguous-config-key-match" : reason, detail);

  const patched = applyQuotedKey(original, bad, matched);
  if (patched === null) return no("bad-config-key-not-found");

  const manual = isWorkflowPath(relPath);
  const explanation = `Replace wrong config key '${bad}' with '${matched}' in ${relPath}. `
    + `Evidence: ${(evidence && evidence.failed_step) || "CI failure"} reported the key as unknown. `
    + (manual
      ? "Application: manual -- apply via the GitHub web UI."
      : "Application: direct -- safe to move through branch/PR/review.");
  return finalizePatch({
    relPath,
    original,
    patched,
    repairClass: REPAIR_CLASS_WRONG_CONFIG_KEY,
    evidenceRef: {
      failed_step: (evidence && evidence.failed_step) || null,
      badKey: bad,
      matchedKey: matched,
    },
    manual,
    explanation,
  });
}

// ---------------------------------------------------------------------------
// Class 4: version-pin-drift — package.json pins an unresolvable version while
// the committed package-lock.json already resolved the package elsewhere.
// Conservative direction: align the manifest with the lockfile, never reverse.
// ---------------------------------------------------------------------------

const BAD_VERSION_PIN_PATTERNS = [
  /No matching version found for\s+([A-Za-z0-9_@./-]+?)@([A-Za-z0-9_.-]*[A-Za-z0-9_])/,
];

/** Exactly one distinct (package, version) pair, else trigger absent. */
export function extractBadVersionPin(errorLines) {
  const found = [];
  for (const line of errorLines || []) {
    for (const re of BAD_VERSION_PIN_PATTERNS) {
      const m = String(line).match(re);
      if (m) found.push({ pkg: m[1], version: m[2] });
    }
  }
  const keys = found.map((f) => `${f.pkg}@${f.version}`);
  const { value, ambiguous } = singleDistinct(keys);
  if (ambiguous) return { bad: null, ambiguous: true };
  if (!value) return { bad: null };
  return { bad: found[keys.indexOf(value)] };
}

/**
 * The committed lockfile's resolved version for a package. Checks the modern
 * `packages["node_modules/pkg"]` map and the legacy `dependencies` map.
 * Null when the lockfile is missing/unparseable or the package is absent.
 */
export function readLockfileVersion(repoRoot, pkg, readText) {
  const read = readText || ((abs) => fs.readFileSync(abs, "utf8"));
  let lock;
  try {
    lock = JSON.parse(read(path.join(path.resolve(repoRoot), "package-lock.json")));
  } catch {
    return null;
  }
  const modern = lock && lock.packages && lock.packages[`node_modules/${pkg}`];
  if (modern && modern.version) return String(modern.version);
  const legacy = lock && lock.dependencies && lock.dependencies[pkg];
  if (legacy && legacy.version) return String(legacy.version);
  return null;
}

/** Split "^1.2.3" into { operator: "^", version: "1.2.3" }; null when unparseable. */
export function splitVersionSpec(spec) {
  const m = String(spec).trim().match(/^([\^~<>=]+)?\s*([A-Za-z0-9_.-]+)$/);
  if (!m) return null;
  return { operator: m[1] || "", version: m[2] };
}

/**
 * Replace pkg's version value in package.json, preserving the original range
 * operator ("^9.9.9" -> "^1.3.0"). Null unless exactly one declaration exists
 * and its version part equals badVersion (evidence must describe the live file).
 */
export function applyVersionPin(content, pkg, badVersion, lockedVersion) {
  const text = String(content);
  const re = new RegExp(`"${escapeRegExp(pkg)}"\\s*:\\s*"([^"]*)"`, "g");
  const hits = [];
  let m;
  while ((m = re.exec(text))) hits.push({ index: m.index, raw: m[0], spec: m[1] });
  if (hits.length !== 1) return null;
  const split = splitVersionSpec(hits[0].spec);
  if (!split || split.version !== badVersion) return null;
  const next = `${split.operator}${lockedVersion}`;
  if (next === hits[0].spec) return null;
  const rebuilt = hits[0].raw.replace(`"${hits[0].spec}"`, `"${next}"`);
  return text.slice(0, hits[0].index) + rebuilt + text.slice(hits[0].index + hits[0].raw.length);
}

export function tryVersionPinDrift({ evidence, repoRoot, deps = {} }) {
  const no = (reason, detail) => ({ noPatch: true, reason, ...(detail ? { detail } : {}) });
  const readFile = deps.readFile || ((abs) => fs.readFileSync(abs, "utf8"));

  const { bad, ambiguous } = extractBadVersionPin((evidence && evidence.error_lines) || []);
  if (ambiguous) return no("ambiguous-version-pin-trigger");
  if (!bad) return no("trigger-absent");

  const manifestRel = "package.json";
  const manifestAbs = path.join(path.resolve(repoRoot), manifestRel);
  let original;
  try {
    original = readFile(manifestAbs);
  } catch {
    return no("no-package-manifest");
  }

  const locked = readLockfileVersion(repoRoot, bad.pkg, readFile);
  if (!locked) return no("package-not-in-lockfile");
  if (locked === bad.version) return no("lockfile-agrees-with-pin");

  const patched = applyVersionPin(original, bad.pkg, bad.version, locked);
  if (patched === null) return no("pin-not-found-or-ambiguous");

  const manual = isWorkflowPath(manifestRel);
  const explanation = `Align ${bad.pkg} pin from '${bad.version}' to '${locked}' in package.json `
    + "(committed package-lock.json resolved version). "
    + `Evidence: ${(evidence && evidence.failed_step) || "CI failure"} reported no matching version `
    + `for ${bad.pkg}@${bad.version}. `
    + "Application: direct -- safe to move through branch/PR/review.";
  return finalizePatch({
    relPath: manifestRel,
    original,
    patched,
    repairClass: REPAIR_CLASS_VERSION_PIN_DRIFT,
    evidenceRef: {
      failed_step: (evidence && evidence.failed_step) || null,
      package: bad.pkg,
      badVersion: bad.version,
      lockedVersion: locked,
    },
    manual,
    explanation,
  });
}

/**
 * proposePatch({ bundle, evidence, repoRoot, pathIndex?, deps? }) ->
 *   { patch, explanation } | { noPatch: true, reason }
 *
 * Tries each repair class in order; the first class that yields a patch wins.
 * Classes are independent and fail-closed: a noPatch from one class never
 * blocks another class whose own trigger fired. When nothing fires, the first
 * non-trigger reason is returned (else "no-repair-trigger").
 */
export function proposePatch({ bundle, evidence, repoRoot, pathIndex, deps = {} }) {
  const args = { bundle, evidence, repoRoot, pathIndex, deps };
  const attempts = [tryWrongPathLiteral, tryWrongIdentifier, tryWrongConfigKey, tryVersionPinDrift];
  // Every class names its own "my trigger did not fire" reason.
  const TRIGGER_ABSENT_REASONS = new Set(["trigger-absent", "no-mentioned-paths"]);
  let firstReal = null;
  for (const attempt of attempts) {
    const r = attempt(args);
    if (!r.noPatch) return r;
    if (!firstReal && !TRIGGER_ABSENT_REASONS.has(r.reason)) firstReal = r;
  }
  return firstReal || { noPatch: true, reason: "no-repair-trigger" };
}
