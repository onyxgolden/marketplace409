/**
 * markdown.js — renders a result envelope as Markdown. The renderer consumes
 * the JSON result only and invents no claims: every figure, label and quote
 * comes from the result object. The watermark heads the document and every
 * rendered section.
 */

import { WATERMARK } from "./index.js";

function esc(s) {
  return String(s).replace(/\|/g, "\\|");
}

function renderSection(sec) {
  const out = [];
  out.push(`## Section ${esc(sec.section_id)}`);
  out.push("");
  out.push(`> ${WATERMARK}`);
  out.push("");
  out.push(`- complete: ${sec.complete}`);
  out.push(`- support_strength: ${esc(sec.support_strength)}`);
  out.push(`- flags: ${sec.flags.length > 0 ? sec.flags.map(esc).join(", ") : "(none)"}`);
  out.push(`- source_labels: ${sec.source_labels.length > 0 ? sec.source_labels.map(esc).join(", ") : "(none)"}`);
  out.push("");
  if (sec.amounts) {
    const a = sec.amounts;
    out.push(`### Amounts (${esc(a.currency)}, scale ${a.minor_unit_scale})`);
    out.push("");
    if (a.revenue) out.push(`- revenue budget/actual: ${esc(a.revenue.budget_minor)} / ${esc(a.revenue.actual_minor)}`);
    if (a.expense) out.push(`- expense budget/actual: ${esc(a.expense.budget_minor)} / ${esc(a.expense.actual_minor)}`);
    if (a.net_income) {
      out.push(`- net income budget/actual/variance: ${esc(a.net_income.budget_minor)} / ${esc(a.net_income.actual_minor)} / ${esc(a.net_income.variance_minor)}`);
    }
    out.push("");
    out.push("| line | category | budget | actual | variance | favorability | pct | support |");
    out.push("|---|---|---|---|---|---|---|---|");
    for (const l of a.lines) {
      out.push(
        `| ${esc(l.line_id)} | ${esc(l.category)} | ${esc(l.budget_minor)} | ${esc(l.actual_minor)} | ${esc(l.variance_minor)} | ${esc(l.favorability)} | ${esc(l.pct_variance)} | ${esc(l.support_strength)} |`
      );
    }
    out.push("");
  } else {
    out.push("_amounts unavailable: section not assembled_");
    out.push("");
  }
  if (sec.claimed_vs_recomputed && sec.claimed_vs_recomputed.length > 0) {
    out.push("### Claimed vs recomputed");
    out.push("");
    for (const c of sec.claimed_vs_recomputed) {
      out.push(`- ${esc(c.claim_id)}: ${esc(c.state)}`);
    }
    out.push("");
  }
  if (sec.narrative_results && sec.narrative_results.length > 0) {
    out.push("### Narrative checks");
    out.push("");
    for (const n of sec.narrative_results) {
      out.push(`- ${esc(n.claim_id)}: state=${esc(n.state)}, arithmetic_verified=${n.arithmetic_verified}, causal_support=${esc(n.causal_support)}`);
      for (const ev of n.evidence || []) {
        if (ev.attribution === "unsupported") {
          out.push(`  - unsupported attribution (quoted, not verified): "${esc(ev.quoted_text)}"`);
        }
      }
    }
    out.push("");
  }
  if (sec.diagnostics && sec.diagnostics.length > 0) {
    out.push("### Diagnostics");
    out.push("");
    for (const d of sec.diagnostics) {
      out.push(`- [${esc(d.severity)}] ${esc(d.code)}: ${esc(d.reason)}`);
    }
    out.push("");
  }
  return out.join("\n");
}

export function renderMarkdown(result) {
  const out = [];
  out.push(`# Financial Manager draft — ${esc(result.status || "UNKNOWN")}`);
  out.push("");
  out.push(`> ${WATERMARK}`);
  out.push("");
  out.push(`- advisory: ${result.advisory}, fixture_only: ${result.fixture_only}`);
  out.push(`- package_complete: ${result.package_complete}`);
  out.push("");
  for (const sec of result.sections || []) {
    out.push(renderSection(sec));
  }
  if (result.rollup) {
    out.push("## Rollup");
    out.push("");
    out.push(`- possible: ${result.rollup.possible}`);
    if (result.rollup.reason) out.push(`- reason: ${esc(result.rollup.reason)}`);
    if (result.rollup.totals) {
      const t = result.rollup.totals;
      const fmt3 = (m) => (m ? `${m.budget_minor} / ${m.actual_minor} / ${m.variance_minor}` : "n/a");
      out.push(`- revenue: ${esc(fmt3(t.revenue))}`);
      out.push(`- expense: ${esc(fmt3(t.expense))}`);
      out.push(`- net income: ${esc(fmt3(t.net_income))}`);
    }
    out.push("");
  }
  if (result.diagnostics && result.diagnostics.length > 0) {
    out.push("## Package diagnostics");
    out.push("");
    for (const d of result.diagnostics) {
      out.push(`- [${esc(d.severity)}] ${esc(d.code)}: ${esc(d.reason)}`);
    }
    out.push("");
  }
  if (result.exceptions && result.exceptions.length > 0) {
    out.push("## Exceptions");
    out.push("");
    for (const e of result.exceptions) {
      out.push(`- [${esc(e.severity)}] ${esc(e.code)}${e.section_id ? ` (${esc(e.section_id)})` : ""}: ${esc(e.reason)}`);
    }
    out.push("");
  }
  out.push(`_${WATERMARK}_`);
  out.push("");
  return out.join("\n");
}
