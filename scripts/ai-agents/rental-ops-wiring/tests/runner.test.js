import assert from "node:assert/strict";
import { test } from "node:test";
import { runJob, createMemoryPublisher } from "../src/runner.js";
import { createSyntheticAdapter } from "../src/syntheticRepository.js";
import { SYNTHETIC_REPOSITORIES, PII_CANARIES } from "../fixtures/repositories.js";
import { fixedClock, makeHost, makeRequest, runPreview, onlyItem } from "./helpers.js";

const explodingFactory = () => { throw new Error("adapter factory must not be called"); };

test("DISABLED returns before opening adapters, the store, or any source", async () => {
  let published = 0;
  const result = await runJob({
    hostConfig: makeHost({ mode: "DISABLED" }),
    request: makeRequest(),
    adapterFactory: explodingFactory,
    publisher: { async publish() { published += 1; } },
    clock: fixedClock(),
  });
  assert.equal(result.outcome, "DISABLED");
  assert.deepEqual(result.counters, { adapter_opens: 0, adapter_calls: 0, credential_reads: 0, network_calls: 0, store_writes: 0 });
  assert.equal(published, 0);
});

test("live-shaped asks are ACTIVATION_REQUIRED (caller ask, host mode), never a run", async () => {
  const byCaller = await runJob({
    hostConfig: makeHost(), request: makeRequest(), callerAsk: "live",
    adapterFactory: explodingFactory, publisher: createMemoryPublisher(), clock: fixedClock(),
  });
  assert.equal(byCaller.outcome, "ACTIVATION_REQUIRED");
  const byHost = await runJob({
    hostConfig: makeHost({ mode: "PRODUCTION" }), request: makeRequest(),
    adapterFactory: explodingFactory, publisher: createMemoryPublisher(), clock: fixedClock(),
  });
  assert.equal(byHost.outcome, "ACTIVATION_REQUIRED");
});

test("unknown mode / unknown agent / second agent refuse closed, distinctly", async () => {
  const badMode = await runJob({
    hostConfig: makeHost({ mode: "TURBO" }), request: makeRequest(),
    adapterFactory: explodingFactory, publisher: createMemoryPublisher(), clock: fixedClock(),
  });
  assert.deepEqual([badMode.outcome, badMode.code], ["REFUSED", "UNKNOWN_MODE"]);
  const badKind = await runJob({
    hostConfig: makeHost(), request: makeRequest({ job_kind: "tax-agent-review" }),
    adapterFactory: explodingFactory, publisher: createMemoryPublisher(), clock: fixedClock(),
  });
  assert.equal(badKind.code, "UNKNOWN_AGENT");
  const mm = await runJob({
    hostConfig: makeHost(), request: makeRequest({ job_kind: "maintenance-manager-backlog-review" }),
    adapterFactory: explodingFactory, publisher: createMemoryPublisher(), clock: fixedClock(),
  });
  assert.deepEqual([mm.outcome, mm.code], ["REFUSED", "JOB_NOT_BUILT_IN_SLICE"]);
});

test("caller-supplied adapter or smuggled request fields refuse before any open", async () => {
  const byAdapter = await runJob({
    hostConfig: makeHost(), request: makeRequest(), callerAdapter: { url: "https://example.invalid" },
    adapterFactory: explodingFactory, publisher: createMemoryPublisher(), clock: fixedClock(),
  });
  assert.equal(byAdapter.code, "CALLER_ADAPTER_REFUSED");
  const smuggled = await runPreview({ request: { mode: "LIVE" } });
  assert.equal(smuggled.result.code, "BAD_REQUEST");
  const smuggledSql = await runPreview({ request: { sql: "select * from rental_tenants" } });
  assert.equal(smuggledSql.result.code, "BAD_REQUEST");
});

