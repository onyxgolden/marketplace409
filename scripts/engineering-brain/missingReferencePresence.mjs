// Real repository-at-commit presence for MISSING_REFERENCES (Slice 4 fix).
//
// Slice 3 made a MISSING_REFERENCES path that is present but unregistered a hard coverage issue
// (canonicalCoverageReport.mjs). That rule only does anything if `missingReferenceStatus` reflects
// the real repository -- an empty map makes every declared reference look absent regardless of the
// commit, silently reintroducing the exact fail-open condition Slice 3 closed. This module is the one
// place that computes it, so acceptance and doc-drift can never again pass a stub map by omission.

import { listTrackedFiles } from "./gitRepository.mjs";
import { MISSING_REFERENCES } from "./canonicalDocumentRegistry.mjs";

/** Pure: given the tracked paths at some commit, which MISSING_REFERENCES paths are present. */
export function missingReferenceStatusFromTrackedPaths(trackedPaths) {
  const set = trackedPaths instanceof Set ? trackedPaths : new Set(trackedPaths);
  return new Map(MISSING_REFERENCES.map((rel) => [rel, set.has(rel)]));
}

/** Reads real presence at `commitSha` through git (listTrackedFiles), not the working tree. */
export function missingReferenceStatusAtCommit(commitSha, repositoryRoot) {
  const trackedPaths = listTrackedFiles(commitSha, repositoryRoot).map((f) => f.path);
  return missingReferenceStatusFromTrackedPaths(trackedPaths);
}
