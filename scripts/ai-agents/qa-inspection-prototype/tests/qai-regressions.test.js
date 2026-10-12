/**
 * qai-regressions.test.js — targeted regressions for the QAI-001..QAI-005
 * review findings. Each test reproduces the verdict's exact reproduction
 * (or its named regression) directly against run().
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { run, FixtureResolver, isValidDateString, BudgetedResolver, BudgetExceeded, BUDGET_LIMITS } from "../src/index.js";

const CLOCK = "2026-10-12T00:00:00Z";
const COMMIT = "a".repeat(40);
const REPO = "onyxgolden/marketplace409";
const ENV = "synthetic-ci";
const BUILD = "build-alpha";
const OBS = "obs-1";

function baseTask(over = {}) {
  return {
    task_id: over.task_id ?? "t-qai-1",
    surface: { id: "s1", route: "/rentals", environment: "synthetic" },
    build_pin: { repo: REPO, commit: COMMIT, build_id: BUILD, environment: ENV },
    controls: over.controls ?? [
      {
        control_id: "c1",
        kind: "navigation",
        requested_operation: "report",
        assertion_ids: ["a1"],
        required_modalities: ["automated"],
      },
    ],
    evidence_sources: [],
  };
}

function baseFixtures() {
  return {
    builds: { [BUILD]: { build_id: BUILD, repo: REPO, commit: COMMIT, environment: ENV } },
    evidence: [],
    artifacts: {},
    runs: {},
    grants: {},
    observers: { [OBS]: { trusted: true, reason: "test" } },
  };
}

function mkEvidence(over = {}) {
  return {
    evidence_id: over.evidence_id ?? "ev-1",
    control_id: over.control_id ?? "c1",
    assertion_id: over.assertion_id ?? "a1",
    modality: over.modality ?? "automated",
    build_id: over.build_id ?? BUILD,
    repo: over.repo ?? REPO,
    commit: over.commit ?? COMMIT,
    environment: over.environment ?? ENV,
    run_id: "run_id" in over ? over.run_id : "run-1",
    artifact_ref: "artifact_ref" in over ? over.artifact_ref : null,
    timestamp: over.timestamp ?? "2026-10-11T12:00:00Z",
    expected: "expected" in over ? over.expected : { ok: true },
    observed: "observed" in over ? over.observed : { ok: true },
    outcome: over.outcome ?? "pass",
    fixture_observer_id: over.fixture_observer_id ?? OBS,
  };
}

function addRun(fx, run_id, over = {}) {
  // Default pinned observation: the standard test control/assertion/modality.
  // Tests exercising other triples pass explicit control_id/assertion_id/
  // modality (top-level) or an observations array (QAI-002).
  const { observations, ...rest } = over;
  fx.runs[run_id] = {
    run_id,
    build_id: BUILD,
    repo: REPO,
    commit: COMMIT,
    environment: ENV,
    started_at: "2026-10-11T11:00:00Z",
    observations: observations ?? [{ control_id: "c1", assertion_id: "a1", modality: "automated" }],
    ...rest,
  };
  return fx;
}
function grant(fx, eid, allowed = true) {
  fx.grants[eid] = { allowed, reason: "test" };
  return fx;
}
function ctx(fx) {
  return { clock: CLOCK, resolver: new FixtureResolver(fx) };
}
function codesOf(r) {
  return (r.diagnostics ?? []).map((d) => d.code);
}
function ctrlResult(r, cid) {
  return r.results.find((x) => x.control_id === cid);
}
function perMod(r, cid, modality) {
  return ctrlResult(r, cid).per_modality.find((x) => x.modality === modality);
}

/* ------------------------------------------------------------------ */
/* QAI-001 — aggregation                                              */
/* ------------------------------------------------------------------ */
describe("QAI-001 aggregation", () => {
  it("empty assertion_ids is refused at the schema boundary, never PASS", () => {
    const t = baseTask({
      controls: [
        { control_id: "c1", kind: "navigation", requested_operation: "report", assertion_ids: [], required_modalities: ["automated"] },
      ],
    });
    const r = run(t, ctx(baseFixtures()));
    assert.equal(r.status, "REFUSED");
    assert.ok(codesOf(r).includes("INVALID_ASSERTIONS"));
  });

  it("valid PASS evidence plus wrong-build evidence on the same assertion -> BLOCKED, never PASS", () => {
    const fx = baseFixtures();
    addRun(fx, "run-1");
    const good = mkEvidence({ evidence_id: "ev-good", run_id: "run-1" });
    const bad = mkEvidence({ evidence_id: "ev-wrongbuild", run_id: null, build_id: "build-beta", commit: "b".repeat(40) });
    fx.evidence = [good, bad];
    grant(fx, "ev-good");
    grant(fx, "ev-wrongbuild");
    const r = run(baseTask(), ctx(fx));
    const c = ctrlResult(r, "c1");
    assert.equal(c.result, "BLOCKED");
    assert.ok(c.diagnostic_codes.includes("WRONG_BUILD"), `codes: ${c.diagnostic_codes}`);
    // The usable evidence is retained, not dropped.
    assert.ok(c.evidence_ids.includes("ev-good"));
    assert.equal(r.status, "BLOCKED");
  });

  it("required automated PASS plus verified manual FAIL -> FAIL with contradiction; modalities keep independent states", () => {
    const fx = baseFixtures();
    addRun(fx, "run-auto");
    addRun(fx, "run-manual", { observations: [{ control_id: "c1", assertion_id: "a1", modality: "manual" }] });
    fx.evidence = [
      mkEvidence({ evidence_id: "ev-auto", modality: "automated", run_id: "run-auto" }),
      mkEvidence({ evidence_id: "ev-manual", modality: "manual", run_id: "run-manual", observed: { ok: false }, outcome: "fail" }),
    ];
    grant(fx, "ev-auto");
    grant(fx, "ev-manual");
    const t = baseTask({
      controls: [
        { control_id: "c1", kind: "filter", requested_operation: "report", assertion_ids: ["a1"], required_modalities: ["automated"] },
      ],
    });
    const r = run(t, ctx(fx));
    const c = ctrlResult(r, "c1");
    assert.equal(c.result, "FAIL");
    assert.equal(r.contradictions.length, 1);
    assert.equal(r.contradictions[0].evidence_a, "ev-manual");
    assert.equal(r.contradictions[0].evidence_b, "ev-auto");
    const am = perMod(r, "c1", "automated");
    const mm = perMod(r, "c1", "manual");
    assert.equal(am.result, "PASS");
    assert.deepEqual(am.evidence_ids, ["ev-auto"]);
    assert.equal(mm.result, "FAIL");
    assert.deepEqual(mm.evidence_ids, ["ev-manual"]);
  });

  it("automated FAIL / manual PASS converse -> FAIL; manual stays PASS", () => {
    const fx = baseFixtures();
    addRun(fx, "run-auto");
    addRun(fx, "run-manual", { observations: [{ control_id: "c1", assertion_id: "a1", modality: "manual" }] });
    fx.evidence = [
      mkEvidence({ evidence_id: "ev-auto", modality: "automated", run_id: "run-auto", observed: { ok: false }, outcome: "fail" }),
      mkEvidence({ evidence_id: "ev-manual", modality: "manual", run_id: "run-manual" }),
    ];
    grant(fx, "ev-auto");
    grant(fx, "ev-manual");
    const t = baseTask({
      controls: [
        { control_id: "c1", kind: "filter", requested_operation: "report", assertion_ids: ["a1"], required_modalities: ["automated", "manual"] },
      ],
    });
    const r = run(t, ctx(fx));
    const c = ctrlResult(r, "c1");
    assert.equal(c.result, "FAIL");
    assert.equal(perMod(r, "c1", "automated").result, "FAIL");
    assert.equal(perMod(r, "c1", "manual").result, "PASS");
    assert.deepEqual(perMod(r, "c1", "manual").evidence_ids, ["ev-manual"]);
  });

  it("multiple assertions: one PASS, one BLOCKED -> control BLOCKED", () => {
    const fx = baseFixtures();
    addRun(fx, "run-1");
    fx.evidence = [
      mkEvidence({ evidence_id: "ev-a1", assertion_id: "a1", run_id: "run-1" }),
      mkEvidence({ evidence_id: "ev-a2", assertion_id: "a2", run_id: null, build_id: "build-beta", commit: "b".repeat(40) }),
    ];
    grant(fx, "ev-a1");
    grant(fx, "ev-a2");
    const t = baseTask({
      controls: [
        { control_id: "c1", kind: "navigation", requested_operation: "report", assertion_ids: ["a1", "a2"], required_modalities: ["automated"] },
      ],
    });
    const r = run(t, ctx(fx));
    const c = ctrlResult(r, "c1");
    assert.equal(c.result, "BLOCKED");
    const ars = Object.fromEntries(c.assertion_results.map((a) => [a.assertion_id, a.result]));
    assert.deepEqual(ars, { a1: "PASS", a2: "BLOCKED" });
  });

  it("evidence ordering does not change outcomes (permutation)", () => {
    const mkFx = (order) => {
      const fx = baseFixtures();
      addRun(fx, "run-1");
      addRun(fx, "run-2", { observations: [{ control_id: "c1", assertion_id: "a2", modality: "automated" }] });
      const e1 = mkEvidence({ evidence_id: "ev-1", assertion_id: "a1", run_id: "run-1" });
      const e2 = mkEvidence({ evidence_id: "ev-2", assertion_id: "a2", run_id: "run-2", observed: { ok: false }, outcome: "fail" });
      fx.evidence = order === "fwd" ? [e1, e2] : [e2, e1];
      grant(fx, "ev-1");
      grant(fx, "ev-2");
      return fx;
    };
    const t = baseTask({
      controls: [
        { control_id: "c1", kind: "navigation", requested_operation: "report", assertion_ids: ["a1", "a2"], required_modalities: ["automated"] },
      ],
    });
    const a = run(t, ctx(mkFx("fwd")));
    const b = run(t, ctx(mkFx("rev")));
    assert.equal(ctrlResult(a, "c1").result, "FAIL");
    assert.equal(ctrlResult(b, "c1").result, "FAIL");
    assert.deepEqual(
      ctrlResult(a, "c1").assertion_results.map((x) => [x.assertion_id, x.result]),
      ctrlResult(b, "c1").assertion_results.map((x) => [x.assertion_id, x.result])
    );
  });

  it("one clean modality plus a missing required modality -> UNVERIFIED with MODALITY_GAP", () => {
    const fx = baseFixtures();
    addRun(fx, "run-1");
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: "run-1" })];
    grant(fx, "ev-1");
    const t = baseTask({
      controls: [
        { control_id: "c1", kind: "navigation", requested_operation: "report", assertion_ids: ["a1"], required_modalities: ["automated", "manual"] },
      ],
    });
    const r = run(t, ctx(fx));
    const c = ctrlResult(r, "c1");
    assert.equal(c.result, "UNVERIFIED");
    assert.ok(c.diagnostic_codes.includes("MODALITY_GAP"));
    assert.equal(perMod(r, "c1", "automated").result, "PASS");
    assert.equal(perMod(r, "c1", "manual").result, "UNVERIFIED");
    assert.deepEqual(perMod(r, "c1", "manual").evidence_ids, []);
  });
});

