import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPreview } from "../src/preview.js";
import { canonicalStringify } from "../src/canonical.js";
import { validDefinition, loadFixture } from "./helpers.js";

const NOW = "2026-11-04T15:00:00Z";

test("identical inputs produce byte-identical receipts and items", () => {
  const replay = loadFixture("synthetic-replay.json");
  const args = {
    definition: validDefinition(), invocation_id: "inv-1", actor: "op-1", corpus: replay, now: NOW,
  };
  const a = buildPreview(args);
  const b = buildPreview(args);
  assert.equal(canonicalStringify(a.receipt), canonicalStringify(b.receipt));
  assert.equal(canonicalStringify(a.items), canonicalStringify(b.items));
});

test("a different invocation id changes the run id but not the item content", () => {
  const replay = loadFixture("synthetic-replay.json");
  const a = buildPreview({ definition: validDefinition(), invocation_id: "inv-1", actor: "op-1", corpus: replay, now: NOW });
  const b = buildPreview({ definition: validDefinition(), invocation_id: "inv-2", actor: "op-1", corpus: replay, now: NOW });
  assert.notEqual(a.receipt.run_id, b.receipt.run_id);
  assert.deepEqual(
    a.items.map((i) => [i.claim, i.evidence_excerpt, i.kind]),
    b.items.map((i) => [i.claim, i.evidence_excerpt, i.kind]),
  );
});
