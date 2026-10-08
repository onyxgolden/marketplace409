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
