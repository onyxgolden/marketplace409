import { AUTHORITY_LEVELS_BY_RANK } from "./authorityLevels.mjs";

function renderCountTable(counts) {
  const rows = Object.entries(counts).sort(([, a], [, b]) => b - a);
  if (rows.length === 0) return "None.\n";
  return ["| Key | Count |", "| --- | ----- |", ...rows.map(([key, count]) => `| ${key} | ${count} |`)].join("\n") + "\n";
}

// Human-readable and sanitized: paths, counts, and hashes only -- never file contents, never the
// matched-pattern *value* for an excluded secret/PII record (only its reason code), so this report is
// always safe to share even though it describes exactly what the indexer looked at.
export function renderIndexReport(manifest) {
  const lines = [];
  lines.push("# FORGE Engineering Brain -- Index Report");
  lines.push("");
  lines.push("> Sanitized: paths, counts, and content hashes only. No file contents or matched secret/PII values appear below.");
  lines.push("");
  lines.push(`**Commit:** \`${manifest.commit_sha}\``);
  lines.push(`**Generated at:** ${manifest.generated_at}`);
  lines.push(`**Index content hash:** \`${manifest.index_content_hash}\` (excludes \`generated_at\` -- identical repo content at this commit always produces this same hash)`);
  lines.push("");

  lines.push("## Authority order");
  lines.push("");
  lines.push("| Rank | Level | Meaning |");
  lines.push("| --- | --- | --- |");
  for (const level of AUTHORITY_LEVELS_BY_RANK) {
    lines.push(`| ${level.rank} | \`${level.id}\` | ${level.label} |`);
  }
  lines.push("");

  lines.push("## Indexed records");
  lines.push("");
  lines.push(`**Total:** ${manifest.counts.indexed_total}`);
  lines.push("");
  lines.push("By source type:");
  lines.push("");
  lines.push(renderCountTable(manifest.counts.indexed_by_source_type));
  lines.push("By authority level:");
  lines.push("");
  lines.push(renderCountTable(manifest.counts.indexed_by_authority_level));

  lines.push("## Excluded records");
  lines.push("");
  lines.push(`**Total:** ${manifest.counts.excluded_total}`);
  lines.push("");
  lines.push("By reason:");
  lines.push("");
  lines.push(renderCountTable(manifest.counts.excluded_by_reason));

  lines.push("## Out of scope");
  lines.push("");
  lines.push(`${manifest.counts.out_of_scope_total} tracked files fell outside every category this Phase 1 indexer covers (not excluded -- simply not yet in scope; see requirement 3's category list).`);
  lines.push("");

  lines.push("## Deleted since previous index");
  lines.push("");
  lines.push(manifest.counts.deleted_total === 0
    ? "None."
    : `${manifest.counts.deleted_total} previously-indexed path(s) no longer exist at this commit and were dropped, not carried forward: ${manifest.deleted_paths.join(", ")}`);
  lines.push("");

  return lines.join("\n");
}
