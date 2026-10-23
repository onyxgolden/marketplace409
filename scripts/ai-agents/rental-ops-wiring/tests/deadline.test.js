import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryPublisher, runJob } from "../src/runner.js";
import { createInvocationDeadline, runExecution } from "../src/deadline.js";
import { SYNTHETIC_REPOSITORIES } from "../fixtures/repositories.js";
import { fixedClock, makeHost, makeRequest, previewSpec } from "./helpers.js";

/**
 * P2A1-001 / P666-008 probes: ONE preemptive invocation deadline
 * spans adapter admission, normalization and evaluation. The
 * execution worker runs the whole phase; the main thread's event
 * loop stays free, so the deadline timer fires even against a
 * synchronous runaway or a hung reader, and the worker is
 * terminated. Publication is bounded separately with named
 * PUBLICATION_TIMEOUT semantics. Control objects (request, host,
 * policies) are admitted primitive-only: accessors, proxies and
 * serialization hooks refuse without ever running.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const runWithFaults = (faults, over = {}) => runJob({
  hostConfig: makeHost(), request: makeRequest(), clock: fixedClock(),
  publisher: createMemoryPublisher(),
  adapterSpec: previewSpec({ datasets: SYNTHETIC_REPOSITORIES["preview-basic"](), faults }),
  ...over,
});

test("one deadline: slow reads across pages + fast evaluation settle inside the single boundary", async () => {
  const started = Date.now();
  const result = await runWithFaults({ slowReadMs: 700 });
  const elapsed = Date.now() - started;
  assert.equal(result.outcome, "COMPLETED");
  assert.equal(result.report_status, "PROPOSED");
  assert.ok(elapsed >= 4200 && elapsed < 5750, `settled at ${elapsed}ms — outside the single 5000ms boundary + grace`);
});

test("one deadline: a collection overrun refuses EXECUTION_TIMEOUT at the boundary; nothing is published", async () => {
  const publisher = createMemoryPublisher();
  const started = Date.now();
  const result = await runJob({
    hostConfig: makeHost(), request: makeRequest(), clock: fixedClock(), publisher,
    adapterSpec: previewSpec({ datasets: SYNTHETIC_REPOSITORIES["preview-basic"](), faults: { slowReadMs: 1400 } }),
  });
  const elapsed = Date.now() - started;
  assert.deepEqual([result.outcome, result.code], ["REFUSED", "EXECUTION_TIMEOUT"]);
  assert.ok(elapsed < 6500, `refusal took ${elapsed}ms — the deadline did not govern collection`);
  // The worker was terminated mid-read, so no cooperative close ran:
  // adapter_closed is honestly absent on the terminated path (the
  // cooperative path is proven by the blocked-reader test).
  assert.equal(result.adapter_closed, undefined);
  assert.equal(publisher.items.size, 0);
});

test("one deadline: a synchronous runaway in the adapter is terminated preemptively — the reviewer process never blocks", async () => {
  const started = Date.now();
  const result = await runWithFaults({ syncSpinMs: 6500 });
  const elapsed = Date.now() - started;
  assert.deepEqual([result.outcome, result.code], ["REFUSED", "EXECUTION_TIMEOUT"]);
  assert.ok(elapsed < 6500, `a 6.5s synchronous spin held the run for ${elapsed}ms — the boundary is not preemptive`);
});

test("one deadline: a never-settling reader is abandoned at the deadline", async () => {
  const started = Date.now();
  const result = await runWithFaults({ hangCollect: true });
  const elapsed = Date.now() - started;
  assert.deepEqual([result.outcome, result.code], ["REFUSED", "EXECUTION_TIMEOUT"]);
  assert.ok(elapsed < 6500, `hung reader settled at ${elapsed}ms — past the boundary + grace`);
});

test("one deadline: a spent deadline refuses execution immediately, without a fresh window", async () => {
  const deadline = createInvocationDeadline(200);
  await sleep(300);
  const started = Date.now();
  await assert.rejects(runExecution({
    adapterSpec: previewSpec({ datasets: {} }), request: makeRequest(), policies: undefined,
    budgetUsed: { candidates: 0, inputBytes: 0, evidenceSpans: 0, outputRecords: 0 },
    clockIso: fixedClock().nowIso(), deadline,
  }), (err) => err.code === "EXECUTION_TIMEOUT");
  assert.ok(Date.now() - started < 500, "a spent deadline must refuse at once, not start a new timer");
  deadline.dispose();
});

test("publication is bounded separately: a hung publisher settles as PUBLICATION_TIMEOUT", async () => {
  const hangPublisher = { async publish() { return new Promise(() => {}); } };
  const started = Date.now();
  const result = await runJob({
    hostConfig: makeHost(), request: makeRequest(), clock: fixedClock(),
    publisher: hangPublisher,
    adapterSpec: previewSpec({ datasets: SYNTHETIC_REPOSITORIES["preview-basic"]() }),
  });
  const elapsed = Date.now() - started;
  assert.deepEqual([result.outcome, result.code], ["REFUSED", "PUBLICATION_TIMEOUT"]);
  assert.equal(result.counters.store_writes, 0);
  assert.ok(elapsed >= 4500 && elapsed < 7000, `publication bound settled at ${elapsed}ms`);
});

test("output accounting: 255 admitted objects publish, 261 refuse at the 256-record cap", async () => {
  // Calibration (2026-10-22): 39 lease rows -> 255 output objects,
  // 40 lease rows -> 261 output objects; candidates stay well under
  // the 64-cap, so this isolates the outputRecords boundary.
  const withLeases = async (n) => {
    const data = SYNTHETIC_REPOSITORIES["preview-basic"]();
    const base = data.leases[0];
    data.leases = Array.from({ length: n }, (_, i) => ({ ...base, lease_ref: `l-${i}`, end_date: "2026-11-01" }));
    data.memberships = []; data.charges = []; data.schedules = [];
    const publisher = createMemoryPublisher();
    const result = await runJob({
      hostConfig: makeHost(), request: makeRequest(), clock: fixedClock(), publisher,
      adapterSpec: previewSpec({ datasets: data }),
    });
    return { result, publisher };
  };
  const under = await withLeases(39);
  assert.equal(under.result.outcome, "COMPLETED");
  const over = await withLeases(40);
  assert.deepEqual([over.result.outcome, over.result.code, over.result.kind],
    ["BUDGET_EXCEEDED", "BUDGET_EXCEEDED", "outputRecords"]);
  assert.equal(over.publisher.items.size, 0);
  assert.equal(over.result.counters.store_writes, 0);
});

test("admission: a request accessor is refused as control data without ever being invoked", async () => {
  let invocations = 0;
  const req = makeRequest();
  Object.defineProperty(req, "principal_ref", {
    enumerable: true,
    get() { invocations += 1; return "host:workbench-operator"; },
  });
  const result = await runJob({
    hostConfig: makeHost(), request: req, clock: fixedClock(),
    publisher: createMemoryPublisher(),
    adapterSpec: previewSpec({ datasets: {} }),
  });
  assert.deepEqual([result.outcome, result.code], ["REFUSED", "CONTROL_DATA_REFUSED"]);
  assert.equal(invocations, 0, "the accessor must never run — descriptors are inspected, not values");
});

test("admission: policies carrying a toJSON hook refuse without running it", async () => {
  let ran = 0;
  const policies = { tenant: { toJSON() { ran += 1; return {}; } } };
  const result = await runJob({
    hostConfig: makeHost(), request: makeRequest(), clock: fixedClock(),
    publisher: createMemoryPublisher(), policies,
    adapterSpec: previewSpec({ datasets: {} }),
  });
  assert.deepEqual([result.outcome, result.code], ["REFUSED", "CONTROL_DATA_REFUSED"]);
  assert.equal(ran, 0, "the serialization hook must never run");
});

test("admission: a proxied host config refuses as control data", async () => {
  const result = await runJob({
    hostConfig: new Proxy(makeHost(), {}), request: makeRequest(), clock: fixedClock(),
    publisher: createMemoryPublisher(),
    adapterSpec: previewSpec({ datasets: {} }),
  });
  assert.deepEqual([result.outcome, result.code], ["REFUSED", "CONTROL_DATA_REFUSED"]);
});
