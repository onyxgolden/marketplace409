import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createResearchTransport } from "../src/transport.js";
import { createStoreDouble } from "./storeDouble.js";
import { loadFixture, validDefinition, expectCode, PRINCIPAL, NOW } from "./helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");

function transportFor(store = createStoreDouble(), principal = PRINCIPAL) {
  return createResearchTransport({ store, principal, clock: { nowIso: () => NOW } });
}

async function publishSmall(store) {
  const transport = transportFor(store);
  return transport.publishPreview({
    definition: validDefinition(),
    invocation_id: "inv-1",
    actor: "op-1",
    corpus: loadFixture("small-corpus.json"),
    now: NOW,
  });
}

test("publish happy path stores one private item and round-trips", async () => {
  const store = createStoreDouble();
  const { item, put, receipt } = await publishSmall(store);
  assert.equal(put.written, true);
  assert.equal(put.idempotent, false);
  assert.equal(receipt.mode, "SYNTHETIC_PREVIEW");
  assert.equal(receipt.job_status, "DISABLED");
  const fetched = await store.getItem(item.item_id);
  assert.equal(fetched.report_digest, item.report_digest);
  assert.equal(fetched.execution_authorized, false);
  const listed = await store.listItems();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].item_id, item.item_id);
  assert.equal(listed[0].agent, "research");
});

test("duplicate invocation with identical inputs is idempotent, not a second item", async () => {
  const store = createStoreDouble();
  const first = await publishSmall(store);
  const second = await publishSmall(store);
  assert.equal(second.put.written, false);
  assert.equal(second.put.idempotent, true);
  assert.equal(second.item.item_id, first.item.item_id);
  assert.equal((await store.listItems()).length, 1);
});

test("changed retry under the same invocation conflicts instead of overwriting", async () => {
  const store = createStoreDouble();
  await publishSmall(store);
  const transport = transportFor(store);
  await expectCode(
    () => transport.publishPreview({
      definition: validDefinition(),
      invocation_id: "inv-1",
      actor: "op-1",
      corpus: loadFixture("empty-corpus.json"),
      now: NOW,
    }),
    "REPUBLISH_CONFLICT",
  );
});

test("cross-workspace and cross-operator definitions refuse before any publish", async () => {
  const store = createStoreDouble();
  const transport = transportFor(store);
  await expectCode(
    () => transport.publishPreview({
      definition: validDefinition({ operator_scope: { operator_ref: "op-1", workspace_ref: "ws-2" } }),
      invocation_id: "inv-1",
      actor: "op-1",
      corpus: loadFixture("small-corpus.json"),
      now: NOW,
    }),
    "PRINCIPAL_MISMATCH",
  );
  await expectCode(
    () => transport.publishPreview({
      definition: validDefinition({ operator_scope: { operator_ref: "op-2", workspace_ref: "ws-1" } }),
      invocation_id: "inv-1",
      actor: "op-1",
      corpus: loadFixture("small-corpus.json"),
      now: NOW,
    }),
    "PRINCIPAL_MISMATCH",
  );
  assert.equal((await store.listItems()).length, 0);
});

test("missing store and malformed store refuse closed", async () => {
  await expectCode(() => createResearchTransport({ principal: PRINCIPAL }), "STORE_REQUIRED");
  await expectCode(
    () => createResearchTransport({ store: { putItem: async () => ({}) }, principal: PRINCIPAL }),
    "STORE_REQUIRED",
  );
  await expectCode(() => createResearchTransport({ store: createStoreDouble() }), "BAD_HOST_CONFIG");
});

test("P1-A refusals propagate: unauthorized corpus, budget, non-disabled status", async () => {
  const store = createStoreDouble();
  const transport = transportFor(store);
  await expectCode(
    () => transport.publishPreview({
      definition: validDefinition({ allowed_source_corpus_ids: ["small-corpus"] }),
      invocation_id: "inv-1",
      actor: "op-1",
      corpus: loadFixture("empty-corpus.json"),
      now: NOW,
    }),
    "MISSING_SOURCE_AUTHORIZATION",
  );
  await expectCode(
    () => transport.publishPreview({
      definition: validDefinition({ budget: { max_items_per_run: 2, max_bytes_per_run: 262144, max_tool_calls_per_run: 64 } }),
      invocation_id: "inv-1",
      actor: "op-1",
      corpus: loadFixture("synthetic-replay.json"),
      now: NOW,
    }),
    "BUDGET_EXCEEDED",
  );
  await expectCode(
    () => transport.publishPreview({
      definition: validDefinition({ status: "ACTIVE" }),
      invocation_id: "inv-1",
      actor: "op-1",
      corpus: loadFixture("small-corpus.json"),
      now: NOW,
    }),
    "NON_DISABLED_STATUS",
  );
});

