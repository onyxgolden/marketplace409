/**
 * markdown.js — optional Markdown renderer for knowledge-vault results.
 * Consumes the same JSON the runner returns; it never invents claims —
 * every quoted line comes from a claim's exact text or citation span.
 * Pure Node 24 ESM, zero dependencies.
 */

export function renderMarkdown(result) {
  const lines = [];
  lines.push(`# Knowledge Vault answer — ${result.status}`);
  lines.push("");
  lines.push(`Confidence: ${result.confidence}`);
  lines.push("");
  if (result.answer_text) lines.push(result.answer_text, "");
  if (result.claims.length > 0) {
    lines.push("## Claims");
    for (const c of result.claims) {
      lines.push(`- **${c.claim_id}** (${c.validity}): "${c.text}"`);
      for (const cit of c.citations) {
        lines.push(`  - ${cit.repo}/${cit.path}@${cit.commit.slice(0, 8)} [${cit.verification}]`);
      }
    }
    lines.push("");
  }
  if (result.contradiction_count > 0) {
    lines.push(`## Contradictions (${result.contradiction_count})`);
    for (const k of result.contradictions) {
      lines.push(`- '${k.claim_key}': ${k.source_a} vs ${k.source_b}`);
    }
    lines.push("");
  }
  if (result.diagnostics.length > 0) {
    lines.push("## Diagnostics");
    for (const d of result.diagnostics) {
      lines.push(`- [${d.severity}] ${d.code}: ${d.reason}`);
    }
    lines.push("");
  }
  if (result.supersession_notes.length > 0) {
    lines.push("## Supersession");
    for (const n of result.supersession_notes) {
      lines.push(`- ${n.record_id}: ${n.old_commit.slice(0, 8)} → ${n.new_commit.slice(0, 8)} (effective ${n.effective_at})`);
    }
    lines.push("");
  }
  lines.push("_Advisory fixture output only — not an execution token._");
  return lines.join("\n");
}
