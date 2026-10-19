/**
 * resolver.test.js — fixture resolution, blob verification, grants.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSourceRef, hasReadGrant, makeBudget, ResolutionError } from "../src/resolver.js";
import { loadStore, makeContext } from "./helpers.js";

const store = loadStore();

function refFor(name, overrides = {}) {
  const ref = store.bundleRefs[name];
  const key = `${ref.repo}|${ref.path}`;
  const rev = store.sources[key].revisions[ref.commit];
  return {
    repo: ref.repo, path: ref.path, commit: ref.commit,
    blob: rev.blob, algorithm: "git-sha1", revision: rev.label, ...overrides,
  };
}

describe("resolveSourceRef", () => {
  it("resolves a registered ref and verifies the blob", () => {
    const ctx = makeContext(store);
    const { bytes, text, expected_records } = resolveSourceRef(refFor("main"), ctx.sources, makeBudget(), "t");
    assert.ok(bytes.length > 0);
    assert.ok(text.includes("lead-high-01"));
    assert.equal(expected_records, 16);
  });
  it("rejects an unregistered source key", () => {
    const ctx = makeContext(store);
    const bad = { ...refFor("main"), path: "leads/nope.json" };
    assert.throws(() => resolveSourceRef(bad, ctx.sources, makeBudget(), "t"), ResolutionError);
  });
  it("rejects a blob mismatch", () => {
    const ctx = makeContext(store);
    const bad = refFor("main", { blob: "b".repeat(40) });
    assert.throws(() => resolveSourceRef(bad, ctx.sources, makeBudget(), "t"), (e) => e.code === "HASH_MISMATCH");
  });
  it("rejects a revision-label mismatch (tuple spoofing)", () => {
    const ctx = makeContext(store);
    const bad = refFor("main", { revision: "forged-label" });
    assert.throws(() => resolveSourceRef(bad, ctx.sources, makeBudget(), "t"), (e) => e.code === "SOURCE_UNVERIFIED");
  });
  it("rejects an unregistered commit", () => {
    const ctx = makeContext(store);
    const bad = refFor("main", { commit: "c".repeat(40) });
    assert.throws(() => resolveSourceRef(bad, ctx.sources, makeBudget(), "t"), ResolutionError);
  });
});

describe("hasReadGrant", () => {
  it("exact repo+path match grants", () => {
    assert.equal(hasReadGrant({ repo: "sales-fixtures", path: "leads/main.json" },
      [{ repo: "sales-fixtures", path: "leads/main.json" }]), true);
  });
  it("prefix does not grant", () => {
    assert.equal(hasReadGrant({ repo: "sales-fixtures", path: "leads/main.json" },
      [{ repo: "sales-fixtures", path: "leads/" }]), false);
  });
  it("different repo does not grant", () => {
    assert.equal(hasReadGrant({ repo: "other", path: "leads/main.json" },
      [{ repo: "sales-fixtures", path: "leads/main.json" }]), false);
  });
});
