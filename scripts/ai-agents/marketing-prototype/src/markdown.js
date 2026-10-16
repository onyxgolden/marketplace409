/**
 * markdown.js — optional Markdown renderer. Consumes the advisory JSON
 * report and renders plain text / escaped Markdown only; it invents no
 * claims and performs no recomputation.
 */

function esc(s) {
  return String(s).replace(/[\\`*_{}[\]()#+\-.!]/g, (c) => `\\${c}`);
}

function rateLine(r) {
  if (!r || r.status !== "DEFINED") return r?.display ?? "?";
  return `${r.display} (${r.numerator}/${r.denominator})`;
}

export function renderMarkdown(result) {
  const lines = [];
  const r = result.report ?? {};
  lines.push(`# Marketing agent advisory report`);
  lines.push(``);
  lines.push(`- task: \`${esc(result.task_id)}\``);
  lines.push(`- status: \`${esc(result.status)}\` — complete: \`${result.complete}\``);
  lines.push(`- advisory: true — fixture only — authorization_granted: false`);
  lines.push(``);
  lines.push(`## Campaigns`);
  for (const c of r.campaigns ?? []) {
    lines.push(`- \`${esc(c.campaign_id)}\` — ${esc(c.classification)} (${esc(c.currency)}), drafts: ${c.drafts.length}`);
  }
  lines.push(``);
  lines.push(`## Metrics`);
  for (const m of r.metrics ?? []) {
    lines.push(
      `- \`${esc(m.campaign_id)}\` [${esc(m.status)}]: impressions=${m.impressions} clicks=${m.clicks} ` +
        `conversions=${m.conversions} spend=${m.spend_minor} revenue=${m.revenue_minor} ` +
        `CTR=${esc(rateLine(m.ctr))} conv_rate=${esc(rateLine(m.conversion_rate))} ROAS=${esc(rateLine(m.roas))}`
    );
    if (m.integrity_flags.length > 0) lines.push(`  - integrity: ${m.integrity_flags.map(esc).join(", ")}`);
  }
  if ((r.pooled ?? []).length > 0) {
    lines.push(``);
    lines.push(`## Pooled populations`);
    for (const p of r.pooled) {
      lines.push(`- \`${esc(p.pool_id)}\` [${esc(p.status)}] members=${p.members.map(esc).join(",")} CTR=${esc(rateLine(p.ctr))} ROAS=${esc(rateLine(p.roas))}`);
    }
  }
  if ((r.header_comparisons ?? []).length > 0) {
    lines.push(``);
    lines.push(`## Header comparisons`);
    for (const h of r.header_comparisons) {
      lines.push(`- \`${esc(h.claim_id)}\` ${esc(h.metric)}: ${esc(h.status)} (claimed ${esc(h.claimed)}, computed ${esc(h.computed)})`);
    }
  }
  if ((r.exclusions ?? []).length > 0) {
    lines.push(``);
    lines.push(`## Exclusions`);
    for (const e of r.exclusions) {
      lines.push(`- ${esc(e.reason)}: ${e.count}${e.campaign_id ? ` (campaign \`${esc(e.campaign_id)}\`)` : ""}`);
    }
  }
  if ((r.duplicate_groups ?? []).length > 0) {
    lines.push(``);
    lines.push(`## Duplicate conversion groups`);
    for (const g of r.duplicate_groups) {
      lines.push(`- \`${esc(g.conversion_id)}\`: ${esc(g.resolution)} (counted ${g.counted})`);
    }
  }
  lines.push(``);
  lines.push(`## Drafts`);
  for (const c of r.campaigns ?? []) {
    for (const d of c.drafts ?? []) {
      lines.push(`### \`${esc(c.campaign_id)}\` / ${esc(d.template_id)} (${d.codepoints} codepoints)`);
      lines.push(````);
      lines.push(d.text);
      lines.push(````);
    }
  }
  if ((result.diagnostics ?? []).length > 0) {
    lines.push(``);
    lines.push(`## Diagnostics`);
    for (const d of result.diagnostics) {
      lines.push(`- [${esc(d.severity)}] ${esc(d.code)}${d.record_id ? ` (${esc(d.record_id)})` : ""}: ${esc(d.reason)}`);
    }
  }
  if ((result.quarantined_sources ?? []).length > 0) {
    lines.push(``);
    lines.push(`## Quarantined sources`);
    for (const q of result.quarantined_sources) {
      lines.push(`- ${esc(q.family)}: ${esc(String(q.record_id))} — ${esc(q.reason)}`);
    }
  }
  return lines.join("\n");
}
