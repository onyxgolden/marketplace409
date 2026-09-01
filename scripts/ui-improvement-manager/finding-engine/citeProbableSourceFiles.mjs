// Reuses the Engineering Brain's existing citation and authority-ranking system, unchanged, to
// resolve a finding's "probable source files" to real, ranked, cited repository evidence -- instead
// of a vague human-written guess. This is precisely what the owner asked this checkpoint to reuse
// rather than reinvent: `runQuery` already returns each result's real `source_path`, `authority_level`
// (the Engineering Brain's 6-tier citation-precedence ranking -- see
// scripts/engineering-brain/authorityLevels.mjs), and `commit_sha`, and already refuses to invent an
// answer when nothing indexed matches (`insufficient_evidence: true`) rather than guessing. Nothing in
// this module adds a second, competing answer system -- it only calls the one that already exists.
//
// Deliberately read-only and best-effort, not fail-closed: if no manifest exists locally (the owner
// hasn't run the Engineering Brain indexer, or it's stale), a finding still gets produced with its
// existing human-readable fallback text -- citation enrichment is a quality improvement to a finding
// that already exists on its own measured evidence, never a precondition for the finding itself.

import path from "node:path";
import { loadManifest, MalformedManifestError } from "../../engineering-brain/query/loadManifest.mjs";
import { runQuery } from "../../engineering-brain/query/runQuery.mjs";

const DEFAULT_MANIFEST_PATH = path.join(process.cwd(), "engineering-brain", "index-manifest.json");

// Cached per call site, not module-global -- a test can load a fixture manifest once and reuse it
// across many citeProbableSourceFiles calls without re-reading disk, while production code (which
// never calls this more than once per finding-engine run) pays the read cost exactly once too, via
// findingEngine.mjs's own single load at the top of a run.
export function loadEngineeringBrainManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  try {
    return loadManifest(manifestPath);
  } catch (error) {
    if (error instanceof MalformedManifestError) return null; // missing/stale/malformed -- enrichment is skipped, not fatal
    throw error;
  }
}

// `metadataOnly: true, resolveExcerpts: false` deliberately skips everything that would need real git
// access (this module has none, and shouldn't need any for a citation lookup) -- source_path,
// authority_level, and commit_sha are all metadata already present in the manifest itself.
export function citeProbableSourceFiles({ manifest, queryText, maxResults = 3 }) {
  if (!manifest || !queryText) return [];
  const response = runQuery({ manifest, queryText, metadataOnly: true, resolveExcerpts: false, maxResults });
  if (response.insufficient_evidence) return [];
  return response.results.map((result) => (
    `${result.source_path} (Engineering Brain citation -- authority: ${result.authority_level}, commit ${result.commit_sha.slice(0, 12)})`
  ));
}
