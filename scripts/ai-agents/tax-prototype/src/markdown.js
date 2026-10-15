/**
 * markdown.js — optional Markdown preview renderer for Tax Agent results.
 * Consumes the same JSON the runner returns; it never invents claims —
 * every quoted line comes from a claim's exact registered text. Inert
 * preview only: never published, never authorizes publication.
 * Pure Node 24 ESM, zero dependencies.
 */

export function renderMarkdown(result) {
  const lines = [];
  lines.push(`# Tax Agent draft preview — ${result.status}`);
  lines.push("");
  lines.push("**SYNTHETIC EDUCATIONAL EXAMPLE — NOT TAX GUIDANCE / DRAFT / NOT PUBLISHED**");
  lines.push("");
  if (result.explanation) lines.push(result.explanation, "");
  if (result.claims.length > 0) {
    lines.push("## Claims");
    for (const c of result.claims) {
      lines.push(`- **${c.claim_id}** (${c.concept_key}): "${c.text}"`);
    }
    lines.push("");
  }
  if (result.citations.length > 0) {
    lines.push("## Citations");
    for (const cit of result.citations) {
      lines.push(`- ${cit.repo}/${cit.path}@${cit.commit.slice(0, 8)} [${cit.verification}, ${cit.applicability}] synthetic:${cit.synthetic}`);
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
  if (result.referral) {
    lines.push(`## Referral\n- Required: ${result.referral.required} -> ${result.referral.target_role} (${result.referral.reason_code})`, "");
  }
  lines.push("_Advisory fixture output only — not an execution token. Not published._");
  return lines.join("\n");
}
