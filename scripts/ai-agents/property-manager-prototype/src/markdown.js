/**
 * markdown.js — optional static Markdown renderer for the property-manager
 * prototype.
 *
 * Consumes the agent's JSON result and renders a static exception-dashboard
 * table. It invents no claims: every cell comes from the result object.
 * Deterministic: fixed column order, sorted rows.
 */

function escCell(v) {
  return String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function recRows(result) {
  const rows = (result.recommendations ?? []).map((r) => [
    r.recommendation_id,
    escCell(r.text).slice(0, 90),
    r.confidence,
    (r.touchpoints ?? []).join(","),
    r.permission_check?.validity,
    r.permission_check?.allowed_to_propose ? "yes" : "no",
    (r.escalation_ids ?? []).join(","),
  ]);
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return rows;
}

function escRows(result) {
  const rows = (result.escalation_triggers ?? []).map((t) => [
    t.escalation_id,
    t.touchpoint,
    t.urgency,
    escCell(t.required_authorizer).slice(0, 60),
    escCell(t.executor).slice(0, 60),
    t.authorization_satisfied ? "satisfied" : "PENDING",
    t.execution_authorized_for_agent ? "YES (INVALID)" : "no",
  ]);
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return rows;
}

function table(header, rows) {
  const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
  for (const r of rows) lines.push(`| ${r.join(" | ")} |`);
  return lines.join("\n");
}

/** Render a static Markdown exception dashboard from a result object. */
export function renderMarkdown(result) {
  const r = result ?? {};
  const lines = [
    "# Property Manager — exception dashboard (synthetic prototype)",
    "",
    `- status: ${r.status ?? "?"}`,
    `- task: ${r.task_id ?? "?"}`,
    `- advisory: ${r.advisory === true}, fixture_only: ${r.fixture_only === true}`,
    "",
    "## Recommendations",
    "",
    table(
      ["recommendation_id", "text", "confidence", "touchpoints", "permission", "allowed_to_propose", "escalation_ids"],
      recRows(r)
    ),
    "",
    "## Escalation triggers",
    "",
    table(
      ["escalation_id", "touchpoint", "urgency", "required_authorizer", "executor", "authorization", "agent_execution"],
      escRows(r)
    ),
    "",
    "## Diagnostics",
    "",
  ];
  const diags = (r.diagnostics ?? []).map((d) => `- [${d.severity}] ${d.code}: ${escCell(d.reason).slice(0, 140)}`);
  lines.push(...(diags.length ? diags : ["- none"]));
  lines.push("", "## Contradictions", "");
  const contras = (r.contradictions ?? []).map((c) => `- ${c.contradiction_id}: ${escCell(c.topic).slice(0, 120)}`);
  lines.push(...(contras.length ? contras : ["- none"]));
  lines.push(
    "",
    "_Advisory prototype output: recommendations and escalation records only. The agent cannot act; execution_authorized_for_agent is always false._"
  );
  return lines.join("\n") + "\n";
}