test("principal / owner spoofing refuses with zero adapter opens", async () => {
  const badPrincipal = await runPreview({ request: { principal_ref: "mallory" } });
  assert.equal(badPrincipal.result.code, "PRINCIPAL_MISMATCH");
  assert.equal(badPrincipal.result.counters.adapter_opens, 0);
  const badOwner = await runPreview({ request: { owner_ref: "owner-b" } });
  assert.equal(badOwner.result.code, "SCOPE_VIOLATION");
  assert.equal(badOwner.result.counters.adapter_opens, 0);
  assert.equal(badOwner.publisher.items.size, 0);
});

test("a non-synthetic adapter kind is not installed in this release", async () => {
  const { result } = await runPreview({ host: { adapter_kind: "production" } });
  assert.equal(result.code, "ADAPTER_NOT_INSTALLED");
  assert.equal(result.counters.adapter_opens, 0);
});

test("synthetic preview completes end to end with clean effect counters", async () => {
  const { result, publisher } = await runPreview();
  assert.equal(result.outcome, "COMPLETED");
  assert.equal(result.counters.credential_reads, 0);
  assert.equal(result.counters.network_calls, 0);
  assert.equal(result.counters.store_writes, 1);
  assert.ok(result.counters.adapter_calls > 0);
  const item = onlyItem(publisher);
  assert.equal(item.execution_authorized, false);
  assert.equal(item.synthetic, true);
  // lease-1 (owner-a) ended 2026-10-17: 5 days expired at as_of_date 2026-10-22.
  const exp = item.report.sections.lease_expirations.rows.map((r) => [r.lease_ref, r.days_until_expiration]);
  assert.deepEqual(exp, [["lease-1", -5], ["lease-2", 30]]);
  const ovd = item.report.sections.overdue_balances.rows[0];
  assert.equal(ovd.forge_collectible_cents, 100000);
  assert.equal(ovd.externally_managed_cents, 30000);
});

test("identical replay is idempotent; no second store write", async () => {
  const publisher = createMemoryPublisher();
  const data = SYNTHETIC_REPOSITORIES["preview-basic"]();
  const run = () => runJob({
    hostConfig: makeHost(), request: makeRequest(),
    adapterFactory: () => createSyntheticAdapter({ datasets: data }),
    publisher, clock: fixedClock(),
  });
  const first = await run();
  const second = await run();
  assert.equal(first.item_id, second.item_id);
  assert.equal(second.receipt.idempotent, true);
  assert.equal(second.counters.store_writes, 0);
  assert.equal(publisher.items.size, 1);
});

test("PII canaries from raw rows appear nowhere in the published item", async () => {
  const { publisher } = await runPreview();
  const bytes = JSON.stringify(onlyItem(publisher));
  for (const canary of PII_CANARIES) assert.ok(!bytes.includes(canary), `canary leaked: ${canary}`);
  assert.ok(!bytes.includes("tenant-secret-"));
});

test("revoked permission and stale session refuse the run; nothing is published", async () => {
  const revoked = await runPreview({ faults: { revoked: true } });
  assert.deepEqual([revoked.result.outcome, revoked.result.code], ["REFUSED", "PERMISSION_REVOKED"]);
  assert.equal(revoked.publisher.items.size, 0);
  const stale = await runPreview({ faults: { staleSession: true } });
  assert.equal(stale.result.code, "STALE_SESSION");
  assert.equal(stale.publisher.items.size, 0);
});

test("a blocked reader settles via the bounded read timeout, adapter cleaned up, report is PARTIAL", async () => {
  const started = Date.now();
  const { result, publisher, adapter } = await runPreview({ faults: { blockedDataset: "charges" } });
  const elapsed = Date.now() - started;
  assert.equal(result.outcome, "COMPLETED");
  assert.ok(elapsed < 5000, `blocked reader did not settle inside the boundary (${elapsed}ms)`);
  assert.equal(adapter().closed, true);
  const item = onlyItem(publisher);
  assert.equal(item.report.status, "PARTIAL");
  assert.ok(item.report.exclusions.some((e) => e.dataset === "charges" && e.code === "READ_TIMEOUT"));
});
