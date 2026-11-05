import test from "node:test";
import assert from "node:assert/strict";
import { buildPreview } from "../../research-job-contract/src/preview.js";
import { serializeResearchItem } from "../src/serializer.js";
import { decisionFromBody, validateResearchDecision } from "../src/decisionValidator.js";
import { loadFixture, validDefinition, expectCode, NOW } from "./helpers.js";

function storedItem() {
  const definition = validDefinition();
  const { receipt, items } = buildPreview({
    definition,
    invocation_id: "inv-1",
    actor: "op-1",
    corpus: loadFixture("small-corpus.json"),
    now: NOW,
  });
  return serializeResearchItem({ receipt, items, definition, publishedAt: receipt.created_at });
}

function bodyFor(item, overrides = {}) {
  return {
    itemId: item.item_id,
    reportDigest: item.report_digest,
    rowId: item.row_ids[0],
    decision: "accept",
    note: "looks right",
    decisionId: "d-1",
    ...overrides,
  };
}

test("valid accept decision builds from the body with the server actor", () => {
  const item = storedItem();
  const decision = decisionFromBody(item, bodyFor(item), NOW, "op-1");
  assert.equal(decision.item_id, item.item_id);
  assert.equal(decision.report_digest, item.report_digest);
  assert.equal(decision.row_id, item.row_ids[0]);
  assert.equal(decision.actor, "op-1");
  assert.equal(decision.decision, "accept");
  assert.equal(decision.note, "looks right");
  assert.equal(decision.at, NOW);
  assert.equal(decision.decision_id, "d-1");
  validateResearchDecision(item, decision);
});

test("valid reject decision builds", () => {
  const item = storedItem();
  const decision = decisionFromBody(item, bodyFor(item, { decision: "reject", decisionId: "d-2" }), NOW, "op-1");
  assert.equal(decision.decision, "reject");
  validateResearchDecision(item, decision);
});

test("a body actor field refuses — the actor is server-derived only", async () => {
  const item = storedItem();
  await expectCode(
    () => decisionFromBody(item, { ...bodyFor(item), actor: "mallory" }, NOW, "op-1"),
    "BAD_DECISION",
  );
});

test("binding failures refuse with named codes", async () => {
  const item = storedItem();
  await expectCode(() => decisionFromBody(item, bodyFor(item, { itemId: "run-00000000000000000000000000000000" }), NOW, "op-1"), "ITEM_MISMATCH");
  await expectCode(() => decisionFromBody(item, bodyFor(item, { reportDigest: "0".repeat(64) }), NOW, "op-1"), "STALE_DIGEST");
  await expectCode(() => decisionFromBody(item, bodyFor(item, { rowId: "item-nope" }), NOW, "op-1"), "UNKNOWN_ROW");
  await expectCode(() => decisionFromBody(item, bodyFor(item, { decision: "send-back" }), NOW, "op-1"), "BAD_DECISION");
  await expectCode(() => decisionFromBody(item, bodyFor(item, { note: "x".repeat(501) }), NOW, "op-1"), "BAD_DECISION");
  await expectCode(() => decisionFromBody(item, bodyFor(item, { extra: 1 }), NOW, "op-1"), "BAD_DECISION");
  await expectCode(() => decisionFromBody(item, bodyFor(item), NOW, ""), "BAD_DECISION");
});

test("missing decisionId derives a stable idempotency key", () => {
  const item = storedItem();
  const a = decisionFromBody(item, bodyFor(item, { decisionId: undefined }), NOW, "op-1");
  const b = decisionFromBody(item, bodyFor(item, { decisionId: undefined }), "2026-11-05T10:00:00Z", "op-1");
  assert.equal(a.decision_id, b.decision_id);
  assert.match(a.decision_id, /^srv-[0-9a-f]{24}$/);
});

test("store-side validation mirrors the body contract", async () => {
  const item = storedItem();
  const decision = decisionFromBody(item, bodyFor(item), NOW, "op-1");
  validateResearchDecision(item, decision);
  await expectCode(() => validateResearchDecision(item, { ...decision, decision: "send-back" }), "BAD_DECISION");
  await expectCode(() => validateResearchDecision(item, { ...decision, decision_id: "" }), "BAD_DECISION");
  await expectCode(() => validateResearchDecision(item, { ...decision, row_id: "item-nope" }), "UNKNOWN_ROW");
});
