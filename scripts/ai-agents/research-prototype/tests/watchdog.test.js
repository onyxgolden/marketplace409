/** watchdog.test.js — S648A-006: external 5s watchdog around run().
 * Normal tasks settle with the real result; malformed/oversized transport
 * refuses bounded; a truly hung worker is terminated by the external
 * watchdog. Hang probes run through the test-only closed-enum fixture
 * host (RA652-001), never through an executable factory on the
 * production API.
 *
 * RA652-003: every guard/transport/boot/worker-error/cleanup refusal is
 * REFUSED, complete:false, report:null — the same bounded null-report
 * contract as src/index.js.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runGuarded, GUARD_TIMEOUT_MS } from "../runner/run-guarded.js";
import { runFixtureWorker, fixtureWorkerKinds } from "./timeout-probe-host.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

function baseTaskContext() {
  const ref = store.bundleRefs["single-passage"];
  const key = `${ref.repo}|${ref.path}`;
  const task = {
    schema_version: "1", task_id: "watchdog-test", operation: "analyze",
    fixture_refs: { evidence_bundle: ref },
    options: {
      population: { declared_total: 1, complete: true },
      requested_claims: [],
    },
  };
  const context = {
    clock: 1780315200000,
    sources: { [key]: store.sources[key] },
    readGrants: [{ repo: ref.repo, path: ref.path }],
    principal: store.principals.jason,
    criteria: store.criteriaPresets.standard,
    provenance_registry: {},
  };
  return { task, context };
}

function assertNullReportRefusal(r, label) {
  // RA652-003: the uniform refusal contract — no empty domain report
  // object, no partial artifact.
  assert.equal(r.status, "REFUSED", `${label}: status`);
  assert.equal(r.complete, false, `${label}: complete`);
  assert.equal(r.report, null, `${label}: report must be null (got ${JSON.stringify(r.report)?.slice(0, 80)})`);
}

test("S648A-006: normal task settles with the real result", async () => {
  const { task, context } = baseTaskContext();
  // S648A-006 (fourth fix round): guarded transport takes serialized JSON
  // strings (inert); the worker parses under the supervised timer.
  const r = await runGuarded(JSON.stringify(task), JSON.stringify(context), 10000);
  assert.equal(r.status, "REPORT_READY");
  assert.equal(r.complete, true);
  assert.notEqual(r.report, null);
});

test("S648A-006: Proxy-wrapped argument refuses without parent reflection", async () => {
  // The exact fourth-round probe: a Proxy with a hanging ownKeys trap.
  // The parent's typeof check is non-executing, so no trap fires, no
  // hang occurs, and a bounded TRANSPORT_REFUSED settles immediately.
  let trapCalls = 0;
  const evil = new Proxy({}, {
    ownKeys() { trapCalls++; while (true) {} },
    getOwnPropertyDescriptor() { trapCalls++; while (true) {} },
    get() { trapCalls++; while (true) {} },
  });
  const start = Date.now();
  const r = await runGuarded({}, evil, 5000);
  const elapsed = Date.now() - start;
  assertNullReportRefusal(r, "proxy transport");
  assert.ok(r.diagnostics.some((d) => d.code === "TRANSPORT_REFUSED"));
  assert.equal(trapCalls, 0, "no Proxy trap may fire on the parent thread");
  assert.ok(elapsed < 2000, `must refuse immediately without hanging (took ${elapsed}ms)`);
});

test("S648A-006: plain object (non-string) transport refuses bounded", async () => {
  // Non-string inputs are unsupported at the guarded boundary — they
  // cannot be moved to the worker without parent-thread reflection.
  const { task, context } = baseTaskContext();
  const r = await runGuarded(task, context, 5000);
  assertNullReportRefusal(r, "non-string transport");
  assert.ok(r.diagnostics.some((d) => d.code === "TRANSPORT_REFUSED"));
});

test("S648A-006: oversized serialized transport refuses before worker creation", async () => {
  const big = "x".repeat(300000);
  const start = Date.now();
  const r = await runGuarded(JSON.stringify({ task_id: big }), JSON.stringify({}), 5000);
  const elapsed = Date.now() - start;
  assertNullReportRefusal(r, "oversized transport");
  assert.ok(r.diagnostics.some((d) => d.code === "TRANSPORT_REFUSED"));
  assert.ok(elapsed < 2000);
});

test("RA652-003: malformed JSON transport refuses with report:null (worker-error path)", async () => {
  // The worker's JSON.parse throws; the worker-side failure envelope is
  // the bounded null-report contract.
  const r = await runGuarded('{"task_id": ', '"{}"', 5000);
  assertNullReportRefusal(r, "worker transport failure");
  assert.ok(r.diagnostics.some((d) => d.code === "TRANSPORT_REFUSED"));
});

test("RA652-001: production runner exposes no executable factory/eval path", () => {
  // Regression probe: fails on any head that still ships the
  // factorySource/eval worker. Reads the shipped module bytes — no
  // execution of the module under test is needed to prove absence.
  // Comments are stripped first: the fix's own documentation names the
  // removed path, which must not trip the probe.
  const raw = readFileSync(join(ROOT, "runner", "run-guarded.js"), "utf8");
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
  assert.ok(!src.includes("eval: true"), "runner must not create eval workers");
  assert.ok(!src.includes("factorySource"), "runner must not accept a factory input");
  assert.ok(!src.includes("new Function"), "runner must not construct functions from strings");
  // The declared parameter list is exactly (taskJson, contextJson,
  // timeoutMs): no fourth factory parameter (length is 2 either way
  // because timeoutMs has a default, so inspect the declared names).
  const params = runGuarded.toString().match(/^function runGuarded\(([^)]*)\)/)?.[1]
    .split(",").map((p) => p.trim().split("=")[0].trim());
  assert.deepEqual(params, ["taskJson", "contextJson", "timeoutMs"]);
});

test("RA652-001: fourth argument is ignored, never evaluated", async () => {
  // The old signature evaluated runGuarded(null, null, ms, factorySource).
  // The new signature takes three parameters; a stray fourth argument
  // must be inert — the call refuses on the JSON transport check, and
  // nothing is evaluated.
  const r = await runGuarded(null, null, 3000, `() => { while (true) {} }`);
  assertNullReportRefusal(r, "stray factory argument");
  assert.ok(r.diagnostics.some((d) => d.code === "TRANSPORT_REFUSED"));
});

test("RA652-001: closed enum admits only the fixed hang fixture", async () => {
  assert.deepEqual(fixtureWorkerKinds(), ["hang-fixture"]);
  const bad = await runFixtureWorker("../../../etc/passwd", 1000);
  assert.equal(bad.settled, true);
  assert.equal(bad.refused, true, "unknown kind refuses without spawning");
  assert.ok(!("timeout" in bad) && !("message" in bad), "nothing executed");
});

test("RA652-001/S648A-006: hung fixture worker is terminated by the external watchdog", async () => {
  // The fixed hang fixture blocks forever inside the worker. The
  // test-only host's external timer terminates it; the probe settles
  // bounded. No request-supplied code is involved at any point.
  const start = Date.now();
  const r = await runFixtureWorker("hang-fixture", 2000);
  const elapsed = Date.now() - start;
  assert.equal(r.settled, true);
  assert.equal(r.timeout, true, "external watchdog must terminate the hung worker");
  assert.ok(elapsed < 10000, `watchdog must fire near the timeout (took ${elapsed}ms)`);
  assert.ok(elapsed >= 1500, `must actually wait for the timeout (took ${elapsed}ms)`);
});

test("RA652-001/S648A-006: second hang probe settles independently (no shared state)", async () => {
  // Two consecutive hang probes: each terminates bounded, proving no
  // leaked worker keeps the loop alive or hangs the suite.
  for (let i = 0; i < 2; i++) {
    const start = Date.now();
    const r = await runFixtureWorker("hang-fixture", 1000);
    assert.equal(r.timeout, true, `probe ${i} must time out`);
    assert.ok(Date.now() - start < 8000, `probe ${i} must settle near its timeout`);
  }
});

test("RA652-003: timeout envelope carries no domain report (contract shape)", () => {
  // The production timeout path is defensive (a JSON task cannot hang
  // run()), so this asserts the shared contract on every reachable
  // refusal envelope: all of them build from the same baseEnvelope with
  // report:null.
  const src = readFileSync(join(ROOT, "runner", "run-guarded.js"), "utf8");
  const workerSrc = readFileSync(join(ROOT, "runner", "guarded-worker.js"), "utf8");
  for (const [name, text] of [["run-guarded.js", src], ["guarded-worker.js", workerSrc]]) {
    assert.ok(!/report:\s*\{/.test(text), `${name}: no envelope may carry a report object`);
  }
});

test("S648A-006: guard timeout constant is 5000ms", () => {
  assert.equal(GUARD_TIMEOUT_MS, 5000);
});
