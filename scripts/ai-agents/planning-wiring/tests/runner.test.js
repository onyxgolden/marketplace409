/**
 * Planning runner node:test suite. Runs through the full inert
 * runner (not the units): DISABLED zero-access, ACTIVATION_REQUIRED
 * for live shapes, sequencing gates, scope binding, idempotent
 * replay, and the worker deadline. The battery (97 cases) is the
 * exhaustive proof; these tests are the readable regression net.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryPublisher, runJob } from "../src/runner.js";
import { CANONICAL_AS_OF, CANONICAL_HOST, canonicalRequest, canonicalSpec } from "../src/fixtures.js";

const clock = { nowIso: () => CANONICAL_AS_OF };

test("DISABLED returns before any adapter access", async () => {
  const publisher = createMemoryPublisher();
  const result = await runJob({
    hostConfig: { ...CANONICAL_HOST, mode: "DISABLED" },
    request: canonicalRequest(), adapterSpec: canonicalSpec(), publisher, clock,
  });
  assert.equal(result.outcome, "DISABLED");
  assert.deepEqual(result.counters, {
    adapter_opens: 0, adapter_calls: 0, credential_reads: 0, network_calls: 0, store_writes: 0,
  });
  assert.equal(publisher.items.size, 0);
});

test("live and production shapes return ACTIVATION_REQUIRED", async () => {
  for (const mode of ["LIVE", "PRODUCTION"]) {
    const result = await runJob({
      hostConfig: { ...CANONICAL_HOST, mode },
      request: canonicalRequest(), adapterSpec: canonicalSpec(),
      publisher: createMemoryPublisher(), clock,
    });
    assert.equal(result.outcome, "ACTIVATION_REQUIRED");
  }
});

test("canonical synthetic run completes and publishes a DRAFT report", async () => {
  const publisher = createMemoryPublisher();
  const result = await runJob({
    hostConfig: CANONICAL_HOST, request: canonicalRequest(),
    adapterSpec: canonicalSpec(), publisher, clock,
  });
  assert.equal(result.outcome, "COMPLETED");
  assert.equal(result.report_status, "DRAFT");
  assert.equal(result.item.report.execution_authorized, false);
  assert.equal(publisher.items.size, 1);
});

test("replay is idempotent; changed bytes conflict", async () => {
  const publisher = createMemoryPublisher();
  const args = {
    hostConfig: CANONICAL_HOST, request: canonicalRequest(),
    adapterSpec: canonicalSpec(), publisher, clock,
  };
  const first = await runJob(args);
  const second = await runJob(args);
  assert.equal(first.outcome, "COMPLETED");
  assert.equal(second.receipt.written, false);
  assert.equal(second.receipt.idempotent, true);
  const stored = publisher.items.get(first.item_id);
  const tampered = JSON.parse(JSON.stringify(stored));
  tampered.report = { ...tampered.report, status: "TAMPERED" };
  tampered.report_digest = "tampered-digest";
  await assert.rejects(() => publisher.publish(tampered), /REPUBLISH_CONFLICT/);
});

test("P2b-2 sequencing-gate move: Project Manager kind still refuses JOB_NOT_BUILT_IN_SLICE; Controls kind is built", async () => {
  const result = await runJob({
    hostConfig: CANONICAL_HOST,
    request: { ...canonicalRequest(), job_kind: "project-manager-plan-health-review", window: { name: "planning-review-snapshot" } },
    adapterSpec: canonicalSpec(), publisher: createMemoryPublisher(), clock,
  });
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.code, "JOB_NOT_BUILT_IN_SLICE");
});

test("typed scope binding: a package id equal to the project id is not the registered scope", async () => {
  const result = await runJob({
    hostConfig: CANONICAL_HOST,
    request: { ...canonicalRequest(), project_scope_ref: { type: "package", id: "P-1" } },
    adapterSpec: canonicalSpec(), publisher: createMemoryPublisher(), clock,
  });
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.code, "SCOPE_UNREGISTERED");
});

test("synchronous adapter runaway is terminated by the preemptive deadline", async () => {
  const spec = canonicalSpec();
  spec.faults = { syncSpinMs: 30000 };
  const started = Date.now();
  const result = await runJob({
    hostConfig: CANONICAL_HOST, request: canonicalRequest(),
    adapterSpec: spec, publisher: createMemoryPublisher(), clock,
  });
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.code, "EXECUTION_TIMEOUT");
  assert.ok(Date.now() - started < 15000, `deadline must settle near 5 s, took ${Date.now() - started} ms`);
});

// --- P677-003: the manifest must pin the actual transitive closure ---
// Independent re-implementation of the import walk (not the
// generator's own guard): if either is weakened, the other still
// catches a reachable-but-unlisted executable. trust-entry.mjs was
// the hole — imported by run-tests.js, absent from the manifest,
// executed before any verification.

test("manifest pins the complete transitive executable closure", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const { dirname, join, resolve, relative, sep } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const wiring = resolve(here, "..");
  const root = resolve(wiring, "..", "..", "..");
  const manifest = JSON.parse(readFileSync(join(here, "..", "runner", "manifest.json"), "utf8"));
  const listed = new Set(Object.keys(manifest.files));
  // The two P677-003 verdict-named holes must be listed explicitly.
  assert.ok(listed.has("runner/trust-entry.mjs"), "trust-entry.mjs must be manifest-listed");
  assert.ok(listed.has("../scheduler-prototype/src/canonical.js"), "scheduler canonical helper must be manifest-listed");
  const reached = new Set(listed);
  const queue = [...listed];
  const patterns = [
    /from\s+["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /new\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g,
  ];
  while (queue.length > 0) {
    const key = queue.shift();
    const abs = join(wiring, key);
    if (!/\.(m?js)$/.test(abs) || !existsSync(abs)) continue;
    const text = readFileSync(abs, "utf8");
    const specs = new Set();
    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) specs.add(m[1]);
    }
    for (const spec of specs) {
      if (!spec.startsWith(".")) continue;
      const base = resolve(dirname(abs), spec);
      for (const cand of [base, `${base}.js`, `${base}.mjs`, `${base}.json`, join(base, "index.js"), join(base, "index.mjs")]) {
        if (!existsSync(cand) || !cand.startsWith(root + sep)) continue;
        const candKey = relative(wiring, cand);
        if (!reached.has(candKey)) { reached.add(candKey); queue.push(candKey); }
        break;
      }
    }
  }
  const unlisted = [...reached].filter((k) => !listed.has(k)).sort();
  assert.deepEqual(unlisted, [], `reachable but unlisted executables: ${unlisted.join(", ")}`);
});
