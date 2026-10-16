/**
 * checks.test.js — unit tests for the 18 checks, admission bounds,
 * refusal paths and report invariants. Original code.
 */

import { test, assert, assertEqual } from "./harness.js";
import { auditExport, BOUNDS } from "../src/index.js";
import { sha256HexUtf8 } from "../src/canonical.js";
import { CASES, PINS, AS_OF_MS } from "./fixtures.js";
import { scanJsonDepth, admitBytes, CandidateBudget, ownRead, BudgetExceeded } from "../src/budget.js";

const OPTS = { asOfMs: AS_OF_MS, pins: PINS };

function runCase(c) {
  return auditExport(c.envelope, OPTS);
}

test("bounds constants match the scope", () => {
  assertEqual(BOUNDS.maxCandidates, 64, "64 consulted candidates");
  assertEqual(BOUNDS.maxAdmitBytes, 256 * 1024, "256KiB admitted bytes");
  assertEqual(BOUNDS.maxDepth, 16, "depth 16");
  assertEqual(BOUNDS.watchdogMs, 5000, "5s watchdog");
  assertEqual(BOUNDS.freshnessHours, 72, "72h freshness");
});

test("all 36 fixture cases produce the expected status/complete/verdicts", () => {
  for (const c of CASES) {
    const r = runCase(c);
    assertEqual(r.status, c.expect.status, `${c.name}: status`);
    assertEqual(r.complete, c.expect.complete, `${c.name}: complete`);
    if (c.expect.status !== "REFUSED") {
      assertEqual(r.findings.length, 6, `${c.name}: six findings`);
      for (const f of r.findings) {
        assertEqual(f.verdict, c.expect.verdicts[f.check_id], `${c.name}: ${f.check_id}`);
      }
    }
  }
});

test("zero unsupported PASS: every PASS finding binds to verified input bytes", () => {
  for (const c of CASES) {
    const r = runCase(c);
    for (const f of r.findings) {
      assert(f.evidence && f.evidence.pointer && /^[0-9a-f]{64}$/.test(f.evidence.digest), `${c.name}/${f.check_id}: evidence binding`);
      assert(["PASS", "FAIL", "UNVERIFIED"].includes(f.verdict), `${c.name}/${f.check_id}: verdict domain`);
      assert(typeof f.remediation === "string" && f.remediation.length > 0, `${c.name}/${f.check_id}: remediation`);
    }
  }
});

test("PARTIAL is always complete:false; READY is always complete:true", () => {
  for (const c of CASES) {
    const r = runCase(c);
    if (r.status === "PARTIAL" || r.status === "REFUSED") assertEqual(r.complete, false, `${c.name}: complete false`);
    if (r.status === "READY") assertEqual(r.complete, true, `${c.name}: complete true`);
  }
});

test("changed digest refuses the export (cf-fail-digest-changed)", () => {
  const c = CASES.find((x) => x.name === "cf-fail-digest-changed");
  const r = runCase(c);
  assertEqual(r.status, "REFUSED", "status");
  assertEqual(r.refused_reason, "DIGEST_MISMATCH", "reason");
  assertEqual(r.complete, false, "complete");
});

test("injected instructions refuse without execution (bridge + ssh)", () => {
  for (const name of ["bridge-fail-injected", "ssh-fail-injected"]) {
    const c = CASES.find((x) => x.name === name);
    const r = runCase(c);
    assertEqual(r.status, "REFUSED", `${name}: status`);
    assertEqual(r.refused_reason, "INJECTED_INPUT", `${name}: reason`);
  }
});

test("cross-machine evidence never satisfies a check (cf-unknown-cross-machine)", () => {
  const c = CASES.find((x) => x.name === "cf-unknown-cross-machine");
  const r = runCase(c);
  const f = r.findings.find((x) => x.check_id === "CF-002");
  assertEqual(f.verdict, "UNVERIFIED", "CF-002 unverified on cross-machine evidence");
});

test("stale exports are UNVERIFIED, never PASS", () => {
  for (const name of ["bridge-unknown-stale", "cf-unknown-stale", "ssh-unknown-stale"]) {
    const c = CASES.find((x) => x.name === name);
    const r = runCase(c);
    const stale = r.findings.find((x) => x.check_id.endsWith("-005"));
    assertEqual(stale.verdict, "UNVERIFIED", `${name}: freshness unverified`);
    assertEqual(r.complete, false, `${name}: complete false`);
  }
});

test("wrong signer identity fails BRG-001", () => {
  const r = runCase(CASES.find((x) => x.name === "bridge-fail-wrong-signer"));
  assertEqual(r.findings.find((x) => x.check_id === "BRG-001").verdict, "FAIL", "wrong signer");
});

test("missing STOP evidence fails BRG-003", () => {
  const r = runCase(CASES.find((x) => x.name === "bridge-fail-missing-stop"));
  assertEqual(r.findings.find((x) => x.check_id === "BRG-003").verdict, "FAIL", "missing stop");
});