/* ------------------------------------------------------------------ */
/* QAI-002 — evidence pinning                                          */
/* ------------------------------------------------------------------ */
describe("QAI-002 evidence pinning", () => {
  it("run_id null and artifact_ref null -> UNPINNED_OBSERVATION, cannot PASS", () => {
    const fx = baseFixtures();
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: null, artifact_ref: null })];
    grant(fx, "ev-1");
    const r = run(baseTask(), ctx(fx));
    const c = ctrlResult(r, "c1");
    assert.equal(c.result, "UNVERIFIED");
    assert.ok(c.diagnostic_codes.includes("UNPINNED_OBSERVATION"), `codes: ${c.diagnostic_codes}`);
    assert.ok(c.diagnostic_codes.includes("NO_EVIDENCE"));
  });

  it("registered run with the wrong repo -> RUN_MISMATCH, cannot PASS", () => {
    const fx = baseFixtures();
    addRun(fx, "run-1", { repo: "evil/other" });
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: "run-1" })];
    grant(fx, "ev-1");
    const r = run(baseTask(), ctx(fx));
    const c = ctrlResult(r, "c1");
    assert.equal(c.result, "UNVERIFIED");
    assert.ok(c.diagnostic_codes.includes("RUN_MISMATCH"), `codes: ${c.diagnostic_codes}`);
  });

  it("run bound to the wrong control/assertion/modality -> RUN_MISMATCH", () => {
    for (const [label, over] of [
      ["control", { observations: [{ control_id: "other-control", assertion_id: "a1", modality: "automated" }] }],
      ["assertion", { observations: [{ control_id: "c1", assertion_id: "a9", modality: "automated" }] }],
      ["modality", { observations: [{ control_id: "c1", assertion_id: "a1", modality: "manual" }] }],
    ]) {
      const fx = baseFixtures();
      addRun(fx, "run-1", over);
      fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: "run-1" })];
      grant(fx, "ev-1");
      const r = run(baseTask(), ctx(fx));
      const c = ctrlResult(r, "c1");
      assert.equal(c.result, "UNVERIFIED", label);
      assert.ok(c.diagnostic_codes.includes("RUN_MISMATCH"), `${label}: ${c.diagnostic_codes}`);
    }
  });

  it("artifact registered for a different control -> ARTIFACT_MISMATCH", () => {
    const fx = baseFixtures();
    addRun(fx, "run-1");
    const bytes = Buffer.from("shot-bytes-1", "utf8");
    fx.artifacts["shot-1"] = {
      bytes_b64: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      media_type: "image/png",
      byte_length: bytes.length,
      control_id: "other-control",
      assertion_id: "a1",
      modality: "automated",
    };
    const ref = { fixture_id: "shot-1", sha256: fx.artifacts["shot-1"].sha256, media_type: "image/png", byte_length: bytes.length };
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: "run-1", artifact_ref: ref })];
    grant(fx, "ev-1");
    const r = run(baseTask(), ctx(fx));
    const c = ctrlResult(r, "c1");
    assert.equal(c.result, "UNVERIFIED");
    assert.ok(c.diagnostic_codes.includes("ARTIFACT_MISMATCH"), `codes: ${c.diagnostic_codes}`);
  });

  it("declared evidence sources are explicitly refused, never echoed as provenance", () => {
    const fx = baseFixtures();
    addRun(fx, "run-1");
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: "run-1" })];
    grant(fx, "ev-1");
    const t = baseTask();
    t.evidence_sources = [
      { kind: "artifact", fixture_id: "shot-1", sha256: "0".repeat(64), media_type: "image/png", byte_length: 10 },
    ];
    const r = run(t, ctx(fx));
    assert.equal(r.status, "REFUSED");
    assert.ok(codesOf(r).includes("UNSUPPORTED_SOURCE"), `codes: ${codesOf(r)}`);
    assert.deepEqual(r.source_refs, []);
  });

  it("unregistered observer -> OBSERVER_UNTRUSTED, evidence unusable", () => {
    const fx = baseFixtures();
    addRun(fx, "run-1");
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: "run-1", fixture_observer_id: "obs-ghost" })];
    grant(fx, "ev-1");
    const r = run(baseTask(), ctx(fx));
    const c = ctrlResult(r, "c1");
    assert.equal(c.result, "UNVERIFIED");
    assert.ok(c.diagnostic_codes.includes("OBSERVER_UNTRUSTED"), `codes: ${c.diagnostic_codes}`);
  });

  it("fully pinned evidence (run + artifact + trusted observer) still PASSes", () => {
    const fx = baseFixtures();
    addRun(fx, "run-1");
    const bytes = Buffer.from("shot-bytes-1", "utf8");
    fx.artifacts["shot-1"] = {
      bytes_b64: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      media_type: "image/png",
      byte_length: bytes.length,
      control_id: "c1",
      assertion_id: "a1",
      modality: "automated",
    };
    const ref = { fixture_id: "shot-1", sha256: fx.artifacts["shot-1"].sha256, media_type: "image/png", byte_length: bytes.length };
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: "run-1", artifact_ref: ref })];
    grant(fx, "ev-1");
    const r = run(baseTask(), ctx(fx));
    assert.equal(ctrlResult(r, "c1").result, "PASS");
  });
});

