import test from "node:test";
import assert from "node:assert/strict";
import { buildPreview } from "../../research-job-contract/src/preview.js";
import { serializeResearchItem } from "../src/serializer.js";
import { loadFixture, validDefinition, expectCode, NOW } from "./helpers.js";

function previewFor(overrides = {}, corpusName = "small-corpus") {
  const definition = validDefinition(overrides);
  const { receipt, items } = buildPreview({
    definition,
    invocation_id: "inv-1",
    actor: "op-1",
    corpus: loadFixture(`${corpusName}.json`),
    now: NOW,
  });
  return { definition, receipt, items };
}

test("valid preview maps to a private-store item with the P2a shape", () => {
  const { definition, receipt, items } = previewFor();
  const item = serializeResearchItem({ receipt, items, definition, publishedAt: receipt.created_at });
  assert.equal(item.schema_version, "research-private-item@1");
  assert.equal(item.item_id, receipt.run_id);
  assert.match(item.item_id, /^[a-z0-9][a-z0-9-]*$/);
  assert.equal(item.kind, "research-preview");
  assert.equal(item.agent, "research");
  assert.equal(item.title, "Weekly research brief");
  assert.equal(item.synthetic, true);
  assert.equal(item.execution_authorized, false);
  assert.equal(item.job_status, "DISABLED");
  assert.equal(item.mode, "SYNTHETIC_PREVIEW");
  assert.equal(item.created_from.job_id, "research-weekly-brief@1");
  assert.equal(item.created_from.definition_hash, receipt.definition_hash);
  assert.equal(item.created_from.fixture_set_hash, receipt.fixture_set_hash);
  assert.equal(item.created_from.invocation_id, "inv-1");
  assert.equal(item.created_from.actor, "op-1");
  assert.equal(item.job_definition.job_id, "research-weekly-brief@1");
  assert.deepEqual(item.row_ids, items.map((entry) => entry.item_key));
  assert.equal(item.evidence_spans.length, 3);
  assert.deepEqual(item.evidence_spans[0], { item_key: items[0].item_key, evidence_sha256: items[0].evidence_sha256 });
  assert.match(item.report_digest, /^[0-9a-f]{64}$/);
  assert.equal(item.published_at, NOW);
  assert.equal(item.pinned.deliverable_schema_version, "workbench-item@1");
  // Weekly Monday 09:00 America/Chicago after Wed 2026-11-04 15:00Z:
  // next Monday 2026-11-09 09:00 CST == 15:00Z.
  assert.equal(Date.parse(item.next_due), Date.parse("2026-11-09T15:00:00Z"));
});

test("serialization is deterministic for identical inputs", () => {
  const first = previewFor();
  const second = previewFor();
  const a = serializeResearchItem({ ...first, publishedAt: first.receipt.created_at });
  const b = serializeResearchItem({ ...second, publishedAt: second.receipt.created_at });
  assert.deepEqual(a, b);
});

test("stale receipt refuses", async () => {
  const { definition, receipt, items } = previewFor();
  const changed = validDefinition({ title: "Changed title" });
  await expectCode(
    () => serializeResearchItem({ receipt, items, definition: changed, publishedAt: receipt.created_at }),
    "STALE_PREVIEW",
  );
});

test("non-preview mode and non-disabled status refuse", async () => {
  const { definition, receipt, items } = previewFor();
  await expectCode(
    () => serializeResearchItem({ receipt: { ...receipt, mode: "LIVE" }, items, definition, publishedAt: NOW }),
    "BAD_PREVIEW_INPUT",
  );
  await expectCode(
    () => serializeResearchItem({ receipt: { ...receipt, job_status: "ACTIVE" }, items, definition, publishedAt: NOW }),
    "BAD_PREVIEW_INPUT",
  );
});

test("run id, job binding, and count mismatches refuse", async () => {
  const { definition, receipt, items } = previewFor();
  await expectCode(
    () => serializeResearchItem({ receipt: { ...receipt, run_id: "run-00000000000000000000000000000000" }, items, definition, publishedAt: NOW }),
    "BAD_PREVIEW_INPUT",
  );
  await expectCode(
    () => serializeResearchItem({ receipt: { ...receipt, job_id: "research-other@1" }, items, definition, publishedAt: NOW }),
    "BAD_PREVIEW_INPUT",
  );
  await expectCode(
    () => serializeResearchItem({ receipt: { ...receipt, item_count: 99 }, items, definition, publishedAt: NOW }),
    "BAD_PREVIEW_INPUT",
  );
});

test("non-PENDING items and duplicate item keys refuse", async () => {
  const { definition, receipt, items } = previewFor();
  await expectCode(
    () => serializeResearchItem({ receipt, items: [{ ...items[0], decision_status: "ACCEPTED" }, ...items.slice(1)], definition, publishedAt: NOW }),
    "BAD_PREVIEW_INPUT",
  );
  const duped = [items[0], items[0], items[2]];
  await expectCode(
    () => serializeResearchItem({ receipt: { ...receipt, item_count: 3 }, items: duped, definition, publishedAt: NOW }),
    "DUPLICATE_ITEM_KEY",
  );
});

test("empty preview serializes with zero rows", () => {
  const { definition, receipt, items } = previewFor({}, "empty-corpus");
  assert.equal(items.length, 0);
  const item = serializeResearchItem({ receipt, items, definition, publishedAt: receipt.created_at });
  assert.deepEqual(item.row_ids, []);
  assert.deepEqual(item.evidence_spans, []);
  assert.equal(item.report.receipt.empty_claim !== null, true);
});
