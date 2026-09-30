// Text/JSON rendering for assembleDiagnosticContext.mjs bundles. Same sanitation contract as
// renderQueryOutput.mjs: only prints fields already on the bundle, which only ever carries
// excerpts that passed the secret/PII/hash-verification gate.
export function renderDiagnosticOutputJson(bundle) {
  return JSON.stringify(bundle, null, 2);
}

const FACET_LABELS = {
  implicated_code: "Implicated code",
  behavior_pins: "Behavior-pinning tests",
  intended_behavior: "Intended behavior (docs)",
  decisions: "Recorded decisions",
  other_evidence: "Other evidence",
};

function renderEntry(lines, entry, index) {
  const symbol = entry.symbol_or_section ? ` :: ${entry.symbol_or_section}` : "";
  lines.push(`${index + 1}. ${entry.source_path}${symbol}`);
  let meta = `   type=${entry.source_type} authority=${entry.authority_level} freshness=${entry.freshness} confidence=${entry.confidence}`;
  if (entry.association) meta += ` [${entry.association} for ${entry.paired_to}]`;
  lines.push(meta);
  lines.push(`   commit=${entry.commit_sha} content_hash=${entry.content_hash}`);
  if (entry.excerpt) {
    lines.push("   ---");
    for (const excerptLine of entry.excerpt.split("\n")) lines.push(`   ${excerptLine}`);
    lines.push("   ---");
  } else {
    lines.push(`   (excerpt unavailable: ${entry.excerpt_unavailable_reason})`);
  }
  lines.push("");
}

export function renderDiagnosticOutputText(bundle) {
  const lines = [];
  lines.push(`Diagnostic query: ${bundle.query || "(filter only)"}`);
  if (Object.keys(bundle.filters || {}).length > 0) {
    lines.push(`Filters: ${JSON.stringify(bundle.filters)}`);
  }
  lines.push(`Manifest commit: ${bundle.manifest_commit_sha}`);
  if (bundle.evidence_signal_applied) {
    const step = bundle.evidence_failed_step ? ` (failed step: ${bundle.evidence_failed_step})` : "";
    lines.push(`Evidence re-rank from collected signal "${bundle.evidence_signal_id}"${step}`);
  }
  lines.push("");

  if (bundle.insufficient_evidence) {
    lines.push("INSUFFICIENT EVIDENCE");
    lines.push(bundle.reason);
    return lines.join("\n");
  }

  if (bundle.contradictions.length > 0) {
    lines.push(`!! ${bundle.contradictions.length} contradiction(s) -- code/docs/decisions disagree:`);
    for (const c of bundle.contradictions) {
      lines.push(`- "${c.subject}": ${c.winner.authority_level} (${c.winner.source_path}) outranks ${c.outranked.map((o) => `${o.authority_level} (${o.source_path})`).join(", ")}`);
    }
    lines.push("");
  }

  for (const [facetKey, label] of Object.entries(FACET_LABELS)) {
    const entries = bundle.facets[facetKey] || [];
    lines.push(`== ${label} (${entries.length}) ==`);
    lines.push("");
    entries.forEach((entry, i) => renderEntry(lines, entry, i));
  }

  if (bundle.past_fixes.length > 0) {
    lines.push(`== Related past fixes (${bundle.past_fixes.length}) ==`);
    lines.push("");
    for (const f of bundle.past_fixes) {
      const when = String(f.record.date || "").slice(0, 10);
      const pr = f.record.pr ? `, PR #${f.record.pr}` : "";
      lines.push(`- [${f.record.class}] ${f.record.subject} (${when}${pr})`);
      lines.push(`  matched: ${f.matched_terms.join(", ")} | files: ${(f.record.files || []).join(", ") || "—"}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
