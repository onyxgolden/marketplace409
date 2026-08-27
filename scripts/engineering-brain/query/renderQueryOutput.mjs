export function renderQueryOutputJson(response) {
  return JSON.stringify(response, null, 2);
}

// Sanitized: only ever prints fields already present on the response object -- which itself only
// ever carries excerpts that passed resolveExcerpt.mjs's secret/PII/hash-verification gate. There is
// no code path here that reaches back into raw file content.
export function renderQueryOutputText(response) {
  const lines = [];
  lines.push(`Query: ${response.query || "(filter only)"}`);
  if (Object.keys(response.filters || {}).length > 0) {
    lines.push(`Filters: ${JSON.stringify(response.filters)}`);
  }
  lines.push(`Manifest commit: ${response.manifest_commit_sha}`);
  lines.push("");

  if (response.insufficient_evidence) {
    lines.push("INSUFFICIENT EVIDENCE");
    lines.push(response.reason);
    return lines.join("\n");
  }

  lines.push(`${response.results.length} result(s):`);
  lines.push("");

  response.results.forEach((result, index) => {
    lines.push(`${index + 1}. ${result.source_path}${result.symbol_or_section ? ` :: ${result.symbol_or_section}` : ""}`);
    lines.push(`   type=${result.source_type} authority=${result.authority_level} freshness=${result.freshness} confidence=${result.confidence}`);
    lines.push(`   commit=${result.commit_sha} content_hash=${result.content_hash}`);
    if (result.version) lines.push(`   version=${result.version}`);
    if (result.unresolved_conflict) {
      lines.push(`   ⚠ unresolved conflict on subject "${result.unresolved_conflict.subject}" (this record ${result.unresolved_conflict.outranked_by_or_outranks})`);
    }
    if (result.excerpt) {
      lines.push("   ---");
      for (const excerptLine of result.excerpt.split("\n")) lines.push(`   ${excerptLine}`);
      lines.push("   ---");
    } else {
      lines.push(`   (excerpt unavailable: ${result.excerpt_unavailable_reason})`);
    }
    lines.push("");
  });

  if (response.conflicts.length > 0) {
    lines.push(`${response.conflicts.length} conflict(s) across authority tiers:`);
    for (const conflict of response.conflicts) {
      lines.push(`- "${conflict.subject}": ${conflict.winner.authority_level} (${conflict.winner.source_path}) outranks ${conflict.outranked.map((o) => `${o.authority_level} (${o.source_path})`).join(", ")}`);
    }
  }

  return lines.join("\n");
}
