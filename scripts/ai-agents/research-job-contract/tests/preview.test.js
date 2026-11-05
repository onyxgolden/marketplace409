import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildPreview, validateFixtureItem, itemByteSize } from "../src/preview.js";
import { validDefinition, expectCode, loadFixture } from "./helpers.js";
import { definitionHash } from "../src/identity.js";

const NOW = "2026-11-04T15:00:00Z";
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

function preview(defOverrides, corpus, extra = {}) {
  return buildPreview({
    definition: validDefinition(defOverrides),
    invocation_id: "inv-1",
    actor: "op-1",
    corpus,
    now: NOW,
    ...extra,
  });
}

test("8-item replay builds with PENDING items and a DISABLED receipt", () => {
  const replay = loadFixture("synthetic-replay.json");
  const { receipt, items } = preview({}, replay);
  assert.equal(receipt.job_id, "research-weekly-brief@1");
  assert.equal(receipt.job_version, 1);
  assert.equal(receipt.mode, "SYNTHETIC_PREVIEW");
  assert.equal(receipt.job_status, "DISABLED");
  assert.equal(receipt.item_count, 8);
  assert.equal(receipt.empty_claim, null);
  assert.equal(receipt.definition_hash, definitionHash(validDefinition()));
  assert.equal(receipt.fixture_set_hash.length, 64);
  assert.match(receipt.run_id, /^run-[0-9a-f]{32}$/);
  assert.equal(receipt.budget.items_used, 8);
  assert.equal(receipt.budget.tool_calls_used, 0);
  assert.equal(items.length, 8);
  assert.equal(new Set(items.map((i) => i.item_key)).size, 8);
  for (const [i, item] of items.entries()) {
    assert.equal(item.index, i);
    assert.equal(item.decision_status, "PENDING");
    assert.equal(item.evidence_sha256, sha(item.evidence_excerpt));
    assert.ok(["fact", "inference", "proposal"].includes(item.kind));
  }
  assert.ok(items.some((i) => i.kind === "fact"));
  assert.ok(items.some((i) => i.kind === "inference"));
  assert.ok(items.some((i) => i.kind === "proposal"));
});

test("empty corpus yields an empty claim and zero items, never invented items", () => {
  const { receipt, items } = preview({}, loadFixture("empty-corpus.json"));
  assert.equal(items.length, 0);
  assert.equal(receipt.item_count, 0);
  assert.match(receipt.empty_claim, /No synthetic items in corpus 'empty-corpus'/);
});

test("budget exhaustion refuses before the excess item, with no partial result", () => {
  const small = loadFixture("small-corpus.json");
  expectCode(() => preview({
    budget: { max_items_per_run: 2, max_bytes_per_run: 262144, max_tool_calls_per_run: 64 },
  }, small), "BUDGET_EXCEEDED");
  expectCode(() => preview({
    budget: { max_items_per_run: 64, max_bytes_per_run: 10, max_tool_calls_per_run: 64 },
  }, small), "BUDGET_EXCEEDED");
});

test("corpus authorization and exclusion refuse before any item is read", () => {
  const small = loadFixture("small-corpus.json");
  expectCode(() => preview({ allowed_source_corpus_ids: ["empty-corpus"] }, small), "MISSING_SOURCE_AUTHORIZATION");
  expectCode(() => preview({ exclusions: ["small-corpus"] }, small), "EXCLUDED_CORPUS");
});

test("corpus and invocation shape refuses", () => {
  const small = loadFixture("small-corpus.json");
  expectCode(() => buildPreview({
    definition: validDefinition(), invocation_id: "inv 1", actor: "op-1", corpus: small, now: NOW,
  }), "BAD_INVOCATION");
  expectCode(() => buildPreview({
    definition: validDefinition(), invocation_id: "inv-1", actor: "", corpus: small, now: NOW,
  }), "BAD_INVOCATION");
  expectCode(() => buildPreview({
    definition: validDefinition(), invocation_id: "inv-1", actor: "op-1", corpus: small, now: "yesterday",
  }), "BAD_INVOCATION");
  expectCode(() => buildPreview({
    definition: validDefinition(), invocation_id: "inv-1", actor: "op-1",
    corpus: { corpus_id: "small-corpus", items: [{ claim: "x", evidence_excerpt: "y", kind: "guess" }] }, now: NOW,
  }), "BAD_CORPUS");
  expectCode(() => buildPreview({
    definition: validDefinition({ status: "LIVE" }), invocation_id: "inv-1", actor: "op-1", corpus: small, now: NOW,
  }), "NON_DISABLED_STATUS");
  expectCode(() => validateFixtureItem({ claim: "x" }, "item"), "BAD_CORPUS");
  const item = validateFixtureItem({ claim: "c", evidence_excerpt: "e", kind: "fact" }, "item");
  assert.equal(item.uncertainty, "");
  assert.ok(itemByteSize(item) > 0);
});
