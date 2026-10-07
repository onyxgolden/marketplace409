// Canonical knowledge coverage report (Slice 3).
//
// Generated from two inputs only: the approved registry (canonicalDocumentRegistry.mjs) and one index
// manifest (buildManifest output). It is a view, never an authority source: nothing here changes what
// the Brain indexes or how it ranks. The output is deterministic for the same commit, registry, and
// index: no timestamps, all rows sorted by path, and every value comes from those inputs.

import { CLASSIFICATIONS, MISSING_REFERENCES, sortRegistry } from "./canonicalDocumentRegistry.mjs";

// Markdown table cells must not break the table or hide content.
function cell(value) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function table(headers, rows) {
  if (rows.length === 0) return "None.\n";
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n") + "\n";
}

function countTable(title, counts) {
  const rows = Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${title}\n\n` + table(["Key", "Count"], rows.map(([key, count]) => [key, count]));
}

/**
 * Build the rows and the issue list from the registry and one manifest. Pure.
 *   manifest: { commit_sha, registry_hash, index_content_hash, records, excluded, coverage_issues }
 *   missingReferenceStatus: Map of path -> boolean (present in the repository at this commit)
 */
export function buildCoverageModel({ registry, manifest, missingReferenceStatus = new Map(), missingReferences = MISSING_REFERENCES }) {
  const records = manifest.records || [];
  const excluded = manifest.excluded || [];
  const coverageIssues = manifest.coverage_issues || [];

  const emittedByPath = new Map();
  for (const record of records) {
    if (!emittedByPath.has(record.source_path)) emittedByPath.set(record.source_path, new Set());
    emittedByPath.get(record.source_path).add(record.authority_level);
  }
  const excludedByPath = new Map(excluded.map((entry) => [entry.source_path, entry.reason]));

  const rows = sortRegistry(registry).map((entry) => {
    const emitted = [...(emittedByPath.get(entry.path) ?? [])].sort();
    const indexed = emitted.length > 0;
    let exclusionReason = null;
    if (entry.classification === CLASSIFICATIONS.EXCLUDED) {
      exclusionReason = `registry: ${entry.reason}`;
    } else if (!indexed) {
      exclusionReason = excludedByPath.get(entry.path) ?? "not indexed";
    }
    return {
      path: entry.path,
      classification: entry.classification,
      configuredAuthority: entry.brain_authority ?? "-",
      indexed,
      emittedAuthority: emitted.length ? emitted.join("+") : "-",
      families: entry.families.length ? entry.families.join("+") : "-",
      status: entry.status,
      exclusionReason,
      flags: entry.flags?.length ? entry.flags.join("+") : "-",
      rationale: entry.rationale,
      evidence: entry.evidence,
    };
  });

  const missing = [...missingReferences]
    .sort()
    .map((path) => ({ path, presentInRepository: Boolean(missingReferenceStatus.get(path)) }));

  const issueRows = [...coverageIssues]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((issue) => ({ path: issue.path, classification: issue.classification, issue: issue.issue }));

  return { commitSha: manifest.commit_sha, registryHash: manifest.registry_hash, indexContentHash: manifest.index_content_hash, rows, missing, issueRows };
}

/** The coverage report as Markdown. Same inputs always give the same bytes. */
export function renderCanonicalCoverageReport(model) {
  const { rows, missing, issueRows } = model;
  const lines = [];
  lines.push("# FORGE Engineering Brain -- Canonical Knowledge Coverage");
  lines.push("");
  lines.push("> Generated from the approved canonical document registry and one index manifest. This report is a view. It is not an authority source and it does not change indexing or ranking.");
  lines.push("");
  lines.push(`**Commit:** \`${model.commitSha}\``);
  lines.push(`**Registry fingerprint:** \`${model.registryHash ?? "none"}\``);
  lines.push(`**Index content hash:** \`${model.indexContentHash}\``);
  lines.push("");

  // Issues are conspicuous and come first. A rendered report is never a clean report by itself.
  if (issueRows.length > 0) {
    lines.push(`> **COVERAGE ISSUES: ${issueRows.length}.** Coverage is NOT clean. See "Coverage issues" below.`);
  } else {
    lines.push("> Coverage issues: 0. Every registered document is indexed or explicitly excluded with a reason.");
  }
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`Registered documents: **${rows.length}**. Coverage issues: **${issueRows.length}**. Declared-but-missing references: **${missing.length}**.`);
  lines.push("");
  lines.push(countTable("By classification:", countBy(rows, (r) => r.classification)));
  lines.push(countTable("By configured authority:", countBy(rows, (r) => r.configuredAuthority)));
  lines.push(countTable("By indexed state:", countBy(rows, (r) => (r.indexed ? "indexed" : "not indexed"))));
  lines.push(countTable("By emitted authority (indexed documents):", countBy(rows.filter((r) => r.indexed), (r) => r.emittedAuthority)));
  lines.push("");

  lines.push("## Registered documents");
  lines.push("");
  lines.push(table(
    ["Path", "Classification", "Configured authority", "Indexed", "Emitted authority", "Families", "Status", "Exclusion reason", "Flags"],
    rows.map((r) => [`\`${r.path}\``, r.classification, r.configuredAuthority, r.indexed ? "yes" : "no", r.emittedAuthority, r.families, r.status, r.exclusionReason, r.flags]),
  ));

  lines.push("## Why each document has its authority");
  lines.push("");
  lines.push("Rationale and evidence come from the registry entry. Nothing here is inferred.");
  lines.push("");
  for (const r of rows) {
    lines.push(`- \`${r.path}\` (${r.classification}, configured ${r.configuredAuthority}, emitted ${r.emittedAuthority})`);
    lines.push(`  - Rationale: ${r.rationale}`);
    lines.push(`  - Evidence: ${r.evidence}`);
  }
  lines.push("");

  lines.push("## Coverage issues");
  lines.push("");
  lines.push(issueRows.length === 0 ? "None." : table(
    ["Path", "Classification", "Issue"],
    issueRows.map((i) => [`\`${i.path}\``, i.classification ?? "-", i.issue]),
  ));

  lines.push("## Declared but missing references");
  lines.push("");
  lines.push("Named by the document ownership map but not registered, because a registry entry must point at a real file. A reference that is present in the repository is still NOT covered until it is registered.");
  lines.push("");
  lines.push(table(
    ["Path", "Present in repository at this commit"],
    missing.map((m) => [`\`${m.path}\``, m.presentInRepository ? "yes (not registered: needs a decision)" : "no"]),
  ));

  return lines.join("\n");
}
