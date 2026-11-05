import { test } from "node:test";
import assert from "node:assert/strict";
import { definitionHash, deriveRunId, itemKey, isPreviewStale } from "../src/identity.js";
import { canonicalStringify, sha256Hex, sha256Bytes } from "../src/canonical.js";
import { validDefinition, expectCode, loadFixture } from "./helpers.js";

test("canonical form is key-order independent", () => {
  assert.equal(canonicalStringify({ b: 1, a: { d: 4, c: 3 } }), canonicalStringify({ a: { c: 3, d: 4 }, b: 1 }));
  assert.equal(sha256Hex("x"), "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881");
  assert.equal(sha256Bytes(Buffer.from("x", "utf8")), sha256Hex("x"));
  assert.throws(() => canonicalStringify({ f: () => 1 }), /not JSON data/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalStringify(cyclic), /cyclic/);
});

test("definition hash is deterministic and version-sensitive", () => {
  const def = validDefinition();
  assert.equal(definitionHash(def), definitionHash(validDefinition()));
  assert.notEqual(definitionHash(def), definitionHash(validDefinition({ title: "Different title" })));
  assert.notEqual(
    definitionHash(validDefinition()),
    definitionHash(validDefinition({ job_id: "research-weekly-brief@2", version: 2 })),
  );
  assert.match(definitionHash(def), /^[0-9a-f]{64}$/);
});

test("run id derives from definition hash + invocation id", () => {
  const h = definitionHash(validDefinition());
  assert.equal(deriveRunId(h, "inv-1"), deriveRunId(h, "inv-1"));
  assert.notEqual(deriveRunId(h, "inv-1"), deriveRunId(h, "inv-2"));
  assert.match(deriveRunId(h, "inv-1"), /^run-[0-9a-f]{32}$/);
  expectCode(() => deriveRunId(h, ""), "BAD_INVOCATION");
  expectCode(() => deriveRunId(h, "has space"), "BAD_INVOCATION");
  expectCode(() => deriveRunId("not-a-hash", "inv-1"), "BAD_JOB");
});

test("item keys are distinct across the 8-item replay and run-scoped", () => {
  const replay = loadFixture("synthetic-replay.json");
  const keys = new Set();
  for (const item of replay.items) {
    const k = itemKey({
      job_id: "research-weekly-brief@1",
      run_id: "run-0123456789abcdef0123456789abcdef",
      claim: item.claim,
      evidence_sha256: sha256Bytes(Buffer.from(item.evidence_excerpt, "utf8")),
    });
    assert.match(k, /^item-[0-9a-f]{32}$/);
    assert(!keys.has(k), `duplicate item key for claim: ${item.claim}`);
    keys.add(k);
  }
  assert.equal(keys.size, 8);
  const one = itemKey({
    job_id: "research-weekly-brief@1",
    run_id: "run-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    claim: "c",
    evidence_sha256: "b".repeat(64),
  });
  const two = itemKey({
    job_id: "research-weekly-brief@1",
    run_id: "run-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    claim: "c",
    evidence_sha256: "b".repeat(64),
  });
  assert.notEqual(one, two);
  expectCode(() => itemKey({ job_id: "j", run_id: "r", claim: "c", evidence_sha256: "short" }), "BAD_JOB");
});

test("stale preview detection follows the definition hash", () => {
  const def = validDefinition();
  const receipt = { definition_hash: definitionHash(def) };
  assert.equal(isPreviewStale(receipt, def), false);
  assert.equal(isPreviewStale(receipt, validDefinition({ title: "Changed" })), true);
  assert.equal(isPreviewStale({}, def), true);
  assert.equal(isPreviewStale({ definition_hash: "x" }, def), true);
});
