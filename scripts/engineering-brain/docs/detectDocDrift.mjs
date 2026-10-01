/**
 * detectDocDrift.mjs — Slice 10: deterministic doc-drift detection.
 *
 * Scans repo docs for references that no longer match reality. No model
 * calls, fully deterministic. Detection only — it never edits; the rewrite
 * proposal lives in proposeDocFix.mjs.
 *
 * Drift classes (all narrow, all fail-closed):
 *
 *   D1 "doc-dead-path-literal": a backtick-quoted repo-relative path in a doc
 *   does not exist in the repo (globs resolved like the code Class 1 rule).
 *
 *   D2 "doc-dead-script-ref": a doc shows `npm run <name>` (or npx / node
 *   scripts/<name>.mjs style) where <name> is not a package.json script.
 *
 *   D3 "doc-dead-doc-link": a relative markdown link `[text](target)` points
 *   at a .md file that does not exist (anchors stripped before checking).
 *
 * A finding is { driftClass, docPath, line (1-based), literal, detail }.
 * Whether a finding is *fixable* (unique close match) is decided by
 * proposeDocFix.mjs — detection reports every dead reference honestly.
 */

import fs from "node:fs";
import path from "node:path";

export const DRIFT_DEAD_PATH = "doc-dead-path-literal";
export const DRIFT_DEAD_SCRIPT = "doc-dead-script-ref";
export const DRIFT_DEAD_LINK = "doc-dead-doc-link";

const DEFAULT_DOC_DIRS = ["docs"];
const MAX_FINDINGS_PER_DOC = 25;

/** Walk dir recursively, collecting *.md files. Pure I/O, no following of symlinked dirs. */
export function listDocFiles(repoRoot, dirs = DEFAULT_DOC_DIRS) {
  const out = [];
  const visit = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        visit(full);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        out.push(path.relative(repoRoot, full).replace(/\\/g, "/"));
      }
    }
  };
  for (const d of dirs) visit(path.join(repoRoot, d));
  return out.sort();
}

/** All backtick-quoted literals with their 1-based line numbers. */
export function extractBacktickLiterals(text) {
  const out = [];
  const lines = String(text).split("\n");
  const re = /`([^`\n]+)`/g;
  lines.forEach((line, i) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      out.push({ literal: m[1], line: i + 1 });
    }
  });
  return out;
}

/**
 * Heuristic: does this literal look like a repo-relative path worth checking?
 * Skips URLs, absolute paths, home-dir paths, bare filenames, and anything
 * with whitespace. Requires a file extension, a trailing slash, or a glob
 * character — this keeps git refs like `origin/main` and branch names like
 * `feat/foo` out of the path check.
 */
export function looksLikeRepoPath(literal) {
  const s = String(literal || "").trim();
  if (!s || /\s/.test(s)) return false;
  if (/^(https?:|mailto:|ftp:)/i.test(s)) return false;
  if (s.startsWith("/") || s.startsWith("~")) return false;
  if (!s.includes("/")) return false;
  if (s.length > 220) return false;
  if (!/[.]/.test(s) && !s.endsWith("/") && !/[*?[]/.test(s)) return false;
  // A bare `./name` (no subdirectory) is almost always an import-specifier
  // example in prose ("`./ImportWarning` vs `./ImportWarning.js`"), not a
  // claim about a repo path. Skip it rather than "fix" someone's example.
  if (/^\.\/[^/]+$/.test(s)) return false;
  return /^[A-Za-z0-9_.@][A-Za-z0-9_.@\-/{}*?[\]]*$/.test(s);
}

/** `npm run <name>` / `npm run-script <name>` refs with 1-based line numbers. */
export function extractNpmRunRefs(text) {
  const out = [];
  const lines = String(text).split("\n");
  const re = /npm\s+run(?:-script)?\s+([A-Za-z0-9:_.-]+)/g;
  lines.forEach((line, i) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      out.push({ name: m[1], line: i + 1 });
    }
  });
  return out;
}

/** Relative markdown links `[text](target)` with 1-based line numbers. */
export function extractDocLinks(text) {
  const out = [];
  const lines = String(text).split("\n");
  const re = /\[([^\]]*)\]\(([^)\s]+)\)/g;
  lines.forEach((line, i) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      const target = m[2].split("#")[0];
      if (!target || /^(https?:|mailto:|#)/i.test(target)) continue;
      if (!target.endsWith(".md")) continue;
      out.push({ target, line: i + 1 });
    }
  });
  return out;
}

/**
 * Resolve a doc literal to a repo-relative path. Literals starting with
 * `./` or `../` are relative to the doc's own directory (the common docs
 * convention); everything else is treated as repo-root-relative, mirroring
 * how the code repair classes read evidence paths.
 */
export function resolveDocLiteral(docPath, literal) {
  const s = String(literal || "");
  if (s.startsWith("./") || s.startsWith("../")) {
    return {
      repoRelative: path.posix.normalize(path.posix.join(path.posix.dirname(docPath), s)),
      style: "doc-relative",
    };
  }
  return { repoRelative: s, style: "root-relative" };
}

/**
 * Detect drift in one doc's text. All repo access goes through injected
 * seams so tests stay hermetic:
 *   pathExists(p)       — does repo-relative path p exist (globs resolved)?
 *   scriptNames         — array of package.json script names (for D2)
 *   docFileSet          — Set of repo-relative .md paths (for D3)
 *   linkExists(fromDoc, target) — does the link target resolve?
 */
export function detectDocDrift({
  docPath,
  text,
  pathExists,
  scriptNames = [],
  docFileSet = new Set(),
  linkExists = null,
}) {
  const findings = [];
  const seen = new Set();
  const push = (f) => {
    const key = `${f.driftClass}:${f.line}:${f.literal}`;
    if (seen.has(key) || findings.length >= MAX_FINDINGS_PER_DOC) return;
    seen.add(key);
    findings.push(f);
  };

  for (const { literal, line } of extractBacktickLiterals(text)) {
    if (!looksLikeRepoPath(literal)) continue;
    const { repoRelative } = resolveDocLiteral(docPath, literal);
    let exists = false;
    try {
      exists = pathExists(repoRelative);
    } catch {
      exists = false;
    }
    if (!exists) {
      push({ driftClass: DRIFT_DEAD_PATH, docPath, line, literal });
    }
  }

  const scripts = new Set(scriptNames);
  for (const { name, line } of extractNpmRunRefs(text)) {
    if (!scripts.has(name)) {
      push({ driftClass: DRIFT_DEAD_SCRIPT, docPath, line, literal: name });
    }
  }

  const resolveLink =
    linkExists ||
    ((fromDoc, target) => {
      const dir = path.posix.dirname(fromDoc);
      const norm = path.posix.normalize(path.posix.join(dir, target));
      return docFileSet.has(norm);
    });
  for (const { target, line } of extractDocLinks(text)) {
    let ok = false;
    try {
      ok = resolveLink(docPath, target);
    } catch {
      ok = false;
    }
    if (!ok) {
      push({ driftClass: DRIFT_DEAD_LINK, docPath, line, literal: target });
    }
  }

  return findings;
}
