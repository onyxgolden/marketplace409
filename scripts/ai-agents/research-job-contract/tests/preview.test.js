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

function validItem(claim) {
  return { claim, evidence_excerpt: "excerpt", kind: "fact" };
}

test("budget refusal (item cap) never reads the forbidden tail", () => {
  let tailReads = 0;
  const tail = {};
  Object.defineProperty(tail, "claim", {
    enumerable: true,
    get() { tailReads++; return "tail claim"; },
  });
  Object.defineProperty(tail, "evidence_excerpt", {
    enumerable: true,
    get() { tailReads++; return "tail excerpt"; },
  });
  Object.defineProperty(tail, "kind", {
    enumerable: true,
    get() { tailReads++; return "fact"; },
  });
  const corpus = {
    corpus_id: "small-corpus",
    items: [validItem("one"), validItem("two"), validItem("three"), tail],
  };
  // Item 2 (the third) is valid but exceeds max_items 2, so the preview
  // refuses there; the tail at index 3 must never be read.
  expectCode(() => preview({
    budget: { max_items_per_run: 2, max_bytes_per_run: 262144, max_tool_calls_per_run: 64 },
  }, corpus), "BUDGET_EXCEEDED");
  assert.equal(tailReads, 0);
  // Positive control: the same three valid items with room build fine,
  // so the refusal above is a budget refusal, not a shape refusal.
  const { receipt } = preview({}, {
    corpus_id: "small-corpus",
    items: [validItem("one"), validItem("two"), validItem("three")],
  });
  assert.equal(receipt.item_count, 3);
});

test("budget refusal (byte cap) never reads the forbidden tail, Proxy tail included", () => {
  let tailReads = 0;
  const tailTarget = validItem("tail");
  const tailProxy = new Proxy(tailTarget, {
    get(t, p, r) { tailReads++; return Reflect.get(t, p, r); },
  });
  const corpus = { corpus_id: "small-corpus", items: [validItem("one"), tailProxy] };
  // Item 0 alone is 3 + 7 + 4 = 14 bytes, over a 5-byte cap, so the
  // preview refuses at item 0; the Proxy tail must never be touched.
  expectCode(() => preview({
    budget: { max_items_per_run: 64, max_bytes_per_run: 5, max_tool_calls_per_run: 64 },
  }, corpus), "BUDGET_EXCEEDED");
  assert.equal(tailReads, 0);
  // Positive control: the plain-shaped corpus with room builds both.
  const { receipt } = preview({}, {
    corpus_id: "small-corpus",
    items: [validItem("one"), validItem("tail")],
  });
  assert.equal(receipt.item_count, 2);
});

test("untrusted fixture input refuses trap-free with BAD_CORPUS", () => {
  // Proxy item: the trap must never propagate as a raw error.
  const proxyItem = new Proxy(validItem("p"), {
    get() { throw new Error("trap must not escape"); },
  });
  expectCode(() => validateFixtureItem(proxyItem, "item"), "BAD_CORPUS");
  // Accessor item: the getter must never run.
  let getterReads = 0;
  const accessorItem = {};
  Object.defineProperty(accessorItem, "claim", {
    enumerable: true,
    get() { getterReads++; return "c"; },
  });
  accessorItem.evidence_excerpt = "e";
  accessorItem.kind = "fact";
  expectCode(() => validateFixtureItem(accessorItem, "item"), "BAD_CORPUS");
  assert.equal(getterReads, 0);
  // Custom-prototype item.
  const customProtoItem = Object.create({ marker: true });
  customProtoItem.claim = "c";
  customProtoItem.evidence_excerpt = "e";
  customProtoItem.kind = "fact";
  expectCode(() => validateFixtureItem(customProtoItem, "item"), "BAD_CORPUS");
  // Proxy corpus and Proxy items array refuse before any item is read.
  const small = loadFixture("small-corpus.json");
  const proxyCorpus = new Proxy(small, {
    get() { throw new Error("trap must not escape"); },
  });
  expectCode(() => preview({}, proxyCorpus), "BAD_CORPUS");
  expectCode(() => preview({}, {
    corpus_id: "small-corpus",
    items: new Proxy(small.items, {
      get() { throw new Error("trap must not escape"); },
    }),
  }), "BAD_CORPUS");
});

test("fixture-set hash covers admitted items only, invocation-independent", () => {
  const small = loadFixture("small-corpus.json");
  const a = preview({}, small, { invocation_id: "inv-1" });
  const b = preview({}, small, { invocation_id: "inv-2" });
  assert.equal(a.receipt.fixture_set_hash, b.receipt.fixture_set_hash);
  assert.notEqual(a.receipt.run_id, b.receipt.run_id);
  const changed = loadFixture("small-corpus.json");
  changed.items[0] = { ...changed.items[0], claim: "Small fixture claim one, changed." };
  const c = preview({}, changed);
  assert.notEqual(c.receipt.fixture_set_hash, a.receipt.fixture_set_hash);
});