/* ------------------------------------------------------------------ */
/* QAI-003 — timestamps                                                */
/* ------------------------------------------------------------------ */
describe("QAI-003 timestamps", () => {
  it("isValidDateString rejects rollover instants", () => {
    assert.equal(isValidDateString("2026-02-30T12:00:00Z"), false);
    assert.equal(isValidDateString("2026-04-31T00:00:00Z"), false);
    assert.equal(isValidDateString("2026-02-29T00:00:00Z"), false); // 2026 not a leap year
    assert.equal(isValidDateString("2026-13-01T00:00:00Z"), false);
    assert.equal(isValidDateString("2026-10-12T24:00:00Z"), false);
    assert.equal(isValidDateString("2026-10-12T12:60:00Z"), false);
  });

  it("isValidDateString accepts real dates and actual leap days", () => {
    assert.equal(isValidDateString("2024-02-29T12:00:00Z"), true);
    assert.equal(isValidDateString("2026-10-11T12:00:00.123Z"), true);
    assert.equal(isValidDateString("2026-10-11"), true);
    assert.equal(isValidDateString("2024-02-29"), true);
    assert.equal(isValidDateString("2026-02-29"), false);
  });

  it("evidence with a nonexistent instant cannot support verification", () => {
    const fx = baseFixtures();
    addRun(fx, "run-1");
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: "run-1", timestamp: "2026-02-30T12:00:00Z" })];
    grant(fx, "ev-1");
    const r = run(baseTask(), ctx(fx));
    const c = ctrlResult(r, "c1");
    assert.equal(c.result, "UNVERIFIED");
    assert.ok(c.diagnostic_codes.includes("EVIDENCE_MALFORMED"), `codes: ${c.diagnostic_codes}`);
    assert.ok(c.diagnostic_codes.includes("NO_EVIDENCE"));
  });

  it("invalid injected clock yields a named INVALID_CLOCK denial", () => {
    for (const bad of ["2026-02-30T12:00:00Z", "not-a-date", "2026-13-01T00:00:00Z"]) {
      const r = run(baseTask(), { clock: bad, resolver: new FixtureResolver(baseFixtures()) });
      assert.equal(r.status, "REFUSED", bad);
      assert.ok(codesOf(r).includes("INVALID_CLOCK"), `${bad}: ${codesOf(r)}`);
    }
  });

  it("actual leap-day evidence still verifies", () => {
    const fx = baseFixtures();
    addRun(fx, "run-1");
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: "run-1", timestamp: "2024-02-29T12:00:00Z" })];
    grant(fx, "ev-1");
    const r = run(baseTask(), ctx(fx));
    assert.equal(ctrlResult(r, "c1").result, "PASS");
  });
});

