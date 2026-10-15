/**
 * markdown.js — optional Markdown renderer for documentation drift results.
 * Consumes the same JSON the runner returns; it never invents claims —
 * every quoted line comes from a claim's before/after text or citation
 * span. The agent's own reviewer_preview blocks are reproduced verbatim.
 * Pure Node 24 ESM, zero dependencies.
 */

export function renderMarkdown(result) {
  const lines = [];
  lines.push(`# Documentation drift proposal — ${result.status}`);
  lines.push(``);
  lines.push(`Proposal: \`${result.proposal_id ?? "none"}\` — advisory fixture output only.`);
  lines.push(``);
  if (result.doc_ref) {
    lines.push(`Doc: \`${result.doc_ref.repo}/${result.doc_ref.path}@${result.doc_ref.commit.slice(0, 8)}\``);
    lines.push(``);
  }
  if ((result.claims ?? []).length > 0) {
    lines.push(`## Claims`);
    for (const c of result.claims) {
      lines.push(`- **${c.claim_id}** (${c.support_status})`);
      lines.push(`  - before: "${c.before}"`);
      lines.push(`  - after: "${c.after}"`);
      for (const cit of c.citations ?? []) {
        lines.push(`  - citation: ${cit.repo}/${cit.path}@${cit.commit.slice(0, 8)} "${cit.quoted_span}" [${cit.verification}]`);
      }
      for (const u of c.usage_citations ?? []) {
        lines.push(`  - usage: ${u.repo}/${u.path}@${u.commit.slice(0, 8)} "${u.quoted_span}" [${u.verification}]`);
      }
    }
    lines.push(``);
  }
  if ((result.excluded_claims ?? []).length > 0) {
    lines.push(`## Excluded claims`);
    for (const e of result.excluded_claims) lines.push(`- ${e.claim_id}: ${e.reason}`);
    lines.push(``);
  }
  if (result.proposed_diff && (result.proposed_diff.hunks ?? []).length > 0) {
    lines.push(`## Proposed diff (inert)`);
    for (const h of result.proposed_diff.hunks) {
      lines.push(`- lines ${h.start_line + 1}–${h.end_line}:`);
      for (const b of h.before) lines.push(`  - \`${b}\``);
      for (const a of h.after) lines.push(`  + \`${a}\``);
    }
    lines.push(``);
  }
  if ((result.reviewer_preview ?? []).length > 0) {
    lines.push(`## Reviewer preview (verbatim)`);
    for (const block of result.reviewer_preview) lines.push(block);
    lines.push(``);
  }
  if ((result.diagnostics ?? []).length > 0) {
    lines.push(`## Diagnostics`);
    for (const d of result.diagnostics) lines.push(`- [${d.severity}] ${d.code}: ${d.reason}`);
    lines.push(``);
  }
  lines.push(`_Advisory fixture output only — complete=${result.complete === true}; not an execution token._`);
  return lines.join("\n");
}
