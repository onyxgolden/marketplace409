/**
 * publish.js — findings publisher per contract §1/§9.
 *
 * Writes internal-only artifacts: feature matrix (JSON + Markdown),
 * opportunities memo, run receipt. Enforces the no-copy rule: any string
 * resembling verbatim competitor prose in the output is rejected.
 * INTERNAL ONLY — never a public report, ad, or "FORGE beats X" page.
 */

const COPY_SIGNALS = [
  /©/,
  /all rights reserved/i,
];

/** Heuristic guard: flags text that looks like copied marketing copy. */
export function looksCopied(text) {
  if (typeof text !== "string") return false;
  if (COPY_SIGNALS.some((re) => re.test(text))) return true;
  // Long verbatim-sounding marketing sentences are suspect.
  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  return sentences.some((s) => s.split(/\s+/).length > 40);
}

export function renderMatrixMarkdown({ lane, as_of_date, comparisons, products }) {
  const lines = [
    `# Competitive feature matrix — ${lane} (INTERNAL ONLY)`,
    ``,
    `> Internal research artifact. Not a public report, advertisement, or ranking.`,
    `> Generated ${as_of_date}. Do not publish.`,
    ``,
    `| Feature | ${products.join(" | ")} |`,
    `| --- | ${products.map(() => "---").join(" | ")} |`,
  ];
  const byFeature = new Map();
  for (const c of comparisons) {
    if (!byFeature.has(c.feature_id)) byFeature.set(c.feature_id, {});
    byFeature.get(c.feature_id)[c.vendor_id] = c.verdict;
  }
  for (const [fid, row] of [...byFeature.entries()].sort()) {
    lines.push(`| ${fid} | ${products.map((p) => row[p] || "undetermined").join(" | ")} |`);
  }
  lines.push(``, `_No whole-product winner is declared. Undetermined means missing evidence, not a score._`);
  return lines.join("\n");
}

export function renderOpportunitiesMarkdown({ gaps, comparisons }) {
  const confirmed = comparisons.filter((c) => c.verdict === "behind");
  const lines = [
    `# Gap / opportunity memo (INTERNAL ONLY)`,
    ``,
    `## Confirmed implementation gaps`,
  ];
  if (confirmed.length === 0) lines.push(`_None confirmed. Absence of evidence is not a gap._`);
  for (const c of confirmed) lines.push(`- **${c.feature_id}** vs ${c.vendor_id}: ${c.basis}`);
  lines.push(``, `## Evidence gaps`, ``);
  for (const g of gaps.slice(0, 50)) lines.push(`- ${g.feature_id} / ${g.vendor_id}: ${g.gap_type} — ${g.next_step}`);
  lines.push(``, `## Product-opportunity hypotheses`, ``, `_Populated by analyst review; each needs cited cells before it becomes a proposal._`);
  return lines.join("\n");
}

export function makeRunReceipt({ task_id, lane, forge_base_pin, source_results, limitations }) {
  return {
    task_id,
    lane,
    forge_base_pin,
    source_results: source_results || [],
    limitations: limitations || [],
    emitted_at: new Date().toISOString(),
    internal_only: true,
  };
}

/** Final gate before any artifact leaves the core: reject copied content. */
export function gateArtifacts(artifacts) {
  const violations = [];
  const walk = (v, path) => {
    if (typeof v === "string") {
      if (looksCopied(v)) violations.push(path);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
    }
  };
  walk(artifacts, "");
  return violations;
}