/* ------------------------------------------------------------------ */
/* QAI-005 — budgets                                                   */
/* ------------------------------------------------------------------ */
describe("QAI-005 budgets", () => {
  it("100 evidence records exhaust the 64-resolution budget -> REFUSED, no partial success", () => {
    const fx = baseFixtures();
    const evidences = [];
    for (let i = 0; i < 100; i++) {
      const eid = `ev-${i}`;
      const rid = `run-${i}`;
      addRun(fx, rid);
      evidences.push(mkEvidence({ evidence_id: eid, run_id: rid }));
      grant(fx, eid);
    }
    fx.evidence = evidences;
    const r = run(baseTask(), ctx(fx));
    assert.equal(r.status, "REFUSED");
    assert.ok(codesOf(r).includes("BUDGET_EXCEEDED"), `codes: ${codesOf(r)}`);
    assert.deepEqual(r.results, []);
  });

  it("object-resolution budget: exactly 64 allowed, 65 refused", () => {
    const inner = { getBuild: () => ({ build_id: "b" }) };
    const mk = () => new BudgetedResolver(inner, { resolutions: 0, spans: 0, resolvedBytes: 0 });
    const ok = mk();
    for (let i = 0; i < 64; i++) ok.getBuild("b");
    const over = mk();
    assert.throws(
      () => {
        for (let i = 0; i < 65; i++) over.getBuild("b");
      },
      (e) => e instanceof BudgetExceeded && e.dimension === "object-resolution"
    );
    assert.equal(BUDGET_LIMITS.maxObjectResolutions, 64);
  });

  it("span-check budget: exactly 512 allowed, 513 refused", () => {
    const rows512 = Array.from({ length: 512 }, (_, i) => ({ evidence_id: `e${i}` }));
    const rows513 = [...rows512, { evidence_id: "e512" }];
    const inner = (rows) => ({ evidenceFor: () => rows });
    const ok = new BudgetedResolver(inner(rows512), { resolutions: 0, spans: 0, resolvedBytes: 0 });
    ok.evidenceFor("c");
    const over = new BudgetedResolver(inner(rows513), { resolutions: 0, spans: 0, resolvedBytes: 0 });
    assert.throws(
      () => over.evidenceFor("c"),
      (e) => e instanceof BudgetExceeded && e.dimension === "span-check"
    );
    assert.equal(BUDGET_LIMITS.maxSpanChecks, 512);
  });

  it("resolved-byte budget: 256KiB allowed, over refused", () => {
    const inner = { getBuild: () => ({ build_id: "b", pad: "x".repeat(256 * 1024) }) };
    const over = new BudgetedResolver(inner, { resolutions: 0, spans: 0, resolvedBytes: 0 });
    assert.throws(
      () => over.getBuild("b"),
      (e) => e instanceof BudgetExceeded && e.dimension === "resolved-input-bytes"
    );
    assert.equal(BUDGET_LIMITS.maxResolvedBytes, 256 * 1024);
  });

  it("output-record budget: 256 records pass, 257 refused", () => {
    const mkTask = (assertionsPerControl) =>
      baseTask({
        task_id: "t-rec",
        controls: Array.from({ length: 4 }, (_, ci) => ({
          control_id: `c${ci}`,
          kind: "navigation",
          requested_operation: "report",
          assertion_ids: Array.from({ length: assertionsPerControl }, (_, ai) => `a${ci}-${ai}`),
          required_modalities: ["automated"],
        })),
      });
    const rOk = run(mkTask(63), ctx(baseFixtures())); // 4 + 252 = 256
    assert.equal(rOk.status, "REPORTED");
    const rOver = run(mkTask(64), ctx(baseFixtures())); // 4 + 256 = 260
    assert.equal(rOver.status, "REFUSED");
    assert.ok(codesOf(rOver).includes("BUDGET_EXCEEDED"), `codes: ${codesOf(rOver)}`);
    assert.equal(BUDGET_LIMITS.maxOutputRecords, 256);
  });

  it("oversized/deep observation payload exhausts the resolved-byte budget", () => {
    const fx = baseFixtures();
    addRun(fx, "run-1");
    let deep = { v: 1 };
    for (let i = 0; i < 24; i++) deep = { nest: deep, pad: "x".repeat(20000) };
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: "run-1", observed: deep })];
    grant(fx, "ev-1");
    const r = run(baseTask(), ctx(fx));
    assert.equal(r.status, "REFUSED");
    assert.ok(codesOf(r).includes("BUDGET_EXCEEDED"), `codes: ${codesOf(r)}`);
  });

  it("final ledger reads count: ledger read exhausts the budget", () => {
    // Per-record costs: valid = 4 resolutions (observer+build+run+grant),
    // unpinned = 3 (observer+build+grant). Pin getBuild + evidenceFor = 2.
    const mkFx = (nValid, nUnpinned) => {
      const fx = baseFixtures();
      const evidences = [];
      for (let i = 0; i < nValid; i++) {
        const eid = `ev-v${i}`;
        const rid = `run-v${i}`;
        addRun(fx, rid);
        evidences.push(mkEvidence({ evidence_id: eid, run_id: rid }));
        grant(fx, eid);
      }
      for (let i = 0; i < nUnpinned; i++) {
        const eid = `ev-u${i}`;
        evidences.push(mkEvidence({ evidence_id: eid, run_id: null, artifact_ref: null }));
        grant(fx, eid);
      }
      fx.evidence = evidences;
      return fx;
    };
    // 2 + 14*4 + 1*3 = 61; ledger evidenceFor -> 62: REPORTED.
    const rOk = run(baseTask(), ctx(mkFx(14, 1)));
    assert.equal(rOk.status, "REPORTED");
    // 2 + 14*4 + 2*3 = 64; ledger evidenceFor -> 65: REFUSED.
    const rOver = run(baseTask(), ctx(mkFx(14, 2)));
    assert.equal(rOver.status, "REFUSED");
    assert.ok(codesOf(rOver).includes("BUDGET_EXCEEDED"), `codes: ${codesOf(rOver)}`);
  });
});

