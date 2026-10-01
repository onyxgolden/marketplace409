/**
 * proposeDocFix.mjs — Slice 10: deterministic doc-drift rewrite proposer.
 *
 * Takes one drift finding from detectDocDrift.mjs and proposes a narrow,
 * section-scoped rewrite. Returns { patch, explanation } where patch is
 * shaped for the existing prepareFixPr pipeline:
 *   { repairClass, path, original, patched, unifiedDiff }
 * or { noPatch: true, reason } — never a guess.
 *
 * Repair classes:
 *   D1 "doc-dead-path-literal": dead backtick path -> unique tier-1 close
 *      match (Slice 2's rule, reused verbatim via findUniqueMatch), rebuilt
 *      with buildReplacement so trailing globs survive.
 *   D2 "doc-dead-script-ref": dead `npm run <name>` -> unique levenshtein
 *      1..2 close match among package.json scripts (Slice 3 Class 2 rule).
 *   D3 "doc-dead-doc-link": dead relative .md link -> unique tier-1 close
 *      match among known docs, re-relativized to the doc's directory,
 *      preserving any #anchor.
 *
 * Safety rails (mirroring the code classes):
 * - docs only: target must be a .md file under docs/ (never code, never
 *   manifests, never workflows)
 * - one file, one hunk, max 20 changed lines
 * - the rewrite is scoped to the finding's enclosing ATX section; the dead
 *   literal must occur inside that section
 * - ambiguous matches, missing literals, multi-hunk results -> noPatch
 * - no model calls
 */

import path from "node:path";
import {
  findUniqueMatch,
  buildReplacement,
  uniqueCloseMatch,
  diffHunks,
  renderUnifiedDiff,
  isExcludedPath,
  MAX_PATCH_LINES,
} from "../patch/proposePatch.mjs";
import {
  DRIFT_DEAD_PATH,
  DRIFT_DEAD_SCRIPT,
  DRIFT_DEAD_LINK,
  resolveDocLiteral,
} from "./detectDocDrift.mjs";

export const REPAIR_CLASS_DOC_DEAD_PATH = DRIFT_DEAD_PATH;
export const REPAIR_CLASS_DOC_DEAD_SCRIPT = DRIFT_DEAD_SCRIPT;
export const REPAIR_CLASS_DOC_DEAD_LINK = DRIFT_DEAD_LINK;

/** True when relPath is a docs markdown file we are allowed to rewrite. */
export function isDocRewriteTarget(relPath) {
  const norm = String(relPath || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!norm.endsWith(".md")) return false;
  if (!norm.startsWith("docs/")) return false;
  if (isExcludedPath(norm)) return false;
  return true;
}

