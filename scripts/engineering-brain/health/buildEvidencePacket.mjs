/**
 * buildEvidencePacket.mjs — Slice 6: deterministic read-only evidence packets.
 *
 * Assembles everything a human reviewer needs to triage one queue item.
 * Pure, deterministic, zero I/O.
 *
 * CRITICAL DISTINCTION — the packet has two top-level sections:
 *   current:    what the evidence says RIGHT NOW (finding, severity, state,
 *               freshness, monitoring status, money flag). This is what the
 *               reviewer is triaging.
 *   historical: context from the past (repaired defects, prior PRs, index
 *               revision). This is background ONLY. A historical repaired
 *               defect is NOT proof of a current defect. An exact-file
 *               overlap is advisory exposure, NOT a regression.
 *
 * Unavailable evidence is shown explicitly (state + reason), never silently
 * omitted. If the packet cannot be fully assembled, the gaps are labeled —
 * never filled with guesses.
 */

function findCapability(capabilities, capId) {
  if (!capId) return null;
  return (capabilities || []).find((c) => c && c.id === capId) || null;
}

function relatedExposures(exposures, item) {
  // Exposures whose matched files intersect the item's subsystem listing.
  const subsysFiles = new Set(
    String(item.subsystem || "").split(",").map((s) => s.trim()).filter(Boolean),
  );
  return (exposures || []).filter(
    (e) => e && Array.isArray(e.matchedFiles) && e.matchedFiles.some((f) => subsysFiles.has(String(f))),
  );
}

function relatedBugFixes(bugCatalog, item) {
  // Bug fixes whose files intersect the item's subsystem listing.
  const subsysFiles = new Set(
    String(item.subsystem || "").split(",").map((s) => s.trim()).filter(Boolean),
  );
  return (bugCatalog || [])
    .filter(
      (b) =>
        b && b.sha && Array.isArray(b.files) && b.files.some((f) => subsysFiles.has(String(f))),
    )
    .map((b) => ({
      sha: b.sha,
      shortSha: String(b.sha).slice(0, 12),
      subject: b.subject || "(no subject)",
      pr: b.pr || null,
      date: b.date || null,
    }));
}

/**
 * @param {object} input
 * @param {object} input.item — one queue item (prioritized finding)
 * @param {object} [input.health] — aggregateHealth() snapshot
 * @param {Array} [input.capabilities] — registry entries
 * @param {Array} [input.exposures] — matchRegressions() output
 * @param {Array} [input.bugCatalog] — bug records {sha, date, subject, pr, files}
 * @returns {object} evidence packet
 */
export function buildEvidencePacket({
  item,
  health = null,
  capabilities = [],
  exposures = [],
  bugCatalog = [],
}) {
  if (!item || !item.id) {
    return { id: null, error: "no item provided", current: null, historical: null };
  }

  const capId = item.id.startsWith("coverage:") ? item.id.slice("coverage:".length) : null;
  const cap = findCapability(capabilities, capId);
  const itemExposures = relatedExposures(exposures, item);
  const itemFixes = relatedBugFixes(bugCatalog, item);

  return {
    id: item.id,

    // ---- CURRENT: what the reviewer is triaging right now ----
    current: {
      what: item.what,
      severity: item.severity,
      severityReason: item.severityReason || null,
      triageState: item.triageState,
      confidence: item.confidence,
      lastSeen: item.lastSeen || null,
      moneyMoving: cap ? cap.moves_money === true : null,
      moneyNote: cap && cap.moves_money === true
        ? "Money-moving capability: higher review sensitivity. This does NOT assert a defect."
        : null,
      monitoringStatus: cap ? cap.monitoring_status || "unable-to-verify" : null,
      evidenceState: item.kind === "evidence-unavailable" ? "unavailable" : "present",
      evidenceLinks: item.evidenceLinks || [],
      nextStep: item.nextStep || null,
      subsystem: item.subsystem || null,
    },

    // ---- HISTORICAL: background context only, not proof of a current defect ----
    historical: {
      note: "Historical context only. None of the following proves a current defect.",
      indexRevision: health && health.index ? {
        commitSha: health.index.commitSha || null,
        generatedAt: health.index.generatedAt || null,
        state: health.index.state || null,
      } : null,
      repairedDefects: itemFixes,
      repairedDefectsNote: itemFixes.length > 0
        ? "These defects were repaired in the past. Their presence here is context for extra scrutiny, not evidence of a current defect."
        : null,
      regressionExposures: itemExposures.map((e) => ({
        priorFixSha: e.priorFix.sha,
        priorFixShortSha: e.priorFix.shortSha,
        priorFixSubject: e.priorFix.subject,
        priorFixPr: e.priorFix.pr,
        matchedFiles: e.matchedFiles,
        revision: e.revision || null,
      })),
      regressionNote: itemExposures.length > 0
        ? "Advisory only: file overlap with a prior repair. This does NOT mean the defect has returned."
        : null,
    },

    provenance: {
      packetBuiltFrom: "engineering-brain health snapshot (Slice 5) + triage prioritization (Slice 6)",
      findingId: item.id,
      findingKind: item.kind,
    },
  };
}