/* ------------------------------------------------------------------ */
/* QAI-002 remaining — mandatory observation binding                   */
/* ------------------------------------------------------------------ */
describe("QAI-002 remaining: mandatory observation binding", () => {
  function mkArtifact(fx, fid, over = {}) {
    const bytes = Buffer.from("shot-bytes-" + fid, "utf8");
    fx.artifacts[fid] = {
      bytes_b64: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      media_type: "image/png",
      byte_length: bytes.length,
      ...over,
    };
    const a = fx.artifacts[fid];
    return { fixture_id: fid, sha256: a.sha256, media_type: a.media_type, byte_length: a.byte_length };
  }

  it("run with no observation metadata -> UNBOUND_OBSERVATION, cannot PASS", () => {
    const fx = baseFixtures();
    addRun(fx, "run-1", { observations: [] });
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: "run-1" })];
    grant(fx, "ev-1");
    const r = run(baseTask(), ctx(fx));
    const c = ctrlResult(r, "c1");
    assert.equal(c.result, "UNVERIFIED");
    assert.ok(c.diagnostic_codes.includes("UNBOUND_OBSERVATION"), `codes: ${c.diagnostic_codes}`);
    assert.ok(c.diagnostic_codes.includes("NO_EVIDENCE"));
  });

  it("partial observation metadata (control_id only) is not a binding -> UNBOUND_OBSERVATION", () => {
    const fx = baseFixtures();
    addRun(fx, "run-1", { observations: [], control_id: "c1" });
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: "run-1" })];
    grant(fx, "ev-1");
    const r = run(baseTask(), ctx(fx));
    const c = ctrlResult(r, "c1");
    assert.equal(c.result, "UNVERIFIED");
    assert.ok(c.diagnostic_codes.includes("UNBOUND_OBSERVATION"), `codes: ${c.diagnostic_codes}`);
  });

  it("generic build-level run reused for a different control -> RUN_MISMATCH, never PASS", () => {
    const fx = baseFixtures();
    // The run is registered and build-bound, but its pinned observations name
    // another control: the mapping is not inferred from the evidence.
    addRun(fx, "run-1", { observations: [{ control_id: "other-control", assertion_id: "a1", modality: "automated" }] });
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: "run-1" })];
    grant(fx, "ev-1");
    const r = run(baseTask(), ctx(fx));
    const c = ctrlResult(r, "c1");
    assert.equal(c.result, "UNVERIFIED");
    assert.ok(c.diagnostic_codes.includes("RUN_MISMATCH"), `codes: ${c.diagnostic_codes}`);
  });

  it("suite-level run with a registered observations list covering the evidence -> PASS", () => {
    const fx = baseFixtures();
    addRun(fx, "run-suite", {
      observations: [
        { control_id: "c1", assertion_id: "a1", modality: "automated" },
        { control_id: "c9", assertion_id: "a1", modality: "manual" },
      ],
    });
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: "run-suite" })];
    grant(fx, "ev-1");
    const r = run(baseTask(), ctx(fx));
    assert.equal(ctrlResult(r, "c1").result, "PASS");
  });

  it("artifact-only evidence without an observation association -> UNBOUND_ARTIFACT", () => {
    const fx = baseFixtures();
    const ref = mkArtifact(fx, "shot-1");
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: null, artifact_ref: ref })];
    grant(fx, "ev-1");
    const r = run(baseTask(), ctx(fx));
    const c = ctrlResult(r, "c1");
    assert.equal(c.result, "UNVERIFIED");
    assert.ok(c.diagnostic_codes.includes("UNBOUND_ARTIFACT"), `codes: ${c.diagnostic_codes}`);
  });

  it("artifact-only evidence with a pinned association -> PASS", () => {
    const fx = baseFixtures();
    const ref = mkArtifact(fx, "shot-1", { control_id: "c1", assertion_id: "a1", modality: "automated" });
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: null, artifact_ref: ref })];
    grant(fx, "ev-1");
    const r = run(baseTask(), ctx(fx));
    assert.equal(ctrlResult(r, "c1").result, "PASS");
  });

  it("artifact association for a different assertion -> ARTIFACT_MISMATCH", () => {
    const fx = baseFixtures();
    const ref = mkArtifact(fx, "shot-1", { control_id: "c1", assertion_id: "a9", modality: "automated" });
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: null, artifact_ref: ref })];
    grant(fx, "ev-1");
    const r = run(baseTask(), ctx(fx));
    const c = ctrlResult(r, "c1");
    assert.equal(c.result, "UNVERIFIED");
    assert.ok(c.diagnostic_codes.includes("ARTIFACT_MISMATCH"), `codes: ${c.diagnostic_codes}`);
  });
});