const ATX_RE = /^(#{1,6})\s/;

/**
 * Bounds (0-based, end-exclusive) of the ATX section containing lineIdx.
 * A section starts at the nearest preceding ATX heading (or the top of the
 * file when there is none) and ends before the next heading of equal or
 * higher level (or EOF).
 */
export function sectionBounds(lines, lineIdx) {
  let start = 0;
  let level = 7; // preamble: only a level-1..6 heading can end it
  for (let i = lineIdx; i >= 0; i -= 1) {
    const m = ATX_RE.exec(lines[i]);
    if (m) {
      start = i;
      level = m[1].length;
      break;
    }
  }
  let end = lines.length;
  for (let i = start + (start === 0 && level === 7 ? 0 : 1); i < lines.length; i += 1) {
    if (i === start) continue;
    const m = ATX_RE.exec(lines[i]);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** Escape a literal for use in a RegExp. */
function escRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace every occurrence of `bad` with `good` inside the section, keeping
 * the rest of the document byte-identical. Returns the patched full text, or
 * null when the literal does not occur in the section.
 */
export function replaceInSection(text, line /* 1-based */, bad, good) {
  const lines = String(text).split("\n");
  const { start, end } = sectionBounds(lines, line - 1);
  const section = lines.slice(start, end).join("\n");
  if (!section.includes(bad)) return null;
  const patchedSection = section.split(bad).join(good);
  return [...lines.slice(0, start), ...patchedSection.split("\n"), ...lines.slice(end)].join("\n");
}

function finalizePatch({ docPath, original, patched, repairClass, explanation }) {
  if (patched === null || patched === undefined) {
    return { patch: { noPatch: true, reason: "literal-not-in-section" }, explanation };
  }
  if (patched === original) {
    return { patch: { noPatch: true, reason: "no-change" }, explanation };
  }
  const hunks = diffHunks(original, patched);
  if (hunks.length !== 1) {
    return { patch: { noPatch: true, reason: "multi-hunk" }, explanation };
  }
  const changedLines = hunks[0].changedLines;
  if (changedLines > MAX_PATCH_LINES) {
    return { patch: { noPatch: true, reason: "too-many-lines" }, explanation };
  }
  return {
    patch: {
      repairClass,
      path: docPath,
      original,
      patched,
      unifiedDiff: renderUnifiedDiff(docPath, original, hunks),
    },
    explanation,
  };
}

/**
 * Propose a fix for one drift finding.
 *   finding:    { driftClass, docPath, line, literal }
 *   docText:    full current text of the doc
 *   candidates: array of repo-relative file paths (for D1)
 *   scriptNames: array of package.json script names (for D2)
 *   docFiles:   array of repo-relative .md paths (for D3)
 */
export function proposeDocFix({ finding, docText, candidates = [], scriptNames = [], docFiles = [] }) {
  const { driftClass, docPath, line, literal } = finding || {};
  const original = String(docText || "");

  if (!isDocRewriteTarget(docPath)) {
    return {
      patch: { noPatch: true, reason: "not-a-doc-target" },
      explanation: `${docPath} is not a rewriteable docs target.`,
    };
  }

  if (driftClass === DRIFT_DEAD_PATH) {
    const { repoRelative, style } = resolveDocLiteral(docPath, literal);
    const m = findUniqueMatch(repoRelative, candidates);
    if (!m.matched) {
      return {
        patch: { noPatch: true, reason: m.reason || "no-close-match" },
        explanation: `No unique close match for dead path \`${literal}\`.`,
      };
    }
    let replacement;
    if (style === "doc-relative") {
      // The doc speaks relative to its own directory; answer in kind.
      const rel = path.posix.relative(path.posix.dirname(docPath), m.matched);
      replacement = rel.startsWith(".") ? rel : `./${rel}`;
    } else {
      replacement = buildReplacement(literal, m.matched);
    }
    if (!replacement) {
      return {
        patch: { noPatch: true, reason: "no-sane-replacement" },
        explanation: `Matched \`${m.matched}\` but no sane replacement literal could be built.`,
      };
    }
    const patched = replaceInSection(original, line, `\`${literal}\``, `\`${replacement}\``)
      ?? replaceInSection(original, line, literal, replacement);
    return finalizePatch({
      docPath,
      original,
      patched,
      repairClass: REPAIR_CLASS_DOC_DEAD_PATH,
      explanation: `Dead path \`${literal}\` -> \`${replacement}\` (unique tier-${m.tier} match).`,
    });
  }

  if (driftClass === DRIFT_DEAD_SCRIPT) {
    const m = uniqueCloseMatch(literal, scriptNames);
    if (!m.matched) {
      return {
        patch: { noPatch: true, reason: m.reason || "no-close-match" },
        explanation: `No unique close script-name match for \`${literal}\`.`,
      };
    }
    const re = new RegExp(`(npm\\s+run(?:-script)?\\s+)${escRe(literal)}\\b`);
    const lines = original.split("\n");
    const { start, end } = sectionBounds(lines, line - 1);
    let replaced = false;
    const out = lines.map((ln, i) => {
      if (i < start || i >= end) return ln;
      const next = ln.replace(re, `$1${m.matched}`);
      if (next !== ln) replaced = true;
      return next;
    });
    const patched = replaced ? out.join("\n") : null;
    return finalizePatch({
      docPath,
      original,
      patched,
      repairClass: REPAIR_CLASS_DOC_DEAD_SCRIPT,
      explanation: `Dead script ref \`${literal}\` -> \`${m.matched}\` (unique close match).`,
    });
  }

  if (driftClass === DRIFT_DEAD_LINK) {
    const [targetNoAnchor, anchor] = String(literal).split("#");
    const dir = path.posix.dirname(docPath);
    const repoTarget = path.posix.normalize(path.posix.join(dir, targetNoAnchor));
    const m = findUniqueMatch(repoTarget, docFiles);
    if (!m.matched) {
      return {
        patch: { noPatch: true, reason: m.reason || "no-close-match" },
        explanation: `No unique close match for dead doc link \`${literal}\`.`,
      };
    }
    let rel = path.posix.relative(dir, m.matched);
    if (!rel.startsWith(".")) rel = `./${rel}`;
    const replacement = anchor ? `${rel}#${anchor}` : rel;
    const patched = replaceInSection(original, line, `(${literal})`, `(${replacement})`);
    return finalizePatch({
      docPath,
      original,
      patched,
      repairClass: REPAIR_CLASS_DOC_DEAD_LINK,
      explanation: `Dead doc link \`${literal}\` -> \`${replacement}\` (unique tier-${m.tier} match).`,
    });
  }

  return {
    patch: { noPatch: true, reason: "unknown-drift-class" },
    explanation: `Unknown drift class ${driftClass}.`,
  };
}
