/**
 * markdown.js — inert Markdown preview of a run() result. Manual-use
 * only, not part of the scored path. Every value rendered is either a
 * fixed label this agent controls or an escaped structural value —
 * never raw ticket subject/body/notes (drafts never contain them either).
 * Pure Node 24 ESM, zero dependencies, zero I/O.
 */

function esc(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}

export function renderMarkdown(result) {
  const lines = [];
  lines.push(`# Customer Success Agent — ${esc(result.status)}`);
  lines.push("");
  lines.push(`task_id: \`${esc(result.task_id)}\``);
  lines.push("");
  if (!result.report || result.report.ticket_results.length === 0) {
    lines.push("_No admitted ticket results._");
    return lines.join("\n") + "\n";
  }
  for (const t of result.report.ticket_results) {
    lines.push(`## Ticket ${esc(t.ticket_id)}`);
    lines.push(`- category: ${esc(t.classification.category)} (priority ${esc(t.classification.priority)})`);
    if (t.classification.secondary_categories.length > 0) lines.push(`- secondary: ${t.classification.secondary_categories.map(esc).join(", ")}`);
    if (t.suppression_reason) {
      lines.push(`- drafts suppressed: ${esc(t.suppression_reason)}`);
    } else {
      for (const d of t.drafts) lines.push(`- ${esc(d.variant)}: ${esc(d.text)}`);
    }
    lines.push("");
  }
  return lines.join("\n") + "\n";
}
