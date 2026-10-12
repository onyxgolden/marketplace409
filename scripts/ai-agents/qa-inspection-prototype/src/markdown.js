/**
 * markdown.js — optional Markdown renderer for the canonical report JSON.
 * Consumes the report JSON without inventing claims: every rendered sentence
 * traces to a field in the input. Advisory only.
 */

import { ledgerToMarkdown } from "./ledger.js";

export function reportToMarkdown(report) {
  const lines = [];
  lines.push(`# Inspection report \`${report.report_id ?? "n/a"}\` (SYNTHETIC, advisory)`);
  lines.push("");
  lines.push(`- task: \`${report.task_id}\``);
  lines.push(`- status: **${report.status}**`);
  lines.push(`- build: \`${report.build_pin?.build_id}\` @ \`${report.build_pin?.commit}\` (${report.build_pin?.environment})`);
  lines.push(`- controls: ${report.coverage?.controls_total ?? 0}, assertions: ${report.coverage?.assertions_total ?? 0}`);
  lines.push("");
  lines.push("## Results");
  lines.push("");
  for (const r of report.results ?? []) {
    lines.push(`### ${r.control_id} — ${r.result}`);
    lines.push("");
    lines.push(`- kind: ${r.kind}, operation: ${r.requested_operation}, action taken: ${r.action_taken}`);
    for (const ar of r.assertion_results ?? []) {
      lines.push(`- assertion \`${ar.assertion_id}\`: **${ar.result}** (evidence: ${ar.evidence_ids.join(", ") || "none"})`);
    }
    if (r.diagnostic_codes.length) lines.push(`- diagnostics: ${r.diagnostic_codes.join(", ")}`);
    lines.push("");
  }
  if ((report.contradictions ?? []).length) {
    lines.push("## Contradictions");
    lines.push("");
    for (const c of report.contradictions) {
      lines.push(`- ${c.control_id}/${c.assertion_id}: ${c.evidence_a} vs ${c.evidence_b} (modalities: ${c.modalities.join("+")})`);
    }
    lines.push("");
  }
  lines.push("## Ledger preview (inert, SYNTHETIC — does not update the real ledger)");
  lines.push("");
  lines.push(ledgerToMarkdown(report.ledger_preview ?? []));
  lines.push("");
  lines.push("## Coverage");
  lines.push("");
  lines.push(`- by modality: ${JSON.stringify(report.coverage?.by_modality ?? {})}`);
  lines.push(`- by result: ${JSON.stringify(report.coverage?.by_result ?? {})}`);
  if ((report.diagnostics ?? []).length) {
    lines.push("");
    lines.push("## Diagnostics");
    lines.push("");
    for (const d of report.diagnostics) {
      lines.push(`- [${d.severity}] ${d.code}${d.control_id ? ` @ ${d.control_id}` : ""}: ${d.reason}`);
    }
  }
  return lines.join("\n");
}
