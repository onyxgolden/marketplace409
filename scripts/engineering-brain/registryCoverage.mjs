// Coverage of the canonical document registry against one commit (Slice 2).
//
// A registered canonical or historical document must end up either indexed (it produced at least one
// record) or explicitly accounted for: missing from the repository, or excluded with a reason. Nothing
// registered may disappear silently. Excluded registry entries are not expected to produce records.

import { CLASSIFICATIONS, renderRegistry } from "./canonicalDocumentRegistry.mjs";
import { hashContent } from "./hashContent.mjs";

/** Fingerprint of the registry contents. Any classification or authority change changes it. */
export function registryFingerprint(entries) {
  return hashContent(renderRegistry(entries));
}

/**
 * Coverage issues for registered documents, sorted by path.
 *   trackedPaths:   every repository path at the commit (the full list, not just files re-read).
 *   indexedPaths:   paths that produced at least one record (fresh or reused).
 *   excludedReasons: Map of path -> reason, for paths excluded during this build.
 */
export function registryCoverageIssues({ registry, trackedPaths, indexedPaths, excludedReasons }) {
  const issues = [];
  for (const entry of registry) {
    if (entry.classification === CLASSIFICATIONS.EXCLUDED) continue;
    if (!trackedPaths.has(entry.path)) {
      issues.push({ path: entry.path, classification: entry.classification, issue: "registered_path_missing" });
      continue;
    }
    if (indexedPaths.has(entry.path)) continue;
    const reason = excludedReasons.get(entry.path);
    issues.push({
      path: entry.path,
      classification: entry.classification,
      issue: reason ? `not_indexed:${reason}` : "not_indexed:no_record",
    });
  }
  return issues.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
