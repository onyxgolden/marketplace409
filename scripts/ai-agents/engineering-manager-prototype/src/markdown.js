/**
 * markdown.js — optional Markdown renderer for the engineering-manager
 * prototype. Consumes the advisory JSON produced by run() and renders it
 * without inventing claims: every line is derived from the result object.
 */

export function planToMarkdown(result) {
  const lines = [];
  lines.push(`# Plan: ${result.task_id}`);
  lines.push("");
  lines.push(`- status: ${result.status}`);
  lines.push(`- planning_state: ${result.planning_state}`);
  lines.push(`- advisory: ${result.advisory} (fixture only: ${result.fixture_only})`);
  if (result.approval_ref) {
    lines.push(`- approval: ${result.approval_ref.record_id} via ${result.approval_ref.authority_origin}`);
  }
  lines.push("");
  lines.push("## Nodes");
  for (const n of result.nodes ?? []) {
    lines.push(`- ${n.local_key} [${n.state}] owner proposal: ${n.owner_proposal || "(none)"} routing: ${n.routing_clearance}`);
    if (n.blocking_codes.length > 0) lines.push(`  - blocking: ${n.blocking_codes.join(", ")}`);
    if (n.dependencies.length > 0) lines.push(`  - depends on: ${n.dependencies.length} node(s)`);
    if (n.external_gates.length > 0) lines.push(`  - external gates: ${n.external_gates.join(", ")}`);
  }
  lines.push("");
  lines.push("## Edges");
  for (const e of result.edges ?? []) lines.push(`- ${e.from.slice(0, 12)} -> ${e.to.slice(0, 12)}`);
  if ((result.edges ?? []).length === 0) lines.push("- (none)");
  lines.push("");
  lines.push("## Gate status");
  for (const g of result.gate_status ?? []) lines.push(`- ${g.gate_id}: ${g.status}`);
  if ((result.gate_status ?? []).length === 0) lines.push("- (none)");
  lines.push("");
  lines.push("## Conflicts");
  for (const c of result.conflicts ?? []) lines.push(`- ${c.local_key}: ${c.reason}`);
  if ((result.conflicts ?? []).length === 0) lines.push("- (none)");
  lines.push("");
  lines.push("## Diagnostics");
  for (const d of result.diagnostics ?? []) lines.push(`- [${d.severity}] ${d.code}: ${d.reason}`);
  if ((result.diagnostics ?? []).length === 0) lines.push("- (none)");
  lines.push("");
  return lines.join("\n");
}