/* ------------------------------------------------------------------ */
/* QAI-005 remaining — grant/observer payload byte accounting          */
/* ------------------------------------------------------------------ */
describe("QAI-005 remaining: grant/observer payload accounting", () => {
  it("oversized grant payload -> BUDGET_EXCEEDED, REFUSED, no PASS", () => {
    const fx = baseFixtures();
    addRun(fx, "run-1");
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: "run-1" })];
    fx.grants["ev-1"] = { allowed: true, reason: "x".repeat(300000) };
    const r = run(baseTask(), ctx(fx));
    assert.equal(r.status, "REFUSED");
    assert.ok(codesOf(r).includes("BUDGET_EXCEEDED"), `codes: ${codesOf(r)}`);
    assert.deepEqual(r.results, []);
  });

  it("oversized observer payload -> BUDGET_EXCEEDED, REFUSED, no PASS", () => {
    const fx = baseFixtures();
    addRun(fx, "run-1");
    fx.observers[OBS] = { trusted: true, reason: "x".repeat(300000) };
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: "run-1" })];
    grant(fx, "ev-1");
    const r = run(baseTask(), ctx(fx));
    assert.equal(r.status, "REFUSED");
    assert.ok(codesOf(r).includes("BUDGET_EXCEEDED"), `codes: ${codesOf(r)}`);
  });

  it("mixture of small responses exhausting aggregate resolved bytes -> BUDGET_EXCEEDED", () => {
    const fx = baseFixtures();
    addRun(fx, "run-1");
    // ~160KiB evidence payload (counted via evidenceFor, under the cap alone)
    // + ~110KiB grant payload (counted via checkGrant) exceeds the 256KiB
    // resolved-byte cap in aggregate.
    const pad = { pad: "x".repeat(80000) };
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: "run-1", observed: pad, expected: { pad: pad.pad } })];
    fx.grants["ev-1"] = { allowed: true, reason: "y".repeat(110000) };
    const r = run(baseTask(), ctx(fx));
    assert.equal(r.status, "REFUSED");
    assert.ok(codesOf(r).includes("BUDGET_EXCEEDED"), `codes: ${codesOf(r)}`);
  });

  it("ordinary small grant/observer payloads stay green", () => {
    const fx = baseFixtures();
    addRun(fx, "run-1");
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: "run-1" })];
    grant(fx, "ev-1");
    const r = run(baseTask(), ctx(fx));
    assert.equal(r.status, "REPORTED");
    assert.equal(ctrlResult(r, "c1").result, "PASS");
  });

  it("BudgetedResolver counts grant and observer payload bytes directly", () => {
    const big = { allowed: true, reason: "x".repeat(300000) };
    const inner = { checkGrant: () => big, checkObserver: () => ({ trusted: true, reason: "ok" }) };
    const b = new BudgetedResolver(inner, { resolutions: 0, spans: 0, resolvedBytes: 0 });
    assert.throws(
      () => b.checkGrant("ev-1"),
      (e) => e instanceof BudgetExceeded && e.dimension === "resolved-input-bytes"
    );
    const b2 = new BudgetedResolver(
      { checkGrant: () => ({ allowed: true, reason: "ok" }), checkObserver: () => ({ trusted: true, reason: "ok" }) },
      { resolutions: 0, spans: 0, resolvedBytes: 0 }
    );
    assert.deepEqual(b2.checkGrant("ev-1"), { allowed: true, reason: "ok" });
    assert.deepEqual(b2.checkObserver("obs-1"), { trusted: true, reason: "ok" });
    assert.equal(BUDGET_LIMITS.maxResolvedBytes, 256 * 1024);
  });
});