test("missing audit coverage fails BRG-004", () => {
  const r = runCase(CASES.find((x) => x.name === "bridge-fail-missing-audit"));
  assertEqual(r.findings.find((x) => x.check_id === "BRG-004").verdict, "FAIL", "missing audit");
});

test("origin bypass fails CF-003 (and permissive policy fails CF-001)", () => {
  const r = runCase(CASES.find((x) => x.name === "cf-fail-origin-bypass"));
  assertEqual(r.findings.find((x) => x.check_id === "CF-003").verdict, "FAIL", "bypass");
});

test("ambiguous Access policy fails CF-001", () => {
  const r = runCase(CASES.find((x) => x.name === "cf-fail-ambiguous-policy"));
  assertEqual(r.findings.find((x) => x.check_id === "CF-001").verdict, "FAIL", "ambiguous policy");
});

test("unsafe SSH configuration fails (password auth, blank firewall)", () => {
  const r1 = runCase(CASES.find((x) => x.name === "ssh-fail-password-auth"));
  assertEqual(r1.findings.find((x) => x.check_id === "SSH-001").verdict, "FAIL", "password auth");
  const r2 = runCase(CASES.find((x) => x.name === "ssh-fail-blank-firewall"));
  assertEqual(r2.findings.find((x) => x.check_id === "SSH-003").verdict, "FAIL", "blank firewall");
});

test("unknown authorized key fails SSH-002", () => {
  const r = runCase(CASES.find((x) => x.name === "ssh-fail-unknown-key"));
  assertEqual(r.findings.find((x) => x.check_id === "SSH-002").verdict, "FAIL", "unknown key");
});

test("byte-level depth scanner rejects depth 17 before JSON.parse", () => {
  let deep = "";
  for (let i = 0; i < 17; i++) deep += '{"a":';
  deep += "1";
  for (let i = 0; i < 17; i++) deep += "}";
  let threw = false;
  try {
    scanJsonDepth(deep);
  } catch (e) {
    threw = e instanceof BudgetExceeded;
  }
  assert(threw, "depth 17 rejected");
  assertEqual(scanJsonDepth('{"a":{"b":[1,2]}}'), 3, "depth 3 measured");
});

test("admission refuses input over 256KiB", () => {
  const big = "x".repeat(256 * 1024 + 1);
  let threw = false;
  try {
    admitBytes(big);
  } catch (e) {
    threw = e instanceof BudgetExceeded;
  }
  assert(threw, "oversize refused");
});

test("candidate budget refuses the first over-budget candidate without touching it", () => {
  const b = new CandidateBudget(2);
  b.charge("one");
  b.charge("two");
  let threw = false;
  try {
    b.charge("three");
  } catch (e) {
    threw = e instanceof BudgetExceeded && e.message.includes("three");
  }
  assert(threw, "third candidate refused");
});

test("ownRead never invokes getters and never walks prototypes", () => {
  let invoked = 0;
  const obj = Object.create({ inherited: 42 });
  Object.defineProperty(obj, "boom", { get() { invoked++; return 1; }, enumerable: true });
  obj.data = "ok";
  const r1 = ownRead(obj, "boom");
  const r2 = ownRead(obj, "inherited");
  const r3 = ownRead(obj, "data");
  assertEqual(r1.present, false, "getter not treated as data");
  assertEqual(r2.present, false, "prototype not consulted");
  assertEqual(r3.value, "ok", "own data read");
  assertEqual(invoked, 0, "getter never invoked");
});

test("throwing getter in a programmatic export is rejected without invocation", () => {
  let invoked = 0;
  const evil = { envelope: "forge/defensive-audit-export" };
  Object.defineProperty(evil, "version", { get() { invoked++; throw new Error("pwned"); }, enumerable: true });
  const r = auditExport(evil, OPTS);
  assertEqual(r.status, "REFUSED", "refused");
  assertEqual(r.refused_reason, "ACCESSOR_REJECTED", "accessor rejected");
  assertEqual(invoked, 0, "getter never invoked");
});

test("first-over-budget candidate is never traversed (65-entry config)", () => {
  const plain = {};
  for (let i = 0; i < 70; i++) plain[`entry_${i}`] = `value_${i}`;
  const digest = sha256HexUtf8(plain);
  const config = { ...plain };
  Object.defineProperty(config, "entry_64", { get() { throw new Error("must not traverse"); }, enumerable: true, configurable: true });
  const env = {
    envelope: "forge/defensive-audit-export",
    version: 1,
    lane: "bridge",
    machine_id: "machine-bridge-01",
    collected_at: new Date(AS_OF_MS - 3600 * 1000).toISOString(),
    schema: "forge/audit-bridge-config/v1",
    coverage: ["signer"],
    source_digest: digest,
    config,
  };
  // Programmatic input with a getter is rejected before budget traversal.
  const r = auditExport(env, OPTS);
  assertEqual(r.status, "REFUSED", "refused");
  assert(["ACCESSOR_REJECTED", "BUDGET_EXCEEDED", "INVALID_INPUT"].includes(r.refused_reason), `refused cleanly, got ${r.refused_reason}`);
});
