import fs from "node:fs";

const REQUIRED_TOP_LEVEL_FIELDS = Object.freeze(["schema_version", "commit_sha", "records", "index_content_hash"]);
const REQUIRED_RECORD_FIELDS = Object.freeze(["source_path", "source_type", "symbol_or_section", "commit_sha", "content_hash", "authority_level"]);

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

  return validateManifestShape(parsed);
}
