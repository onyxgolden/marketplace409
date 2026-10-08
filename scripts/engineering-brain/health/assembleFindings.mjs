/**
 * assembleFindings.mjs — Slice 5: evidence-linked findings with dedup.
 *
 * Turns raw Brain evidence (capability statuses, bug-catalog fixes) into
 * actionable findings. Each finding carries:
 *   - id: stable dedup key (never a random id)
 *   - what / subsystem / whyItMatters: plain-language, evidence-grounded
 *   - confidence: "high" | "medium" | "low" (never claims verified root cause)
 *   - lastSeen: ISO timestamp or null
 *   - evidenceLinks: [{label, ref}] — pointers, not embedded content
 *   - nextStep: recommended investigation or repair (NOT a root-cause claim)
 *
 * Rules:
 * - Deduplicate by stable identity: capability id for coverage findings,
 *   bug sha for fix findings. Repeated signals collapse; independent
 *   issues stay separate.
 * - Never derive a confirmed-miss from absence of evidence here; findings
 *   describe what IS evidenced.
 * - Confidence wording must not imply a verified root cause.
 */

function capabilityFinding(cap) {
  const status = cap.monitoring_status || "unable-to-verify";
  if (status === "covered") return null; // no finding for healthy coverage
  const whyMap = {
    "partially-covered":
      "Partial coverage means some expected evidence is not independently verified; a failure could go unnoticed.",
    uncovered:
      "No monitoring evidence exists for this capability; failures would be silent.",
    "unable-to-verify":
      "Monitoring status could not be determined; treat as unknown rather than healthy.",
  };
  return {
    id: `coverage:${cap.id}`,
    kind: "coverage-gap",
    what: `Runtime capability "${cap.name || cap.id}" is ${status}.`,
    subsystem: cap.execution_path || cap.id,
    whyItMatters: whyMap[status] || whyMap["unable-to-verify"],
    confidence: status === "uncovered" ? "high" : "medium",
    lastSeen: null,
    evidenceLinks: [
      { label: "runtime coverage registry", ref: "scripts/engineering-brain/runtimeCoverageRegistry.mjs" },
    ],
    nextStep:
      "Verify the capability's durable evidence manually (run logs, fix commits), " +
      "then decide whether to add independent monitoring.",
  };
}

function bugFinding(bug) {
  if (!bug || !bug.sha) return null;
  return {
    id: `fix:${bug.sha}`,
    kind: "known-defect-repaired",
    what: `Repaired defect: ${bug.subject || "(no subject)"}`,
    subsystem: Array.isArray(bug.files) && bug.files.length > 0 ? bug.files.slice(0, 4).join(", ") : "unknown",
    whyItMatters:
      "This defect class has occurred before in this area; similar changes deserve extra scrutiny.",
    confidence: "high",
    lastSeen: bug.date || null,
    evidenceLinks: [
      { label: `commit ${String(bug.sha).slice(0, 12)}`, ref: `git:${bug.sha}` },
      ...(bug.pr ? [{ label: `PR #${bug.pr}`, ref: `pr:${bug.pr}` }] : []),
    ],
    nextStep:
      "When touching the same files, re-run the related tests and check the original fix's scope.",
  };
}

/**
 * @param {object} input
 * @param {Array} input.capabilities — registry entries
 * @param {Array} input.bugFixes — bug catalog records {sha, date, subject, pr, class, files}
 * @param {boolean} [input.bugFixesLoadFailed=false] — true when the bug-fix
 *   count succeeded but row fetch failed; emits an evidence-unavailable
 *   finding so callers never conclude "zero defects" from a failed read
 * @returns {Array} deduplicated findings, deterministic order
 */
export function assembleFindings({ capabilities = [], bugFixes = [], bugFixesLoadFailed = false }) {
  const byId = new Map();

  for (const cap of capabilities) {
    const f = capabilityFinding(cap);
    if (f && !byId.has(f.id)) byId.set(f.id, f);
  }

  // Newest fixes first for stable, useful ordering.
  const sortedBugs = [...bugFixes].sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || "")),
  );
  for (const bug of sortedBugs) {
    const f = bugFinding(bug);
    if (f && !byId.has(f.id)) byId.set(f.id, f);
  }

  // Row fetch failed: the defect list is unknown. Emit an explicit
  // evidence-unavailable finding so no consumer can mistake the absence
  // of fix findings for "no repaired defects on record".
  if (bugFixesLoadFailed) {
    byId.set("evidence:bug-catalog-rows-unavailable", {
      id: "evidence:bug-catalog-rows-unavailable",
      kind: "evidence-unavailable",
      what: "Bug catalog row details could not be loaded.",
      subsystem: "supabase:engineering_brain_bug_fixes",
      whyItMatters:
        "The repaired-defect list is unknown. The absence of fix findings here does not mean no defects exist.",
      confidence: "high",
      lastSeen: null,
      evidenceLinks: [],
      nextStep:
        "Retry the bug catalog read; do not treat this run as having zero known defects.",
    });
  }

  return [...byId.values()];
}
