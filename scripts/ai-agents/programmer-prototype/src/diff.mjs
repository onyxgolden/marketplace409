/**
 * diff.mjs — unified diff parsing and all-or-nothing exact application.
 * Pure module: no I/O. No fuzzy matching, no partial apply.
 *
 * Accepted format (subset of unified diff):
 *   --- a/<path> | --- <path> | --- /dev/null   (new file)
 *   +++ b/<path> | +++ <path> | +++ /dev/null   (deletion -> rejected)
 *   @@ -l,c +l,c @@
 *   context lines start with ' ', removals '-', additions '+'.
 * Renames (different old/new path), mode changes and binary markers are
 * rejected: binary/rename/deletion are out of slice scope.
 */

import { REASON } from "./constants.mjs";

const MAX_DIFF_BYTES = 64 * 1024;

function stripPrefix(p) {
  if (p === "/dev/null") return null;
  return p.replace(/^(a|b)\//, "");
}

export function parseUnifiedDiff(text) {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_DIFF_BYTES) {
    return { ok: false, reason: REASON.PATCH_MALFORMED, detail: "empty-or-oversize" };
  }
  if (/^Binary files /m.test(text) || /GIT binary patch/i.test(text)) {
    return { ok: false, reason: REASON.OPERATION_FORBIDDEN, detail: "binary-patch" };
  }
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const files = [];
  let i = 0;
  while (i < lines.length) {
    const mOld = lines[i].match(/^--- (\S.*)$/);
    if (!mOld) return { ok: false, reason: REASON.PATCH_MALFORMED, detail: `expected --- at line ${i + 1}` };
    const mNew = (lines[i + 1] || "").match(/^\+\+\+ (\S.*)$/);
    if (!mNew) return { ok: false, reason: REASON.PATCH_MALFORMED, detail: `expected +++ at line ${i + 2}` };
    const oldPath = stripPrefix(mOld[1].trim());
    const newPath = stripPrefix(mNew[1].trim());
    if (oldPath === null && newPath === null) {
      return { ok: false, reason: REASON.PATCH_MALFORMED, detail: "null-null-file" };
    }
    if (oldPath !== null && newPath !== null && oldPath !== newPath) {
      return { ok: false, reason: REASON.OPERATION_FORBIDDEN, detail: "rename-out-of-scope" };
    }
    if (newPath === null) {
      return { ok: false, reason: REASON.OPERATION_FORBIDDEN, detail: "deletion-out-of-scope" };
    }
    const op = oldPath === null ? "add" : "modify";
    i += 2;
    const hunks = [];
    while (i < lines.length && lines[i].startsWith("@@")) {
      const hm = lines[i].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!hm) return { ok: false, reason: REASON.PATCH_MALFORMED, detail: `bad hunk header line ${i + 1}` };
      const hunk = {
        oldStart: parseInt(hm[1], 10),
        oldCount: hm[2] === undefined ? 1 : parseInt(hm[2], 10),
        newStart: parseInt(hm[3], 10),
        newCount: hm[4] === undefined ? 1 : parseInt(hm[4], 10),
        lines: [],
      };
      i++;
      let seenOld = 0;
      let seenNew = 0;
      while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("--- ")) {
        const ln = lines[i];
        const kind = ln[0];
        if (kind !== " " && kind !== "-" && kind !== "+") {
          return { ok: false, reason: REASON.PATCH_MALFORMED, detail: `bad hunk line ${i + 1}` };
        }
        if (kind === "\\") {
          i++;
          continue; // "\ No newline at end of file" marker
        }
        hunk.lines.push({ kind, text: ln.slice(1) });
        if (kind !== "+") seenOld++;
        if (kind !== "-") seenNew++;
        i++;
      }
      if (seenOld !== hunk.oldCount || seenNew !== hunk.newCount) {
        return { ok: false, reason: REASON.PATCH_MALFORMED, detail: `hunk count mismatch line ${i + 1}` };
      }
      hunks.push(hunk);
    }
    if (hunks.length === 0) return { ok: false, reason: REASON.PATCH_MALFORMED, detail: "file-without-hunks" };
    files.push({ path: newPath, operation: op, hunks });
  }
  return { ok: true, files };
}

export function diffStats(parsed) {
  let added = 0;
  let removed = 0;
  for (const f of parsed.files) {
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.kind === "+") added++;
        if (l.kind === "-") removed++;
      }
    }
  }
  return { files: parsed.files.length, added, removed, addedRemoved: added + removed };
}

/**
 * Apply a parsed diff to a snapshot { path -> content } exactly.
 * All-or-nothing: any hunk mismatch aborts with no partial result.
 * Returns { ok:true, files: Map(path->newContent) } or { ok:false, reason, detail }.
 */
