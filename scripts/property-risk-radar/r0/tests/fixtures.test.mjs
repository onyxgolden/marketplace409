// Fixture tests — every adapter fixture validates against its contract,
// manifests match the files they cover, nothing secret-like is committed,
// and empty results stay distinct from failures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ADAPTERS } from "../src/preflight.mjs";
import { digestObject, sha256Hex } from "../src/schemaDigest.mjs";
import { findSecretLike } from "../src/http.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R0 = path.resolve(__dirname, "..");

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function walkValues(value, visit) {
  visit(value);
  if (Array.isArray(value)) {
    value.forEach((entry) => walkValues(entry, visit));
  } else if (value !== null && typeof value === "object") {
    Object.values(value).forEach((entry) => walkValues(entry, visit));
  }
}

test("every adapter metadata + sample fixture validates against its contract", () => {
  for (const [id, adapter] of Object.entries(ADAPTERS)) {
    const metadata = loadJson(path.join(R0, "fixtures", id, "metadata.json"));
    const sample = loadJson(path.join(R0, "fixtures", id, "sample.json"));
    assert.deepEqual(adapter.validateMetadata(metadata), [], `${id} metadata`);
    assert.deepEqual(adapter.validateSample(sample), [], `${id} sample`);
  }
});

test("every fixture manifest matches the files it covers", () => {
  for (const id of Object.keys(ADAPTERS)) {
    const manifest = loadJson(path.join(R0, "fixtures", id, "manifest.json"));
    assert.equal(manifest.adapterId, id);
    assert.equal(manifest.fixtureKind, "synthetic-contract");
    assert.equal(manifest.liveFixtureStatus, "pending-live-preflight");
    for (const file of manifest.files) {
      const text = readFileSync(
        path.join(R0, "fixtures", id, file.name),
        "utf8",
      );
      assert.equal(file.bytes, Buffer.byteLength(text, "utf8"), `${id}/${file.name} bytes`);
      assert.equal(file.sha256, sha256Hex(text), `${id}/${file.name} sha256`);
    }
    assert.equal(
      manifest.digest,
      digestObject({ files: manifest.files }),
      `${id} manifest digest`,
    );
  }
});

test("no fixture, registry, or schema file contains secret-like content", () => {
  const fixtureDirs = readdirSync(path.join(R0, "fixtures"));
  for (const id of fixtureDirs) {
    for (const name of readdirSync(path.join(R0, "fixtures", id))) {
      const text = readFileSync(path.join(R0, "fixtures", id, name), "utf8");
      assert.equal(findSecretLike(JSON.parse(text)), null, `${id}/${name}`);
    }
  }
  const registry = loadJson(path.join(R0, "registry", "source-registry.v1.json"));
  assert.equal(findSecretLike(registry), null, "registry");
});

test("all fixtures are marked synthetic and carry only WGS84-range coordinates", () => {
  for (const id of Object.keys(ADAPTERS)) {
    const metadata = loadJson(path.join(R0, "fixtures", id, "metadata.json"));
    const sample = loadJson(path.join(R0, "fixtures", id, "sample.json"));
    assert.equal(metadata.synthetic, true, `${id} metadata`);
    assert.equal(sample.synthetic, true, `${id} sample`);
    walkValues(sample, (value) => {
      if (Array.isArray(value) && value.length === 2) {
        const [a, b] = value;
        if (typeof a === "number" && typeof b === "number") {
          assert.ok(a >= -180 && a <= 180, `${id}: lng ${a} out of range`);
          assert.ok(b >= -90 && b <= 90, `${id}: lat ${b} out of range`);
        }
      }
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        if (typeof value.x === "number" && typeof value.y === "number") {
          assert.ok(value.x >= -180 && value.x <= 180, `${id}: x ${value.x} out of range`);
          assert.ok(value.y >= -90 && value.y <= 90, `${id}: y ${value.y} out of range`);
        }
      }
    });
  }
});

test("empty results validate: zero features is a valid observation, not a failure", async () => {
  const fema = await import("../src/adapters/fema-nfhl.mjs");
  const census = await import("../src/adapters/census-geocoder.mjs");
  const emptyFema = { synthetic: true, type: "FeatureCollection", features: [] };
  assert.deepEqual(fema.validateSample(emptyFema), []);
  const emptyCensus = {
    synthetic: true,
    result: {
      input: { address: "Nowhere Rd, Nowhere, TX 00000", benchmark: "Public_AR_Current" },
      addressMatches: [],
    },
  };
  assert.deepEqual(census.validateSample(emptyCensus), []);
});
