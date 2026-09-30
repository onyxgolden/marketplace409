import fs from "node:fs";
import path from "node:path";

const REQUIRED_TOP_LEVEL_FIELDS = Object.freeze(["schema_version", "commit_sha", "records", "index_content_hash"]);
const REQUIRED_RECORD_FIELDS = Object.freeze(["source_path", "source_type", "symbol_or_section", "commit_sha", "content_hash", "authority_level"]);

const SIDECAR_FILENAME = "content-tokens.json";

export class MalformedManifestError extends Error {
  constructor(reason) {
    super(`Malformed engineering-brain manifest: ${reason}`);
    this.name = "MalformedManifestError";
  }
}

// Fails closed on anything that isn't a well-formed Phase 1 manifest, rather than trying to run
// queries against partial/corrupt data and silently returning wrong or incomplete results.
export function validateManifestShape(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new MalformedManifestError("not a JSON object");
  }
  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (!(field in manifest)) throw new MalformedManifestError(`missing top-level field "${field}"`);
  }
  if (!Array.isArray(manifest.records)) {
    throw new MalformedManifestError('"records" is not an array');
  }
  manifest.records.forEach((record, index) => {
    for (const field of REQUIRED_RECORD_FIELDS) {
      if (!(field in record)) {
        throw new MalformedManifestError(`record at index ${index} is missing required field "${field}"`);
      }
    }
  });
  return manifest;
}

export function loadManifest(manifestPath) {
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, "utf8");
  } catch (error) {
    throw new MalformedManifestError(`could not read "${manifestPath}": ${error.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new MalformedManifestError(`"${manifestPath}" is not valid JSON: ${error.message}`);
  }

  const manifest = validateManifestShape(parsed);
  mergeContentTokenSidecar(manifest, manifestPath);
  return manifest;
}

// Attach content tokens from the sidecar (engineering-brain/content-tokens.json) when it exists
// and was mined from this manifest's own commit. The sidecar keeps the committed 3.1MB manifest
// untouched: fresh indexer runs and the nightly Supabase sync carry content_tokens on the records
// themselves and never need this file. A missing or commit-mismatched sidecar is ignored --
// those records simply behave as before (metadata-only pass 1).
function mergeContentTokenSidecar(manifest, manifestPath) {
  const sidecarPath = path.join(path.dirname(manifestPath), SIDECAR_FILENAME);
  let sidecar;
  try {
    sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
  } catch {
    return;
  }
  if (!sidecar || sidecar.commit_sha !== manifest.commit_sha) return;
  const tokensByPath = sidecar.tokens || {};
  for (const record of manifest.records) {
    if (!Array.isArray(record.content_tokens)) {
      const tokens = tokensByPath[record.source_path];
      if (Array.isArray(tokens)) record.content_tokens = tokens;
    }
  }
}
