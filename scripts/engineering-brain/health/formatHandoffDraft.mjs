/**
 * formatHandoffDraft.mjs — Slice 5: review handoff drafts.
 *
 * Pure formatter. Assembles evidence, reproducible steps, affected
 * files/commits, and open questions into a markdown draft for human
 * review (Claude/ChatGPT). Read-only by construction: it returns a
 * string. It never posts, triggers agents, mutates issues/PRs, or
 * performs any I/O.
 *
 * Default consumer behavior: preview / copy / export. Any write
 * integration must be separately scoped and authorized.
 */

function section(title, body) {
  if (!body) return "";
  return `## ${title}\n\n${body}\n\n`;
}

function bulletList(items) {
  if (!items || items.length === 0) return "_none_";
  return items.map((i) => `- ${i}`).join("\n");
}

/**
 * @param {object} input
 * @param {string} [input.title]
 * @param {string} [input.context] — what the reviewer is being asked about
 * @param {Array}  [input.findings] — findings from assembleFindings()
 * @param {Array}  [input.exposures] — exposures from matchRegressions()
 * @param {string[]} [input.reproSteps]
 * @param {string[]} [input.affectedFiles]
 * @param {string[]} [input.affectedCommits]
 * @param {string[]} [input.openQuestions]
 * @param {string} [input.requestedBy]
 * @returns {string} markdown draft
 */
