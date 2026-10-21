#!/usr/bin/env node
/**
 * run-tests.js — OFFICIAL focused-test entrypoint (behind the trust
 * bootstrap; imported only after the manifest digest is
 * authenticated). node:test suite for the Validation Agent Phase 2
 * slice 1 prototype: provenance reason matrix, classification
 * precedence, command gate, injection quarantine, budget boundaries
 * (in-process INPUT_LIMIT exact fit, object/span/output counters),
 * Proxy/getter refusal, watchdog timeout, transport refusal,
 * determinism/input purity, resolver units, and bootstrap mutation
 * tests proving authentication fires before any candidate byte runs.
 *
 * Run via the host trust bootstrap:
 *   VALIDATION_APPROVED_ROOT=<digest> node <trust>/bootstrap.js <proto> tests
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, cpSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { run, canonicalJson } from "../src/index.js";
import { gitBlobId } from "../src/canonical.js";
import { verifySpan } from "../src/resolver.js";
import { runGuarded } from "../runner/run-guarded.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROTO = join(HERE, "..");
const runs = JSON.parse(readFileSync(join(PROTO, "fixtures", "runs.json"), "utf8"));
const store = JSON.parse(readFileSync(join(PROTO, "fixtures", "store.json"), "utf8"));

const CLOCK = 1792368000000; // 2026-10-19T00:00:00Z
const PRINCIPAL = { principal_id: "muse-relay-01", role: "MUSE_RELAY", registered_by: "jason", valid_from: "2026-01-01", expires_at: "2027-01-01", revoked: false };
const ALIASES = { "scout-01": "scout-01", "scout-02": "scout-02", "scout-99": "scout-99", "scout-alpha": "builder-01", "builder-01": "builder-01", "koe-jr": "koe-jr", "muse-relay-01": "muse-relay-01" };
const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const sha1hex = (s) => createHash("sha1").update(s, "utf8").digest("hex");
const gitBlob = (text) => {
  const bytes = Buffer.from(text, "utf8");
  const header = Buffer.from(`blob ${bytes.length}\0`, "utf8");
  return createHash("sha1").update(Buffer.concat([header, bytes])).digest("hex");
};
function canon(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
}
const S = (test_count, pass_count, fail_count, skip_count, suite_errors, exit_code, run_crashed, timed_out, complete_summary, suite_id, result_class) => ({
  schema_version: "1", test_count, pass_count, fail_count, skip_count,
  suite_errors, exit_code, run_crashed, timed_out, complete_summary, suite_id, result_class,
});

function positiveTask(run, over = {}) {
  const { request: reqOver, ...taskOver } = over;
  const task = {
    schema_version: "1", task_id: `test-${run.run_id}`, operation: "analyze",
    fixture_refs: { artifact_ref: run.artifactRef },
    options: { request: {
      claim_id: `claim-${run.run_id}`,
      implementation_ref: run.implementationRef,
      implementer_principal_id: run.implementer,
      command: run.command,
      run_id: run.run_id,
      runner_artifact_ref: run.artifactRef,
      expected_suite_id: run.suite,
      claimed_summary: run.summary,
      registry_record_ref: { run_id: run.run_id },
    } },
  };
  return { ...task, ...taskOver, options: { request: { ...task.options.request, ...(reqOver ?? {}) } } };
}
function positiveContext(run, over = {}) {
  const ctx = {
    clock: CLOCK,
    sources: { [run.sourceKey]: store.sources[run.sourceKey] },
    readGrants: [{ repo: "forge-runner", path: run.artifactRef.path }],
    principal: { ...PRINCIPAL },
    aliases: { ...ALIASES },
    criteria: { criteria_version: "validation-v1" },
    provenance_registry: { [run.run_id]: structuredClone(run.registryEntry) },
  };
  return { ...ctx, ...over };
}
const R1 = runs["run-00001"];
const codes = (env) => env.diagnostics.map((d) => d.code);

// ------------------------------------------------ provenance matrix
test("positive independent mock run: REPORT_READY/PASS/MOCK_INDEPENDENT_RUN", () => {
  const r = run(positiveTask(R1), positiveContext(R1));
  assert.equal(r.status, "REPORT_READY");
  assert.equal(r.report.test_result.classification, "PASS");
  assert.equal(r.report.provenance.verified_by, "MOCK_INDEPENDENT_RUN");
  assert.ok(r.report.claim_comparisons.every((c) => c.match !== false));
  assert.equal(r.diagnostics.length, 0);
});

const REASON_CASES = [
  ["revoked entry", (ctx) => { ctx.provenance_registry["run-00001"].revoked = true; }],
  ["future recorded_at", (ctx) => { ctx.provenance_registry["run-00001"].recorded_at = "2027-01-01T00:00:00Z"; }],
  ["implementation_ref mismatch", (ctx) => { ctx.provenance_registry["run-00001"].implementation_ref = { ...ctx.provenance_registry["run-00001"].implementation_ref, commit: sha1hex("impl|OTHER") }; }],
  ["command digest mismatch", (ctx) => { ctx.provenance_registry["run-00001"].command_sha256 = sha256hex("forge:test --suite suite-beta"); }],
  ["output digest mismatch", (ctx) => { ctx.provenance_registry["run-00001"].output_sha256 = sha256hex("different output"); }],
  ["artifact digest mismatch", (ctx) => { ctx.provenance_registry["run-00001"].artifact_sha256 = sha256hex("different bytes"); }],
  ["suite identity mismatch", (ctx) => { ctx.provenance_registry["run-00001"].suite_id = "suite-beta"; }],
];
for (const [name, mutate] of REASON_CASES) {
  test(`provenance unavailable: ${name}`, () => {
    const ctx = positiveContext(R1);
    mutate(ctx);
    const r = run(positiveTask(R1), ctx);
    assert.equal(r.report.provenance.verified_by, "author_reported_unavailable");
    assert.equal(r.status, "PARTIAL");
    assert.ok(codes(r).includes("PROVENANCE_UNAVAILABLE"));
  });
}
test("provenance unavailable: artifact runner claim mismatch (run-00016)", () => {
  const run16 = runs["run-00016"];
  const r = run(positiveTask(run16), positiveContext(run16));
  assert.equal(r.report.provenance.verified_by, "author_reported_unavailable");
});
test("provenance unavailable: self-runner via alias (run-00015)", () => {
  const run15 = runs["run-00015"];
  const r = run(positiveTask(run15), positiveContext(run15));
  assert.equal(r.report.provenance.verified_by, "author_reported_unavailable");
});
test("provenance unavailable: no registry entry for cited run", () => {
  const ctx = positiveContext(R1);
  ctx.provenance_registry = {};
  const r = run(positiveTask(R1), ctx);
  assert.equal(r.report.provenance.verified_by, "author_reported_unavailable");
});
test("no run cited: verified_by none, REPORT_READY", () => {
  const task = positiveTask(R1, { request: {} });
  delete task.options.request.run_id;
  delete task.options.request.registry_record_ref;
  delete task.options.request.runner_artifact_ref;
  delete task.fixture_refs.artifact_ref;
  const r = run(task, positiveContext(R1));
  assert.equal(r.report.provenance.verified_by, "none");
  assert.equal(r.status, "REPORT_READY");
});

// ---------------------------------------------------------- PER-005
// Audit slice 2: independent provenance derives only from the entire
// matching identity tuple. The three audit counterexamples flip to
// author_reported_unavailable with named mismatches; positive
// partners (alias-canonicalized implementer; both citations equal —
// the standard positive case above) stay independent.
test("PER-005: declared implementer contradicting the trusted record => unavailable, named mismatch", () => {
  const task = positiveTask(R1, { request: { implementer_principal_id: "scout-01" } });
  const r = run(task, positiveContext(R1));
  assert.equal(r.status, "PARTIAL");
  assert.equal(r.report.provenance.verified_by, "author_reported_unavailable");
  assert.ok(codes(r).includes("PROVENANCE_UNAVAILABLE"));
  assert.ok(r.report.provenance.reasons.some((x) => x.includes("implementer_principal_id 'scout-01'") && x.includes("'builder-01'")),
    `reasons must name the implementer mismatch: ${JSON.stringify(r.report.provenance.reasons)}`);
});
test("PER-005: declared implementer via alias canonicalization stays independent (positive partner)", () => {
  const task = positiveTask(R1, { request: { implementer_principal_id: "scout-alpha" } });
  const r = run(task, positiveContext(R1));
  assert.equal(r.status, "REPORT_READY");
  assert.equal(r.report.provenance.verified_by, "MOCK_INDEPENDENT_RUN");
  assert.equal(r.diagnostics.length, 0);
});
test("PER-005: conflicting run citations => unavailable, named mismatch", () => {
  const task = positiveTask(R1, { request: { run_id: "run-99999" } });
  const r = run(task, positiveContext(R1));
  assert.equal(r.status, "PARTIAL");
  assert.equal(r.report.provenance.verified_by, "author_reported_unavailable");
  assert.ok(codes(r).includes("PROVENANCE_UNAVAILABLE"));
  assert.ok(r.report.provenance.reasons.some((x) => x.includes("run-99999") && x.includes("run-00001")),
    `reasons must name both conflicting citations: ${JSON.stringify(r.report.provenance.reasons)}`);
});
test("PER-005: artifact embedded run_id mismatch with agreeing digests => unavailable (audit case 3)", () => {
  // Mirror of the audit probe: forge the artifact's embedded run_id
  // and register the forged bytes' digest, so every hash agrees and
  // only the semantic identity contradicts the record.
  const baseText = store.sources[R1.sourceKey].revisions[R1.artifactRef.commit].text;
  const forged = JSON.parse(baseText);
  forged.run_id = "run-99999";
  const artifactText = JSON.stringify(forged);
  const commit = sha1hex("commit|run-00001-per005");
  const blob = gitBlob(artifactText);
  const path = "results/scout/run-logs/run-00001-per005.json";
  const aref = { repo: "forge-runner", path, commit, blob, algorithm: "git-sha1", revision: "rev-A" };
  const key = `forge-runner|${path}`;
  const task = positiveTask(R1, { request: { runner_artifact_ref: aref } });
  task.fixture_refs.artifact_ref = aref;
  const ctx = positiveContext(R1, {
    sources: { [key]: { revisions: { [commit]: { text: artifactText, blob, label: "rev-A" } } } },
    readGrants: [{ repo: "forge-runner", path }],
    provenance_registry: { "run-00001": { ...structuredClone(R1.registryEntry), artifact_sha256: sha256hex(artifactText) } },
  });
  const r = run(task, ctx);
  assert.equal(r.status, "PARTIAL");
  assert.equal(r.report.provenance.verified_by, "author_reported_unavailable");
  assert.ok(r.report.provenance.reasons.some((x) => x.includes("run-99999") && x.includes("run-00001")),
    `reasons must name the artifact run mismatch: ${JSON.stringify(r.report.provenance.reasons)}`);
  const cmpRun = r.report.claim_comparisons.find((c) => c.name === "artifact_run_id_vs_cited");
  assert.equal(cmpRun.match, false);
});
test("PER-005: artifact embedded suite_id mismatch with agreeing digests => unavailable", () => {
  const baseText = store.sources[R1.sourceKey].revisions[R1.artifactRef.commit].text;
  const forged = JSON.parse(baseText);
  forged.suite_id = "suite-beta";
  const artifactText = JSON.stringify(forged);
  const commit = sha1hex("commit|run-00001-per005-suite");
  const blob = gitBlob(artifactText);
  const path = "results/scout/run-logs/run-00001-per005-suite.json";
  const aref = { repo: "forge-runner", path, commit, blob, algorithm: "git-sha1", revision: "rev-A" };
  const key = `forge-runner|${path}`;
  const task = positiveTask(R1, { request: { runner_artifact_ref: aref } });
  task.fixture_refs.artifact_ref = aref;
  const ctx = positiveContext(R1, {
    sources: { [key]: { revisions: { [commit]: { text: artifactText, blob, label: "rev-A" } } } },
    readGrants: [{ repo: "forge-runner", path }],
    provenance_registry: { "run-00001": { ...structuredClone(R1.registryEntry), artifact_sha256: sha256hex(artifactText) } },
  });
  const r = run(task, ctx);
  assert.equal(r.status, "PARTIAL");
  assert.equal(r.report.provenance.verified_by, "author_reported_unavailable");
  assert.ok(r.report.provenance.reasons.some((x) => x.includes("suite_id 'suite-beta'") && x.includes("'suite-alpha'")),
    `reasons must name the artifact suite mismatch: ${JSON.stringify(r.report.provenance.reasons)}`);
});
test("PER-005 guarded: declared implementer mismatch flips through runGuarded", async () => {
  const task = positiveTask(R1, { request: { implementer_principal_id: "scout-01" } });
  const r = await runGuarded(JSON.stringify(task), JSON.stringify(positiveContext(R1)));
  assert.equal(r.status, "PARTIAL");
  assert.equal(r.report.provenance.verified_by, "author_reported_unavailable");
});
test("PER-005 guarded: conflicting run citations flip through runGuarded", async () => {
  const task = positiveTask(R1, { request: { run_id: "run-99999" } });
  const r = await runGuarded(JSON.stringify(task), JSON.stringify(positiveContext(R1)));
  assert.equal(r.status, "PARTIAL");
  assert.equal(r.report.provenance.verified_by, "author_reported_unavailable");
});

// ------------------------------------- PER-005 round 2 (residual)
// Independent provenance requires a fully valid, semantically
// consistent parsed artifact. Each counterexample below mutates the
// artifact bytes AND registers the mutated bytes' real digest (task
// refs + registry artifact_sha256), so every hash agrees — only the
// parsed tuple contradicts the task/claim/record.
function mutatedArtifactCase(mutate, tag) {
  const baseText = store.sources[R1.sourceKey].revisions[R1.artifactRef.commit].text;
  const value = mutate(JSON.parse(baseText));
  const artifactText = typeof value === "string" ? value : JSON.stringify(value);
  const commit = sha1hex(`commit|run-00001-${tag}`);
  const blob = gitBlob(artifactText);
  const path = `results/scout/run-logs/run-00001-${tag}.json`;
  const aref = { repo: "forge-runner", path, commit, blob, algorithm: "git-sha1", revision: "rev-A" };
  const key = `forge-runner|${path}`;
  const task = positiveTask(R1, { request: { runner_artifact_ref: aref } });
  task.fixture_refs.artifact_ref = aref;
  const ctx = positiveContext(R1, {
    sources: { [key]: { revisions: { [commit]: { text: artifactText, blob, label: "rev-A" } } } },
    readGrants: [{ repo: "forge-runner", path }],
    provenance_registry: { "run-00001": { ...structuredClone(R1.registryEntry), artifact_sha256: sha256hex(artifactText) } },
  });
  return { task, ctx };
}
const ARTIFACT_COMMAND_MUTATION = (a) => ({ ...a, command: "forge:test --suite suite-beta" });
const ARTIFACT_SUMMARY_MUTATION = (a) => ({ ...a, summary: { ...a.summary, pass_count: 0, fail_count: a.summary.test_count, result_class: "FAIL" } });
const ARTIFACT_UNPARSEABLE_MUTATION = () => "synthetic malformed runner artifact";

test("PER-005 r2: artifact command contradicts task/record with agreeing digests => unavailable, named reason + mismatch retained", () => {
  const { task, ctx } = mutatedArtifactCase(ARTIFACT_COMMAND_MUTATION, "per005r2-cmd");
  const r = run(task, ctx);
  assert.equal(r.status, "PARTIAL");
  assert.equal(r.report.provenance.verified_by, "author_reported_unavailable");
  assert.ok(codes(r).includes("PROVENANCE_UNAVAILABLE"));
  assert.ok(r.report.provenance.reasons.some((x) => x.includes("artifact_command_vs_task")),
    `reasons must name the artifact command comparison: ${JSON.stringify(r.report.provenance.reasons)}`);
  const cmpCmd = r.report.claim_comparisons.find((c) => c.name === "artifact_command_vs_task");
  assert.equal(cmpCmd.match, false);
  assert.equal(r.report.artifact_consistency.state, "inconsistent");
});
test("PER-005 r2: artifact summary contradicts claimed/record summary with agreeing digests => unavailable, named reason + mismatch retained", () => {
  const { task, ctx } = mutatedArtifactCase(ARTIFACT_SUMMARY_MUTATION, "per005r2-sum");
  const r = run(task, ctx);
  assert.equal(r.status, "PARTIAL");
  assert.equal(r.report.provenance.verified_by, "author_reported_unavailable");
  assert.ok(codes(r).includes("PROVENANCE_UNAVAILABLE"));
  assert.ok(r.report.provenance.reasons.some((x) => x.includes("artifact_summary_vs_claimed")),
    `reasons must name the artifact summary comparison: ${JSON.stringify(r.report.provenance.reasons)}`);
  const cmpSum = r.report.claim_comparisons.find((c) => c.name === "artifact_summary_vs_claimed");
  assert.equal(cmpSum.match, false);
  assert.equal(r.report.artifact_consistency.state, "inconsistent");
  // The observed-test-result axis is untouched: the claimed PASS
  // summary still classifies PASS — this is a provenance failure,
  // not a requirement that tests pass to authenticate provenance.
  assert.equal(r.report.test_result.classification, "PASS");
});
test("PER-005 r2: malformed artifact bytes with agreeing digests => unavailable, ARTIFACT_MALFORMED retained", () => {
  const { task, ctx } = mutatedArtifactCase(ARTIFACT_UNPARSEABLE_MUTATION, "per005r2-mal");
  const r = run(task, ctx);
  assert.equal(r.status, "PARTIAL");
  assert.equal(r.report.provenance.verified_by, "author_reported_unavailable");
  assert.ok(codes(r).includes("ARTIFACT_MALFORMED"));
  assert.ok(codes(r).includes("PROVENANCE_UNAVAILABLE"));
  assert.ok(r.report.provenance.reasons.some((x) => x.includes("malformed")),
    `reasons must name the malformed artifact: ${JSON.stringify(r.report.provenance.reasons)}`);
  assert.equal(r.report.artifact_consistency.state, "malformed");
  assert.equal(r.report.provenance.claimed_runner, null);
});
test("PER-005 r2 guarded: artifact command conflict flips through runGuarded", async () => {
  const { task, ctx } = mutatedArtifactCase(ARTIFACT_COMMAND_MUTATION, "per005r2-cmd");
  const r = await runGuarded(JSON.stringify(task), JSON.stringify(ctx));
  assert.equal(r.status, "PARTIAL");
  assert.equal(r.report.provenance.verified_by, "author_reported_unavailable");
  assert.ok(r.report.provenance.reasons.some((x) => x.includes("artifact_command_vs_task")));
});
test("PER-005 r2 guarded: artifact summary conflict flips through runGuarded", async () => {
  const { task, ctx } = mutatedArtifactCase(ARTIFACT_SUMMARY_MUTATION, "per005r2-sum");
  const r = await runGuarded(JSON.stringify(task), JSON.stringify(ctx));
  assert.equal(r.status, "PARTIAL");
  assert.equal(r.report.provenance.verified_by, "author_reported_unavailable");
  assert.ok(r.report.provenance.reasons.some((x) => x.includes("artifact_summary_vs_claimed")));
});
test("PER-005 r2 guarded: malformed artifact flips through runGuarded", async () => {
  const { task, ctx } = mutatedArtifactCase(ARTIFACT_UNPARSEABLE_MUTATION, "per005r2-mal");
  const r = await runGuarded(JSON.stringify(task), JSON.stringify(ctx));
  assert.equal(r.status, "PARTIAL");
  assert.equal(r.report.provenance.verified_by, "author_reported_unavailable");
  assert.ok(codes(r).includes("ARTIFACT_MALFORMED"));
});

// --------------------------------------------------- classification
test("classification precedence: crash + zero tests => FAIL beats BLOCKED", () => {
  const summary = S(0, 0, 0, 0, 0, 0, true, false, true, "suite-alpha", "FAIL");
  const task = positiveTask(R1);
  task.options.request.claimed_summary = summary;
  const r = run(task, positiveContext(R1));
  assert.equal(r.report.test_result.classification, "FAIL");
});
test("classification: zero tests, no failure signal => BLOCKED", () => {
  const task = positiveTask(R1);
  task.options.request.claimed_summary = S(0, 0, 0, 0, 0, 0, false, false, true, "suite-alpha", "BLOCKED");
  const r = run(task, positiveContext(R1));
  assert.equal(r.report.test_result.classification, "BLOCKED");
});
test("classification: partial skips coexist with PASS and are disclosed", () => {
  const run8 = runs["run-00008"];
  const r = run(positiveTask(run8), positiveContext(run8));
  assert.equal(r.report.test_result.classification, "PASS");
  assert.ok(r.report.test_result.limitations.some((l) => l.includes("partial skips disclosed")));
});
test("classification: all-skipped is UNKNOWN, never PASS", () => {
  const run7 = runs["run-00007"];
  const r = run(positiveTask(run7), positiveContext(run7));
  assert.equal(r.report.test_result.classification, "UNKNOWN");
});
test("classification: incomplete summary is UNKNOWN", () => {
  const run9 = runs["run-00009"];
  const r = run(positiveTask(run9), positiveContext(run9));
  assert.equal(r.report.test_result.classification, "UNKNOWN");
});
test("malformed summary => UNVERIFIABLE outcome, not a refusal", () => {
  const task = positiveTask(R1);
  task.options.request.claimed_summary = { ...R1.summary, pass_count: "ten" };
  const r = run(task, positiveContext(R1));
  assert.equal(r.status, "PARTIAL");
  assert.equal(r.report.test_result.classification, "UNVERIFIABLE");
  assert.ok(codes(r).includes("SUMMARY_UNVERIFIABLE"));
});
test("broken arithmetic is a malformed summary (UNVERIFIABLE), not a refusal", () => {
  const task = positiveTask(R1);
  task.options.request.claimed_summary = { ...R1.summary, pass_count: 99 };
  const r = run(task, positiveContext(R1));
  assert.equal(r.report.test_result.classification, "UNVERIFIABLE");
});
test("malformed task control structure => REFUSED INVALID_INPUT", () => {
  const task = positiveTask(R1);
  task.options = "not-an-object";
  const r = run(task, positiveContext(R1));
  assert.equal(r.status, "REFUSED");
  assert.ok(codes(r).includes("INVALID_INPUT"));
});
test("EMPTY input => status EMPTY, classification EMPTY, verified_by none", () => {
  const task = {
    schema_version: "1", task_id: "test-empty", operation: "analyze",
    fixture_refs: {},
    options: { request: {
      claim_id: "claim-empty", implementation_ref: R1.implementationRef,
      implementer_principal_id: "builder-01", command: "",
      expected_suite_id: "suite-alpha",
    } },
  };
  const r = run(task, positiveContext(R1));
  assert.equal(r.status, "EMPTY");
  assert.equal(r.report.test_result.classification, "EMPTY");
  assert.equal(r.report.provenance.verified_by, "none");
});

// ----------------------------------------------------- command gate
test("command gate: all 7 allowlisted descriptors accepted", () => {
  for (const cmd of [
    "forge:test --suite suite-alpha", "forge:test --suite suite-beta", "forge:test --suite suite-gamma",
    "node --test tests/smoke.test.js", "node --test tests/full.test.js",
    "npm test -- --suite suite-alpha", "npm test -- --suite suite-beta",
  ]) {
    const task = positiveTask(R1);
    task.options.request.command = cmd;
    const r = run(task, positiveContext(R1));
    assert.notEqual(r.status, "REFUSED", `descriptor should not refuse: ${cmd}`);
  }
});
test("command gate: prohibited patterns => ACTION_DENIED", () => {
  for (const cmd of ["rm -rf /", "curl https://x.example/s", "powershell -enc AA==", "ssh host", "wget http://x.example"]) {
    const task = positiveTask(R1);
    task.options.request.command = cmd;
    const r = run(task, positiveContext(R1));
    assert.equal(r.status, "REFUSED", cmd);
    assert.ok(codes(r).includes("ACTION_DENIED"), cmd);
  }
});
test("command gate: unknown descriptor => INVALID_INPUT", () => {
  const task = positiveTask(R1);
  task.options.request.command = "make test";
  const r = run(task, positiveContext(R1));
  assert.equal(r.status, "REFUSED");
  assert.ok(codes(r).includes("INVALID_INPUT"));
});
test("prohibited operation => ACTION_DENIED", () => {
  const task = positiveTask(R1);
  task.operation = "execute";
  const r = run(task, positiveContext(R1));
  assert.equal(r.status, "REFUSED");
  assert.ok(codes(r).includes("ACTION_DENIED"));
});
test("caller-supplied verified_by control field => INVALID_INPUT", () => {
  const task = positiveTask(R1);
  task.options.verified_by = "MOCK_INDEPENDENT_RUN";
  const r = run(task, positiveContext(R1));
  assert.equal(r.status, "REFUSED");
  assert.ok(codes(r).includes("INVALID_INPUT"));
});

// ------------------------------------------------------- injection
test("injected artifact: quarantined, provenance unavailable, never verified", () => {
  const run11 = runs["run-00011"];
  const r = run(positiveTask(run11), positiveContext(run11));
  assert.equal(r.status, "PARTIAL");
  assert.ok(codes(r).includes("INSTRUCTION_INJECTION"));
  assert.equal(r.report.provenance.verified_by, "author_reported_unavailable");
  assert.equal(r.quarantined_sources.length, 1);
});
test("artifact refs disagree: not resolved, ARTIFACT_REF_MISMATCH", () => {
  const task = positiveTask(R1);
  task.options.request.runner_artifact_ref = runs["run-00002"].artifactRef;
  const r = run(task, positiveContext(R1));
  assert.ok(codes(r).includes("ARTIFACT_REF_MISMATCH"));
  assert.equal(r.report.provenance.verified_by, "author_reported_unavailable");
});
test("forged markdown artifact (run-00042): malformed + unavailable, never verified", () => {
  const forged = runs["run-00042"];
  const ctx = positiveContext(forged, { provenance_registry: {} });
  const r = run(positiveTask(forged), ctx);
  assert.equal(r.report.provenance.verified_by, "author_reported_unavailable");
  assert.ok(codes(r).includes("ARTIFACT_MALFORMED"));
});

// --------------------------------------------------------- budgets
function derivedPaddedRun(pad) {
  const newId = "run-00001-b02";
  const artifact = { artifact_kind: "synthetic-runner-log", run_id: newId, claimed_runner: R1.runner, suite_id: R1.suite, command: R1.command, summary: R1.summary };
  const artifactText = JSON.stringify(artifact) + " ".repeat(pad);
  const commit = sha1hex(`commit|${newId}|${pad}`);
  const blob = gitBlob(artifactText);
  const path = `results/scout/run-logs/${newId}.json`;
  const key = `forge-runner|${path}`;
  const aref = { repo: "forge-runner", path, commit, blob, algorithm: "git-sha1", revision: "rev-A" };
  const registryEntry = {
    run_id: newId, runner_principal_id: R1.runner, implementer_principal_id: R1.implementer,
    implementation_ref: R1.implementationRef, command_sha256: sha256hex(R1.command),
    artifact_sha256: sha256hex(artifactText), output_sha256: sha256hex(canon(R1.summary)),
    suite_id: R1.suite, verification_method: "MOCK_INDEPENDENT_RUN",
    recorded_at: "2026-10-18T12:00:00Z", revoked: false,
  };
  const task = {
    schema_version: "1", task_id: `battery-${newId}`, operation: "analyze",
    fixture_refs: { artifact_ref: aref },
    options: { request: {
      claim_id: `claim-${newId}`, implementation_ref: R1.implementationRef,
      implementer_principal_id: R1.implementer, command: R1.command, run_id: newId,
      runner_artifact_ref: aref, expected_suite_id: R1.suite,
      claimed_summary: R1.summary, registry_record_ref: { run_id: newId },
    } },
  };
  const ctx = {
    clock: CLOCK,
    sources: { [key]: { revisions: { [commit]: { text: artifactText, blob, label: "rev-A" } } } },
    readGrants: [{ repo: "forge-runner", path }],
    principal: { ...PRINCIPAL }, aliases: { ...ALIASES },
    criteria: { criteria_version: "validation-v1" },
    provenance_registry: { [newId]: registryEntry },
  };
  return { task, ctx };
}
test("INPUT_LIMIT exact boundary (in-process): 262144 aggregate bytes fit", () => {
  const { task, ctx } = derivedPaddedRun(259508);
  const r = run(task, ctx);
  assert.equal(r.status, "REPORT_READY");
});
test("INPUT_LIMIT exact boundary (in-process): 262145 bytes refuse INPUT_LIMIT", () => {
  const { task, ctx } = derivedPaddedRun(259509);
  const r = run(task, ctx);
  assert.equal(r.status, "REFUSED");
  assert.ok(codes(r).includes("INPUT_LIMIT"));
});
// Direct-path object boundary: in-process, task.fixture_refs.artifact_ref
// and request.runner_artifact_ref are the SAME object and dedupe to one
// charge, so the exact fit is 22 registry entries (64 objects) here;
// through the JSON transport (battery B10) the refs deserialise as two
// objects and the fit is 21 entries. Both boundaries are pinned.
test("object budget exact fit (direct): 22 registry entries (64 objects) pass", () => {
  const ctx = positiveContext(R1);
  const registry = {};
  for (let i = 1; i <= 21; i++) {
    const id = `run-fit-${String(i).padStart(2, "0")}`;
    registry[id] = { ...structuredClone(R1.registryEntry), run_id: id };
  }
  registry["run-00001"] = structuredClone(R1.registryEntry);
  ctx.provenance_registry = registry;
  const r = run(positiveTask(R1), ctx);
  assert.equal(r.status, "REPORT_READY");
});
test("object budget (direct): 23 registry entries refuse BUDGET_EXCEEDED", () => {
  const ctx = positiveContext(R1);
  const registry = {};
  for (let i = 1; i <= 22; i++) {
    const id = `run-fit-${String(i).padStart(2, "0")}`;
    registry[id] = { ...structuredClone(R1.registryEntry), run_id: id };
  }
  registry["run-00001"] = structuredClone(R1.registryEntry);
  ctx.provenance_registry = registry;
  const r = run(positiveTask(R1), ctx);
  assert.equal(r.status, "REFUSED");
  assert.ok(codes(r).includes("BUDGET_EXCEEDED"));
});
test("candidate-65 sentinel: over-budget entry never inspected", () => {
  const ctx = positiveContext(R1);
  const registry = { "run-00001": structuredClone(R1.registryEntry) };
  for (let i = 1; i <= 30; i++) {
    const id = `run-pad-${String(i).padStart(2, "0")}`;
    registry[id] = { ...structuredClone(R1.registryEntry), run_id: id };
  }
  registry["run-pad-30"] = { ...registry["run-pad-30"], sentinel_probe: "SHOULD_NEVER_BE_READ" };
  ctx.provenance_registry = registry;
  const r = run(positiveTask(R1), ctx);
  assert.equal(r.status, "REFUSED");
  assert.ok(codes(r).includes("BUDGET_EXCEEDED"));
  assert.ok(!canonicalJson(r).includes("SHOULD_NEVER_BE_READ"));
});
test("PER-008: unknown options.padding with an accessor sentinel on child 79 refuses at candidate 65 without inspecting the sentinel", () => {
  const task = positiveTask(R1);
  task.options.padding = Array.from({ length: 80 }, () => ({ ok: 1 }));
  let getterRan = false;
  let descriptorVisits = 0;
  const sentinel = task.options.padding[79];
  Object.defineProperty(sentinel, "poison", {
    enumerable: true,
    get() { getterRan = true; throw new Error("GETTER_RAN"); },
  });
  const origGOPD = Object.getOwnPropertyDescriptor;
  let r;
  try {
    Object.getOwnPropertyDescriptor = function (o, k) {
      if (o === sentinel) descriptorVisits++;
      return origGOPD.call(this, o, k);
    };
    r = run(task, positiveContext(R1));
    assert.equal(r.status, "REFUSED");
    assert.ok(codes(r).includes("BUDGET_EXCEEDED"), "must refuse at candidate 65 with BUDGET_EXCEEDED");
    assert.ok(!r.diagnostics.some((d) => String(d.reason).includes("padding.79")), "refusal must not name the uninspected sentinel");
  } finally {
    Object.getOwnPropertyDescriptor = origGOPD;
  }
  assert.equal(getterRan, false, "the sentinel getter must never run");
  assert.equal(descriptorVisits, 0, "the sentinel's descriptors must never be visited");
  assert.equal(r.report, null, "no partial domain artifact");
});
test("output boundary: prefill 230 + 26 natural = 256 records fit", () => {
  const ctx = positiveContext(R1, { test_hooks: { prefill_output_records: 230 } });
  const r = run(positiveTask(R1), ctx);
  assert.equal(r.status, "REPORT_READY");
});
test("output boundary: prefill 231 refuses OUTPUT_LIMIT with null report", () => {
  const ctx = positiveContext(R1, { test_hooks: { prefill_output_records: 231 } });
  const r = run(positiveTask(R1), ctx);
  assert.equal(r.status, "REFUSED");
  assert.ok(codes(r).includes("OUTPUT_LIMIT"));
  assert.equal(r.report, null);
});
test("span boundary: prefill 510 + 2 natural = 512 fit", () => {
  const ctx = positiveContext(R1, { test_hooks: { prefill_spans: 510 } });
  const r = run(positiveTask(R1), ctx);
  assert.equal(r.status, "REPORT_READY");
});
test("span boundary: prefill 511 refuses BUDGET_EXCEEDED", () => {
  const ctx = positiveContext(R1, { test_hooks: { prefill_spans: 511 } });
  const r = run(positiveTask(R1), ctx);
  assert.equal(r.status, "REFUSED");
  assert.ok(codes(r).includes("BUDGET_EXCEEDED"));
});
test("depth-33 task graph refuses INVALID_INPUT", () => {
  let nest = {};
  let cur = nest;
  for (let i = 0; i < 33; i++) { cur.a = {}; cur = cur.a; }
  const task = positiveTask(R1);
  task.options.request.claimed_summary = nest;
  const r = run(task, positiveContext(R1));
  assert.equal(r.status, "REFUSED");
  assert.ok(codes(r).includes("INVALID_INPUT"));
});
test("test_hooks out of range refuses INVALID_INPUT", () => {
  const ctx = positiveContext(R1, { test_hooks: { prefill_output_records: 2000 } });
  const r = run(positiveTask(R1), ctx);
  assert.equal(r.status, "REFUSED");
  assert.ok(codes(r).includes("INVALID_INPUT"));
});

// -------------------------------------------- proxies / transport
test("Proxy task: run() refuses INVALID_INPUT with zero trap invocations", () => {
  let traps = 0;
  const proxy = new Proxy({}, { get() { traps += 1; return undefined; }, ownKeys() { traps += 1; return []; }, getOwnPropertyDescriptor() { traps += 1; return undefined; } });
  const r = run(proxy, positiveContext(R1));
  assert.equal(r.status, "REFUSED");
  assert.ok(codes(r).includes("INVALID_INPUT"));
  assert.equal(traps, 0);
});
test("getter trap on task field never fires", () => {
  let fired = 0;
  const task = positiveTask(R1);
  Object.defineProperty(task.options.request, "command", { get() { fired += 1; return "forge:test --suite suite-alpha"; }, enumerable: true, configurable: true });
  const r = run(task, positiveContext(R1));
  assert.equal(r.status, "REFUSED");
  assert.equal(fired, 0);
});
test("guarded transport: non-string input refuses TRANSPORT_REFUSED", async () => {
  const r = await runGuarded(positiveTask(R1), JSON.stringify(positiveContext(R1)));
  assert.equal(r.status, "REFUSED");
  assert.ok(codes(r).includes("TRANSPORT_REFUSED"));
});
test("guarded transport: oversized string refuses TRANSPORT_REFUSED", async () => {
  const r = await runGuarded("x".repeat(262145), "{}");
  assert.equal(r.status, "REFUSED");
  assert.ok(codes(r).includes("TRANSPORT_REFUSED"));
});
test("guarded transport: aggregate over cap refuses before worker creation", async () => {
  const r = await runGuarded("x".repeat(200000), "y".repeat(100000));
  assert.equal(r.status, "REFUSED");
  assert.ok(codes(r).includes("TRANSPORT_REFUSED"));
});

// -------------------------------------------------------- watchdog
test("watchdog: worker that cannot settle in time => EXECUTION_TIMEOUT", async () => {
  // A 1ms watchdog: worker startup + module load cannot complete, so
  // the supervised timer must fire and terminate the worker.
  const r = await runGuarded(JSON.stringify(positiveTask(R1)), JSON.stringify(positiveContext(R1)), 1);
  assert.equal(r.status, "REFUSED");
  assert.ok(codes(r).includes("EXECUTION_TIMEOUT"));
});
test("watchdog fixture worker posts then hangs and is terminable", async () => {
  const { Worker } = await import("node:worker_threads");
  const w = new Worker(join(PROTO, "runner", "timeout-hang-worker.js"));
  const msg = await new Promise((resolve) => w.once("message", resolve));
  assert.equal(msg.result, "hanging");
  const code = await w.terminate();
  assert.equal(typeof code, "number");
});
test("guarded run of the positive case succeeds inside the watchdog", async () => {
  const r = await runGuarded(JSON.stringify(positiveTask(R1)), JSON.stringify(positiveContext(R1)));
  assert.equal(r.status, "REPORT_READY");
  assert.equal(r.report.provenance.verified_by, "MOCK_INDEPENDENT_RUN");
});

// ------------------------------------------- determinism / purity
test("determinism: identical inputs produce byte-identical envelopes", () => {
  const a = run(positiveTask(R1), positiveContext(R1));
  const b = run(positiveTask(R1), positiveContext(R1));
  assert.equal(canonicalJson(a), canonicalJson(b));
});
test("purity: run() does not mutate task or context", () => {
  const task = positiveTask(R1);
  const ctx = positiveContext(R1);
  const before = canonicalJson({ task, ctx });
  run(task, ctx);
  assert.equal(canonicalJson({ task, ctx }), before);
});

// -------------------------------------------------- resolver units
test("git blob id matches the canonical git vector", () => {
  // git hash-object of empty blob
  assert.equal(gitBlobId(Buffer.alloc(0)), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
});
test("verifySpan: UTF-8 multibyte span returns exact byte offsets", () => {
  const bytes = Buffer.from("ab🎉cd suite-alpha ef", "utf8");
  const span = verifySpan(bytes, "suite-alpha", "test");
  assert.equal(span.start_byte, 9);
  assert.equal(span.end_byte, 20);
  assert.equal(span.quoted_text, "suite-alpha");
});
test("verifySpan: missing needle raises SPAN_MISMATCH", () => {
  assert.throws(
    () => verifySpan(Buffer.from("hello", "utf8"), "missing", "test"),
    (e) => e.code === "SPAN_MISMATCH"
  );
});
test("canonicalJson: sorted keys, stable output; non-finite refused", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assert.throws(() => canonicalJson({ x: Number.NaN }));
});

// ------------------------------------------------- mutation tests
// The bootstrap authenticates the manifest root BEFORE opening any
// pinned file and authenticates every pinned byte before spawning a
// launcher. These tests prove a mutated tree cannot execute: exit 3
// and no launcher output / canary write.
function scratchTrust(rootDigest) {
  const dir = mkdtempSync(join(tmpdir(), "validation-trust-"));
  cpSync(join(PROTO, "..", "..", "..", "..", "validation-prototype-trust", "bootstrap.js"), join(dir, "bootstrap.js"));
  writeFileSync(join(dir, "approved-root.txt"), rootDigest + "\n");
  return dir;
}
function currentManifestDigest(treeRoot) {
  const manifest = JSON.parse(readFileSync(join(treeRoot, "corpus", "manifest.json"), "utf8"));
  return sha256hex(JSON.stringify(manifest));
}
test("mutation: one mutated corpus byte => bootstrap exit 3, battery never runs", { skip: !existsSync(join(PROTO, "corpus", "manifest.json")) }, () => {
  const tree = mkdtempSync(join(tmpdir(), "validation-mut-"));
  cpSync(PROTO, tree, { recursive: true });
  const batteryPath = join(tree, "corpus", "battery.json");
  const bytes = readFileSync(batteryPath);
  bytes[100] = bytes[100] === 65 ? 66 : 65;
  writeFileSync(batteryPath, bytes);
  const trust = scratchTrust(currentManifestDigest(PROTO));
  const r = spawnSync(process.execPath, [join(trust, "bootstrap.js"), tree, "battery"], {
    env: { ...process.env, VALIDATION_APPROVED_ROOT: currentManifestDigest(PROTO) },
    encoding: "utf8",
  });
  assert.equal(r.status, 3);
  assert.ok(!String(r.stdout).includes("BATTERY"));
});
test("mutation: canary line appended to the battery entrypoint never executes", { skip: !existsSync(join(PROTO, "corpus", "manifest.json")) }, () => {
  const tree = mkdtempSync(join(tmpdir(), "validation-mut-"));
  cpSync(PROTO, tree, { recursive: true });
  const canary = join(tree, "CANARY-EXECUTED.txt");
  const entry = join(tree, "tests", "run-battery.js");
  writeFileSync(entry, readFileSync(entry, "utf8") + `\nimport { writeFileSync as _wf } from "node:fs"; _wf(${JSON.stringify(canary)}, "executed");\n`);
  const trust = scratchTrust(currentManifestDigest(PROTO));
  const r = spawnSync(process.execPath, [join(trust, "bootstrap.js"), tree, "battery"], {
    env: { ...process.env, VALIDATION_APPROVED_ROOT: currentManifestDigest(PROTO) },
    encoding: "utf8",
  });
  assert.equal(r.status, 3);
  assert.ok(!existsSync(canary), "canary must never be written: authentication precedes execution");
});
test("mutation: tampered package.json (npm scripts) refuses at the bootstrap", { skip: !existsSync(join(PROTO, "corpus", "manifest.json")) }, () => {
  const tree = mkdtempSync(join(tmpdir(), "validation-mut-"));
  cpSync(PROTO, tree, { recursive: true });
  const pkgPath = join(tree, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.scripts = { pretest: "echo should-never-run" };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  // Re-pin ONLY the package.json hash in the copy's manifest so the
  // byte check passes and the scripts gate itself is what refuses;
  // the root is recomputed for the copy's manifest.
  const manifestPath = join(tree, "corpus", "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const f of manifest.files) {
    if (f.path === "package.json") f.sha256 = sha256hex(readFileSync(pkgPath));
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  const digest = sha256hex(JSON.stringify(manifest));
  const trust = scratchTrust(digest);
  const r = spawnSync(process.execPath, [join(trust, "bootstrap.js"), tree, "tests"], {
    env: { ...process.env, VALIDATION_APPROVED_ROOT: digest },
    encoding: "utf8",
  });
  assert.equal(r.status, 3);
  assert.ok(String(r.stderr).includes("npm scripts"));
});

// PER-008 round 2 focused tests (admission primitive, verdict probes,
// exact-64 accounting, round-1 candidate-65 proof). Imported here so
// the official trust-bootstrap "tests" entrypoint runs them.
await import("./per008.test.js");