export function applyDiffExact(parsed, snapshot) {
  const out = new Map();
  for (const f of parsed.files) {
    if (f.operation === "add") {
      if (snapshot.has(f.path)) {
        return { ok: false, reason: REASON.PATCH_NOT_APPLICABLE, detail: `add-over-existing:${f.path}` };
      }
      const built = [];
      for (const h of f.hunks) {
        if (h.oldStart !== 0 && h.oldCount !== 0 && !(h.oldStart === 1 && h.oldCount === 0)) {
          // new-file hunks must start at 0,0 (allow the common 1,0 form)
        }
        for (const l of h.lines) {
          if (l.kind === " ") {
            return { ok: false, reason: REASON.PATCH_NOT_APPLICABLE, detail: `context-in-new-file:${f.path}` };
          }
          if (l.kind === "-") {
            return { ok: false, reason: REASON.PATCH_NOT_APPLICABLE, detail: `removal-in-new-file:${f.path}` };
          }
          built.push(l.text);
        }
      }
      out.set(f.path, built.join("\n") + "\n");
      continue;
    }
    // modify
    if (!snapshot.has(f.path)) {
      return { ok: false, reason: REASON.PATCH_NOT_APPLICABLE, detail: `missing-base:${f.path}` };
    }
    const baseLines = snapshot.get(f.path).split("\n");
    if (baseLines[baseLines.length - 1] === "") baseLines.pop();
    const result = [...baseLines];
    // Apply hunks bottom-up so earlier line numbers stay valid.
    const ordered = [...f.hunks].sort((a, b) => b.oldStart - a.oldStart);
    for (const h of ordered) {
      const at = h.oldStart - 1; // 0-based
      if (at < 0 || at + h.oldCount > result.length) {
        return { ok: false, reason: REASON.PATCH_NOT_APPLICABLE, detail: `hunk-range:${f.path}` };
      }
      const slice = result.slice(at, at + h.oldCount);
      let si = 0;
      const replacement = [];
      for (const l of h.lines) {
        if (l.kind === " ") {
          if (slice[si] !== l.text) {
            return { ok: false, reason: REASON.PATCH_NOT_APPLICABLE, detail: `context-mismatch:${f.path}@${h.oldStart + si}` };
          }
          replacement.push(slice[si]);
          si++;
        } else if (l.kind === "-") {
          if (slice[si] !== l.text) {
            return { ok: false, reason: REASON.PATCH_NOT_APPLICABLE, detail: `removal-mismatch:${f.path}@${h.oldStart + si}` };
          }
          si++;
        } else {
          replacement.push(l.text);
        }
      }
      if (si !== slice.length) {
        return { ok: false, reason: REASON.PATCH_MALFORMED, detail: `hunk-consumption:${f.path}` };
      }
      result.splice(at, h.oldCount, ...replacement);
    }
    out.set(f.path, result.join("\n") + "\n");
  }
  return { ok: true, files: out };
}

/** Render a minimal unified diff for one modify or add (used by generators). */
export function renderDiff(path, operation, baseContent, newContent) {
  const baseLines = baseContent === null ? [] : baseContent.split("\n").filter((_, i, a) => !(i === a.length - 1 && _ === ""));
  const newLines = newContent.split("\n").filter((_, i, a) => !(i === a.length - 1 && _ === ""));
  const oldHead = operation === "add" ? "/dev/null" : `a/${path}`;
  const newHead = `b/${path}`;
  let out = `--- ${oldHead}\n+++ ${newHead}\n`;
  if (operation === "add") {
    out += `@@ -0,0 +1,${newLines.length} @@\n`;
    for (const l of newLines) out += `+${l}\n`;
    return out;
  }
  // Single-hunk diff with up to 3 lines of context around the change span.
  let first = -1;
  let last = -1;
  const n = Math.max(baseLines.length, newLines.length);
  for (let i = 0; i < n; i++) {
    if (baseLines[i] !== newLines[i]) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return null; // identical
  const ctx = 3;
  const s = Math.max(0, first - ctx);
  const e = Math.min(n - 1, last + ctx);
  // Exact pairing over the span: common prefix/suffix stay context, the
  // middle becomes removals followed by additions (no fuzz, no heuristics).
  const paired = pairSpan(baseLines.slice(s, e + 1), newLines.slice(s, e + 1));
  let oldCount = 0;
  let newCount = 0;
  const hunkBody = [];
  for (const [kind, text] of paired) {
    hunkBody.push(`${kind}${text}`);
    if (kind !== "+") oldCount++;
    if (kind !== "-") newCount++;
  }
  out += `@@ -${s + 1},${oldCount} +${s + 1},${newCount} @@\n`;
  out += hunkBody.join("\n") + "\n";
  return out;
}

/** Minimal exact pairing of two line spans (common prefix/suffix trim). */
function pairSpan(oldLines, newLines) {
  let pre = 0;
  while (pre < oldLines.length && pre < newLines.length && oldLines[pre] === newLines[pre]) pre++;
  let suf = 0;
  while (
    suf < oldLines.length - pre &&
    suf < newLines.length - pre &&
    oldLines[oldLines.length - 1 - suf] === newLines[newLines.length - 1 - suf]
  ) {
    suf++;
  }
  const out = [];
  for (let i = 0; i < pre; i++) out.push([" ", oldLines[i]]);
  for (let i = pre; i < oldLines.length - suf; i++) out.push(["-", oldLines[i]]);
  for (let i = pre; i < newLines.length - suf; i++) out.push(["+", newLines[i]]);
  for (let i = 0; i < suf; i++) out.push([" ", oldLines[oldLines.length - suf + i]]);
  return out;
}