export function formatHandoffDraft({
  title = "Engineering Brain review handoff",
  context = "",
  findings = [],
  exposures = [],
  reproSteps = [],
  affectedFiles = [],
  affectedCommits = [],
  openQuestions = [],
  requestedBy = "",
} = {}) {
  const lines = [];
  lines.push(`# ${title}`);
  lines.push("");
  if (requestedBy) lines.push(`Requested by: ${requestedBy}`);
  lines.push(`Drafted: ${new Date().toISOString()}`);
  lines.push(`_Draft only — preview/copy/export. Nothing has been posted or assigned._`);
  lines.push("");

  if (context) lines.push(section("Context", context).trimEnd());

  if (findings.length > 0) {
    const body = findings
      .map(
        (f) =>
          `### ${f.what}\n` +
          `- Subsystem: ${f.subsystem}\n` +
          `- Why it matters: ${f.whyItMatters}\n` +
          `- Confidence: ${f.confidence}${f.lastSeen ? ` (last seen ${f.lastSeen})` : ""}\n` +
          `- Next step: ${f.nextStep}\n` +
          `- Evidence: ${f.evidenceLinks.map((l) => `${l.label} (${l.ref})`).join("; ")}`,
      )
      .join("\n\n");
    lines.push(section("Evidence-linked findings", body).trimEnd());
  }

  if (exposures.length > 0) {
    const body = exposures
      .map(
        (e) =>
          `### ${e.priorFix.subject}\n` +
          `- Prior fix: ${e.priorFix.shortSha}${e.priorFix.pr ? ` (PR #${e.priorFix.pr})` : ""}\n` +
          `- Matched files: ${e.matchedFiles.join(", ")}\n` +
          `- Note: ${e.reason}`,
      )
      .join("\n\n");
    lines.push(section("Potential regression exposure (advisory)", body).trimEnd());
  }

  lines.push(
    section(
      "Reproducible steps",
      reproSteps.length > 0 ? reproSteps.map((s, i) => `${i + 1}. ${s}`).join("\n") : "_not provided_",
    ).trimEnd(),
  );
  lines.push(section("Affected files", bulletList(affectedFiles)).trimEnd());
  lines.push(section("Affected commits", bulletList(affectedCommits)).trimEnd());
  lines.push(
    section(
      "Open questions for the reviewer",
      openQuestions.length > 0 ? openQuestions.map((q) => `- ${q}`).join("\n") : "_none_",
    ).trimEnd(),
  );

  return lines.join("\n") + "\n";
}

/**
 * formatTriageHandoffDraft — Slice 6: handoff draft for one triage evidence packet.
 *
 * Pure formatter. Preserves the current-vs-historical evidence distinction so
 * an independent reviewer can reproduce the triage reasoning. Returns a
 * string only — preview/copy/export. Never posts, assigns, triggers agents,
 * or mutates anything.
 *
 * @param {object} input
 * @param {object} input.packet — from buildEvidencePacket()
 * @param {string[]} [input.openQuestions]
 * @param {string} [input.requestedBy]
 * @returns {string} markdown draft
 */
export function formatTriageHandoffDraft({ packet, openQuestions = [], requestedBy = "" } = {}) {
  if (!packet || !packet.id) return "_No triage item selected._\n";

  const lines = [];
  lines.push(`# Triage review handoff — ${packet.id}`);
  lines.push("");
  if (requestedBy) lines.push(`Requested by: ${requestedBy}`);
  lines.push(`Drafted: ${new Date().toISOString()}`);
  lines.push(`_Draft only — preview/copy/export. Nothing has been posted or assigned._`);
  lines.push("");

  const c = packet.current || {};
  lines.push("## Current evidence (under triage now)");
  lines.push("");
  lines.push(`- What: ${c.what || "_unknown_"}`);
  lines.push(`- Severity: ${c.severity || "_unknown_"}${c.severityReason ? ` (${c.severityReason})` : ""}`);
  lines.push(`- Triage state: ${c.triageState || "_unknown_"}`);
  lines.push(`- Confidence: ${c.confidence || "_unknown_"}${c.lastSeen ? ` (last seen ${c.lastSeen})` : ""}`);
  if (c.moneyMoving !== null && c.moneyMoving !== undefined) {
    lines.push(`- Money-moving: ${c.moneyMoving ? "yes" : "no"}`);
    if (c.moneyNote) lines.push(`  - ${c.moneyNote}`);
  }
  if (c.monitoringStatus) lines.push(`- Monitoring status: ${c.monitoringStatus}`);
  lines.push(`- Evidence state: ${c.evidenceState || "_unknown_"}`);
  if (c.evidenceLinks && c.evidenceLinks.length > 0) {
    lines.push(`- Evidence: ${c.evidenceLinks.map((l) => `${l.label} (${l.ref})`).join("; ")}`);
  }
  if (c.nextStep) lines.push(`- Recommended next step: ${c.nextStep}`);
  lines.push("");

  const h = packet.historical || {};
  lines.push("## Historical context (background only — not proof of a current defect)");
  lines.push("");
  if (h.note) lines.push(`_${h.note}_`, "");
  if (h.indexRevision) {
    lines.push(
      `- Index revision: ${h.indexRevision.commitSha ? h.indexRevision.commitSha.slice(0, 12) : "_unknown_"}` +
      `${h.indexRevision.generatedAt ? ` (generated ${h.indexRevision.generatedAt})` : ""}` +
      `${h.indexRevision.state ? ` [${h.indexRevision.state}]` : ""}`,
    );
  }
  if (h.repairedDefects && h.repairedDefects.length > 0) {
    lines.push(`- Repaired defects touching related files:`);
    for (const d of h.repairedDefects) {
      lines.push(`  - ${d.shortSha}: ${d.subject}${d.pr ? ` (PR #${d.pr})` : ""}${d.date ? ` — ${d.date}` : ""}`);
    }
    if (h.repairedDefectsNote) lines.push(`  _${h.repairedDefectsNote}_`);
  }
  if (h.regressionExposures && h.regressionExposures.length > 0) {
    lines.push(`- Potential regression exposures (advisory):`);
    for (const e of h.regressionExposures) {
      lines.push(`  - ${e.priorFixShortSha}: ${e.priorFixSubject} — files: ${e.matchedFiles.join(", ")}`);
    }
    if (h.regressionNote) lines.push(`  _${h.regressionNote}_`);
  }
  lines.push("");

  lines.push("## Open questions for the reviewer");
  lines.push("");
  lines.push(openQuestions.length > 0 ? openQuestions.map((q) => `- ${q}`).join("\n") : "_none_");
  lines.push("");

  if (packet.provenance) {
    lines.push(`_Provenance: ${packet.provenance.packetBuiltFrom}; finding ${packet.provenance.findingId} (${packet.provenance.findingKind})._`);
    lines.push("");
  }

  return lines.join("\n");
}
