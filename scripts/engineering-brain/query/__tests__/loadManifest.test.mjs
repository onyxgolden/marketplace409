import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadManifest, validateManifestShape, MalformedManifestError } from "../loadManifest.mjs";

function writeTempFile(content) {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "eb-test-")), "manifest.json");
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe("loadManifest (malformed-manifest failure)", () => {
  it("loads a well-formed manifest successfully", () => {
    const valid = {
      schema_version: "1.0", commit_sha: "sha1", index_content_hash: "hash1",
      records: [{ source_path: "a.js", source_type: "application_source_file", symbol_or_section: null, commit_sha: "sha1", content_hash: "h1", authority_level: "current" }],
    };
    expect(() => loadManifest(writeTempFile(JSON.stringify(valid)))).not.toThrow();
  });

  it("fails closed on a missing file rather than silently returning an empty index", () => {
    expect(() => loadManifest("/nonexistent/path/manifest.json")).toThrow(MalformedManifestError);
  });

  it("fails closed on invalid JSON", () => {
    expect(() => loadManifest(writeTempFile("{ not valid json"))).toThrow(MalformedManifestError);
  });

  it("fails closed when a required top-level field is missing", () => {
    expect(() => validateManifestShape({ schema_version: "1.0", commit_sha: "sha1" })).toThrow(/missing top-level field/);
  });

  it("fails closed when records is not an array", () => {
    expect(() => validateManifestShape({ schema_version: "1.0", commit_sha: "sha1", index_content_hash: "h", records: "not-an-array" })).toThrow(/not an array/);
  });

  it("fails closed when a record is missing a required field", () => {
    const manifest = { schema_version: "1.0", commit_sha: "sha1", index_content_hash: "h", records: [{ source_path: "a.js" }] };
    expect(() => validateManifestShape(manifest)).toThrow(/missing required field/);
  });
});

describe("loadManifest (content-token sidecar merge)", () => {
  const record = {
    source_path: "a.js", source_type: "application_source_file", symbol_or_section: null,
    commit_sha: "sha1", content_hash: "h1", authority_level: "current",
  };
  const manifest = {
    schema_version: "1.0", commit_sha: "sha1", index_content_hash: "hash1", records: [record],
  };

  function writeManifestWithSidecar(sidecar) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eb-test-"));
    const manifestPath = path.join(dir, "index-manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    if (sidecar !== null) {
      fs.writeFileSync(path.join(dir, "content-tokens.json"), JSON.stringify(sidecar));
    }
    return manifestPath;
  }

  it("merges sidecar tokens into records when the commit matches", () => {
    const loaded = loadManifest(writeManifestWithSidecar({
      schema_version: "1.0", commit_sha: "sha1", tokens: { "a.js": ["mortgage", "home"] },
    }));
    expect(loaded.records[0].content_tokens).toEqual(["mortgage", "home"]);
  });

  it("ignores a sidecar mined from a different commit", () => {
    const loaded = loadManifest(writeManifestWithSidecar({
      schema_version: "1.0", commit_sha: "other", tokens: { "a.js": ["mortgage"] },
    }));
    expect(loaded.records[0].content_tokens).toBeUndefined();
  });

  it("loads fine with no sidecar present", () => {
    const loaded = loadManifest(writeManifestWithSidecar(null));
    expect(loaded.records[0].content_tokens).toBeUndefined();
  });

  it("never overwrites tokens the record already carries", () => {
    const withTokens = {
      ...manifest,
      records: [{ ...record, content_tokens: ["existing"] }],
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eb-test-"));
    const manifestPath = path.join(dir, "index-manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(withTokens));
    fs.writeFileSync(path.join(dir, "content-tokens.json"), JSON.stringify({
      schema_version: "1.0", commit_sha: "sha1", tokens: { "a.js": ["sidecar"] },
    }));
    const loaded = loadManifest(manifestPath);
    expect(loaded.records[0].content_tokens).toEqual(["existing"]);
  });
});