test("decide happy path, idempotent replay, and conflict", async () => {
  const store = createStoreDouble();
  const transport = transportFor(store);
  const { item } = await publishSmall(store);
  const body = {
    itemId: item.item_id,
    reportDigest: item.report_digest,
    rowId: item.row_ids[0],
    decision: "accept",
    note: "good",
    decisionId: "d-1",
  };
  const first = await transport.decide({ itemId: item.item_id, body, actor: "op-1" });
  assert.equal(first.idempotent, false);
  assert.equal(first.revision.revision, 1);
  const replay = await transport.decide({ itemId: item.item_id, body, actor: "op-1" });
  assert.equal(replay.idempotent, true);
  assert.equal(replay.revision.revision, 1);
  await expectCode(
    () => transport.decide({ itemId: item.item_id, body: { ...body, decision: "reject" }, actor: "op-1" }),
    "DECISION_CONFLICT",
  );
  const record = await transport.getDecisions(item.item_id);
  assert.equal(record.revisions.length, 1);
  await expectCode(
    () => transport.decide({ itemId: "run-00000000000000000000000000000000", body, actor: "op-1" }),
    "UNKNOWN_ITEM",
  );
  await expectCode(
    () => transport.decide({
      itemId: item.item_id,
      body: { ...body, reportDigest: "0".repeat(64), decisionId: "d-9" },
      actor: "op-1",
    }),
    "STALE_DIGEST",
  );
});

test("closed loop: open while rows are pending, closed when all rows are decided", async () => {
  const store = createStoreDouble();
  const transport = transportFor(store);
  const { item } = await publishSmall(store);
  const open = await transport.closedLoop(item.item_id);
  assert.equal(open.closed, false);
  assert.deepEqual(open.pending_rows, item.row_ids);
  for (let i = 0; i < item.row_ids.length; i++) {
    await transport.decide({
      itemId: item.item_id,
      body: {
        itemId: item.item_id,
        reportDigest: item.report_digest,
        rowId: item.row_ids[i],
        decision: i % 2 === 0 ? "accept" : "reject",
        decisionId: `d-${i}`,
      },
      actor: "op-1",
    });
  }
  const closed = await transport.closedLoop(item.item_id);
  assert.equal(closed.closed, true);
  assert.deepEqual(closed.pending_rows, []);
  assert.equal(closed.decision_count, 3);
});

test("Generac 8-item synthetic replay: 8 rows, 8 distinct decisions, loop closed", async () => {
  const store = createStoreDouble();
  const transport = transportFor(store);
  const { item, put } = await transport.publishPreview({
    definition: validDefinition(),
    invocation_id: "generac-replay-1",
    actor: "op-1",
    corpus: loadFixture("synthetic-replay.json"),
    now: NOW,
  });
  assert.equal(put.written, true);
  assert.equal(item.row_ids.length, 8);
  assert.equal(new Set(item.row_ids).size, 8);
  for (let i = 0; i < 8; i++) {
    await transport.decide({
      itemId: item.item_id,
      body: {
        itemId: item.item_id,
        reportDigest: item.report_digest,
        rowId: item.row_ids[i],
        decision: i % 2 === 0 ? "accept" : "reject",
        note: `fixture decision ${i}`,
        decisionId: `generac-d-${i}`,
      },
      actor: "op-1",
    });
  }
  const loop = await transport.closedLoop(item.item_id);
  assert.equal(loop.closed, true);
  assert.deepEqual(loop.pending_rows, []);
  assert.equal(loop.decision_count, 8);
});

test("empty preview publishes with zero rows and a vacuously closed loop", async () => {
  const store = createStoreDouble();
  const transport = transportFor(store);
  const { item } = await transport.publishPreview({
    definition: validDefinition(),
    invocation_id: "inv-empty",
    actor: "op-1",
    corpus: loadFixture("empty-corpus.json"),
    now: NOW,
  });
  assert.deepEqual(item.row_ids, []);
  const loop = await transport.closedLoop(item.item_id);
  assert.equal(loop.closed, true);
});

test("no scheduler, timer, network, or filesystem surface in the adapter sources", () => {
  // "cron" alone is prose in these files ("no cron"); the guard targets
  // scheduler mechanisms, not the word in documentation.
  const banned = ["setTimeout", "setInterval", "setImmediate", "node:fs", "node:http", "node:timers", "cron.schedule", "fetch("];
  for (const file of readdirSync(SRC).filter((name) => name.endsWith(".js"))) {
    const text = readFileSync(join(SRC, file), "utf8");
    for (const token of banned) {
      assert.equal(text.includes(token), false, `${file} must not contain '${token}'`);
    }
  }
});
