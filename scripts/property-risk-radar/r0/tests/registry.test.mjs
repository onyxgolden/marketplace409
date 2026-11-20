// Registry tests — the R0 seed registry must validate, and the validator
// must fail closed on every tampered variant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadRegistry,
  validateRegistryObject,
  computeSchemaDigest,
} from "../src/validateRegistry.mjs";
import { digestObject } from "../src/schemaDigest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R0 = path.resolve(__dirname, "..");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sourceById(registry, id) {
  return registry.sources.find((source) => source.id === id);
}

test("registry loads and validates clean", () => {
  const registry = loadRegistry();
  const { ok, errors } = validateRegistryObject(registry, R0);
  assert.deepEqual(errors, []);
  assert.equal(ok, true);
});

test("registry top level: version, review date, deny-by-default", () => {
  const registry = loadRegistry();
  assert.equal(registry.registryVersion, "1.0.0");
  assert.equal(registry.reviewedAt, "2026-11-20");
  assert.equal(registry.defaultNetworkPolicy, "deny");
});

test("seed registry: 11 sources, 6 data adapters + 5 cameras, all disabled", () => {
  const registry = loadRegistry();
  assert.equal(registry.sources.length, 11);
  const data = registry.sources.filter((s) => s.category !== "camera");
  const cameras = registry.sources.filter((s) => s.category === "camera");
  assert.equal(data.length, 6);
  assert.equal(cameras.length, 5);
  for (const source of registry.sources) {
    assert.equal(source.status, "disabled", source.id);
    assert.equal(source.killSwitch, true, source.id);
    assert.equal(source.lastPreflight, null, source.id);
    assert.ok(
      source.terms.quota !== undefined && source.terms.quota !== null,
      `${source.id} needs a quota or literal UNKNOWN`,
    );
  }
});

test("every schema digest recomputes from contract + fixture manifest", () => {
  const registry = loadRegistry();
  for (const source of registry.sources) {
    let manifestDigest = null;
    if (source.fixtureManifest) {
      const manifest = JSON.parse(
        readFileSync(path.join(R0, source.fixtureManifest), "utf8"),
      );
      manifestDigest = digestObject({ files: manifest.files });
      assert.equal(manifest.digest, manifestDigest, `${source.id} manifest digest`);
    }
    assert.equal(
      computeSchemaDigest(source, manifestDigest),
      source.schemaDigest,
      `${source.id} schema digest`,
    );
  }
});

test("the JSON Schema document parses and pins deny-by-default", () => {
  const schema = JSON.parse(
    readFileSync(path.join(R0, "registry", "source-registry.schema.json"), "utf8"),
  );
  assert.equal(schema.properties.defaultNetworkPolicy.const, "deny");
  assert.ok(Array.isArray(schema.required));
  assert.ok(schema.required.includes("sources"));
});

test("validator rejects a source with no hosts", () => {
  const registry = loadRegistry();
  const tampered = clone(registry);
  sourceById(tampered, "nws-alerts").network.hosts = [];
  const { ok, errors } = validateRegistryObject(tampered, R0);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("nws-alerts") && e.includes("hosts")));
});

test("validator rejects a source with no quota state", () => {
  const registry = loadRegistry();
  const tampered = clone(registry);
  sourceById(tampered, "usgs-earthquakes").terms.quota = "";
  const { ok, errors } = validateRegistryObject(tampered, R0);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("usgs-earthquakes") && e.includes("quota")));
});

test("validator rejects an accepted source without a last-preflight record", () => {
  const registry = loadRegistry();
  const tampered = clone(registry);
  sourceById(tampered, "nws-alerts").status = "accepted";
  const { ok, errors } = validateRegistryObject(tampered, R0);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("last-preflight")));
});

test("validator rejects a disabled camera with an allowed display mode", () => {
  const registry = loadRegistry();
  const tampered = clone(registry);
  sourceById(tampered, "houston-transtar").rights.imageDisplay.mode = "allowed";
  const { ok, errors } = validateRegistryObject(tampered, R0);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("imageDisplay")));
});

test("validator rejects credentials in R0", () => {
  const registry = loadRegistry();
  const tampered = clone(registry);
  sourceById(tampered, "nws-alerts").network.credentialMode = "apiKey";
  const { ok, errors } = validateRegistryObject(tampered, R0);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("credentialMode")));
});

test("validator rejects a non-HTTPS endpoint template", () => {
  const registry = loadRegistry();
  const tampered = clone(registry);
  sourceById(tampered, "nws-alerts").endpoints.sampleUrlTemplate =
    "http://api.weather.gov/alerts/active";
  const { ok, errors } = validateRegistryObject(tampered, R0);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("sampleUrlTemplate")));
});

test("validator rejects an oversized body cap and a duplicate id", () => {
  const registry = loadRegistry();
  const tampered = clone(registry);
  sourceById(tampered, "nws-alerts").policy.caps.bytes = 99999999;
  const byBytes = validateRegistryObject(tampered, R0);
  assert.equal(byBytes.ok, false);
  assert.ok(byBytes.errors.some((e) => e.includes("caps.bytes")));

  const duplicated = clone(registry);
  duplicated.sources.push(clone(sourceById(duplicated, "nws-alerts")));
  const byId = validateRegistryObject(duplicated, R0);
  assert.equal(byId.ok, false);
  assert.ok(byId.errors.some((e) => e.includes("duplicate")));
});

test("validator rejects a non-deny default network policy", () => {
  const registry = loadRegistry();
  const tampered = clone(registry);
  tampered.defaultNetworkPolicy = "allow";
  const { ok, errors } = validateRegistryObject(tampered, R0);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("defaultNetworkPolicy")));
});