/* ------------------------------------------------------------------ */
/* QAI-005 round 3 — artifact association metadata byte accounting      */
/* ------------------------------------------------------------------ */
describe("QAI-005 round 3: artifact association metadata byte accounting", () => {
  function mkArtifactWithObservations(fx, fid, observations) {
    const bytes = Buffer.from("shot-bytes-" + fid, "utf8");
    fx.artifacts[fid] = {
      bytes_b64: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      media_type: "image/png",
      byte_length: bytes.length,
      observations,
    };
    const a = fx.artifacts[fid];
    return { fixture_id: fid, sha256: a.sha256, media_type: a.media_type, byte_length: a.byte_length };
  }

  it("380KB observations association list -> BUDGET_EXCEEDED, REFUSED, no PASS", () => {
    // The verdict's probe: a positive artifact-backed case whose registered
    // observations list (5,000+ valid covering triples, no redundant
    // top-level association) exceeds the 256-KiB resolved-input cap. The
    // association metadata is resolved input and must be counted.
    const fx = baseFixtures();
    const observations = Array.from({ length: 6230 }, () => ({
      control_id: "c1",
      assertion_id: "a1",
      modality: "automated",
    }));
    const obsBytes = Buffer.byteLength(JSON.stringify(observations), "utf8");
    assert.ok(obsBytes > 256 * 1024, `test setup: observations list must exceed the cap, got ${obsBytes}`);
    const ref = mkArtifactWithObservations(fx, "shot-big", observations);
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: null, artifact_ref: ref })];
    grant(fx, "ev-1");
    const r = run(baseTask(), ctx(fx));
    assert.equal(r.status, "REFUSED");
    assert.ok(codesOf(r).includes("BUDGET_EXCEEDED"), `codes: ${codesOf(r)}`);
    assert.deepEqual(r.results, []);
  });

  it("artifact metadata: exactly 256KiB allowed, 256KiB+1 refused", () => {
    const base = { sha256: "s".repeat(64), media_type: "image/png", byte_length: 0 };
    const baseLen = Buffer.byteLength(JSON.stringify(base), "utf8");
    // '"pad":"xxx"' contributes ',"pad":"' (8 chars) + pad + closing quote
    // (1 char); size the pad so the counted metadata is exactly the cap,
    // then one byte over.
    const padLen = BUDGET_LIMITS.maxResolvedBytes - baseLen - 9;
    assert.ok(padLen > 0, "test setup: pad length must be positive");
    const inner = (extra) => ({
      resolveArtifact: () => ({
        bytes: Buffer.alloc(0),
        ...base,
        pad: "x".repeat(padLen + extra),
      }),
    });
    const mk = (extra) => new BudgetedResolver(inner(extra), { resolutions: 0, spans: 0, resolvedBytes: 0 });
    mk(0).resolveArtifact("a"); // exactly at the cap: allowed
    assert.throws(
      () => mk(1).resolveArtifact("a"),
      (e) => e instanceof BudgetExceeded && e.dimension === "resolved-input-bytes"
    );
    assert.equal(BUDGET_LIMITS.maxResolvedBytes, 256 * 1024);
  });

  it("artifact metadata accumulates across artifacts: second over-cap read refused", () => {
    const mkInner = () => ({
      resolveArtifact: () => ({
        bytes: Buffer.alloc(10),
        byte_length: 10,
        sha256: "s".repeat(64),
        media_type: "image/png",
        observations: [{ control_id: "c1", assertion_id: "a1", modality: "automated", pad: "x".repeat(150000) }],
      }),
    });
    const b = new BudgetedResolver(mkInner(), { resolutions: 0, spans: 0, resolvedBytes: 0 });
    b.resolveArtifact("a1"); // ~150KiB of metadata: under the cap
    assert.throws(
      () => b.resolveArtifact("a2"), // aggregate ~300KiB: over the cap
      (e) => e instanceof BudgetExceeded && e.dimension === "resolved-input-bytes"
    );
  });

  it("raw artifact bytes counted at actual length, metadata counted canonically", () => {
    // The Buffer's JSON form must never substitute for its byte length:
    // a 3-byte artifact counts 3 bytes, not the ~400 chars of its JSON.
    const inner = {
      resolveArtifact: () => ({
        bytes: Buffer.from("abc", "utf8"),
        byte_length: 3,
        sha256: "s".repeat(64),
        media_type: "image/png",
      }),
    };
    const b = new BudgetedResolver(inner, { resolutions: 0, spans: 0, resolvedBytes: 10 });
    b.resolveArtifact("a");
    const metaLen = Buffer.byteLength(
      JSON.stringify({ sha256: "s".repeat(64), media_type: "image/png", byte_length: 3 }),
      "utf8"
    );
    // 10 (prior) + 3 (raw bytes) + canonical metadata bytes.
    assert.equal(b.budget.resolvedBytes, 13 + metaLen);
  });

  it("ordinary small artifact-positive case stays green", () => {
    const fx = baseFixtures();
    const ref = mkArtifactWithObservations(fx, "shot-1", [
      { control_id: "c1", assertion_id: "a1", modality: "automated" },
    ]);
    fx.evidence = [mkEvidence({ evidence_id: "ev-1", run_id: null, artifact_ref: ref })];
    grant(fx, "ev-1");
    const r = run(baseTask(), ctx(fx));
    assert.equal(r.status, "REPORTED");
    assert.equal(ctrlResult(r, "c1").result, "PASS");
  });
});
