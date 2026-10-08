/**
 * matchRegressions.mjs — Slice 5: regression awareness (advisory only).
 *
 * Matches a list of changed file paths against the deterministic bug
 * catalog using exact file-path overlap. Surfaces "potential regression
 * exposure": the exact prior fix, why it matched, and the changed revision.
 *
 * Hard rules:
 * - File-path overlap ONLY. No keyword/LLM fuzzy matching, no untrusted
 *   caller-supplied signals treated as authoritative.
 * - Advisory, never merge-blocking. The output says "potential exposure",
 *   never "regression detected" — a file changing does not mean a bug
 *   came back.
 * - Deterministic ordering: most overlapping files first, newest fix first
 *   on ties.
 */

function normalizePath(p) {
  return String(p || "").replace(/^\.\//, "").replace(/\/+/g, "/");
}

/**
 * @param {object} input
 * @param {string[]} input.changedPaths — file paths changed in the revision under review
 * @param {Array} input.bugCatalog — bug records {sha, date, subject, pr, class, files[]}
 * @param {string|null} [input.revision] — label for the changed revision (sha/branch), for context only
 * @returns {Array} exposures: [{path, priorFix, matchedFiles, reason, revision}]
 */
export function matchRegressions({ changedPaths = [], bugCatalog = [], revision = null }) {
  const changed = new Set(
    (Array.isArray(changedPaths) ? changedPaths : []).map(normalizePath).filter(Boolean),
  );
  if (changed.size === 0) return [];

  const exposures = [];
  for (const bug of bugCatalog) {
    if (!bug || !bug.sha || !Array.isArray(bug.files)) continue;
    const matched = bug.files.map(normalizePath).filter((f) => changed.has(f));
    if (matched.length === 0) continue;
    exposures.push({
      path: matched[0],
      priorFix: {
        sha: bug.sha,
        shortSha: String(bug.sha).slice(0, 12),
        subject: bug.subject || "(no subject)",
        pr: bug.pr || null,
        date: bug.date || null,
        class: bug.class || null,
      },
      matchedFiles: [...matched].sort(),
      reason:
        `Potential regression exposure: ${matched.length} file(s) changed in this revision ` +
        `were touched by a prior repair (${String(bug.sha).slice(0, 12)}). ` +
        `This is advisory — it does not mean the defect has returned.`,
      revision,
    });
  }

  exposures.sort((a, b) => {
    if (b.matchedFiles.length !== a.matchedFiles.length)
      return b.matchedFiles.length - a.matchedFiles.length;
    return String(b.priorFix.date || "").localeCompare(String(a.priorFix.date || ""));
  });
  return exposures;
}
