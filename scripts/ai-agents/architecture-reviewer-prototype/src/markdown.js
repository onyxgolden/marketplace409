/**
 * markdown.js — optional Markdown renderer for the architecture-reviewer
 * prototype. Consumes the advisory JSON produced by run() and renders it
 * without inventing claims: every line is derived from the result object.
 * Every verdict is labeled ADVISORY: advisory output is never an
 * authorization.
 */

export function reviewToMarkdown(result) {
  const lines = [];
  const vp = result.verdict_proposal;
  lines.push(`# Architecture review (ADVISORY): ${result.review_id ?? result.task_id}`);
  lines.push("");
  lines.push(`> ADVISORY ONLY — this proposal authorizes nothing. authorization_granted: ${result.authorization_granted}`);
  lines.push("");
  lines.push(`- status: ${result.status}`);
  lines.push(`- verdict proposal (ADVISORY): ${vp ? vp.value : "(none)"}`);
  if (vp) lines.push(`- reason: ${vp.reason}`);
  lines.push(`- complete: ${result.complete}`);
  lines.push("");
  if (result.coverage) {
    lines.push("## Coverage");
    lines.push(`- required: ${(result.coverage.required ?? []).join(", ") || "(none)"}`);
    lines.push(`- verified: ${(result.coverage.verified ?? []).join(", ") || "(none)"}`);
    lines.push(`- missing: ${(result.coverage.missing ?? []).join(", ") || "(none)"}`);
    lines.push(`- unverifiable: ${(result.coverage.unverifiable ?? []).join(", ") || "(none)"}`);
    lines.push("");
  }
  lines.push("## Findings");
  for (const f of result.findings ?? []) {
    lines.push(`- [${f.severity}] ${f.check_id}: ${f.text}`);
    lines.push(`  - finding_id: ${f.finding_id}, validity: ${f.validity}`);
    if ((f.uncertainty_flags ?? []).length > 0) lines.push(`  - uncertainty: ${f.uncertainty_flags.join(", ")}`);
  }
  if ((result.findings ?? []).length === 0) lines.push("- (none)");
  lines.push("");
  lines.push("## Contradictions");
  for (const c of result.contradictions ?? []) {
    lines.push(`- ${c.check_id} / ${c.field}: '${c.value_a}' vs '${c.value_b}' (both preserved, not averaged)`);
  }
  if ((result.contradictions ?? []).length === 0) lines.push("- (none)");
  lines.push("");
  if (result.gate) {
    lines.push("## Gate evidence sufficiency (ADVISORY)");
    lines.push(`- sufficient: ${result.gate.sufficient}`);
    for (const g of result.gate.checks ?? []) lines.push(`- ${g.name}: ${g.sufficient ? "ok" : "FAIL"} — ${g.detail}`);
    lines.push("");
  }
  lines.push("## Diagnostics");
  for (const d of result.diagnostics ?? []) lines.push(`- [${d.severity}] ${d.code}: ${d.reason}`);
  if ((result.diagnostics ?? []).length === 0) lines.push("- (none)");
  lines.push("");
  return lines.join("\n");
}
