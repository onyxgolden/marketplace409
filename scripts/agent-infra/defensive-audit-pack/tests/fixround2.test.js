/**
 * fixround2.test.js — round-2 regression tests for DAP-001..005.
 * Original code. Pure Node 24 ESM.
 */

import { test, assert, assertEqual } from "./harness.js";
import { auditExport, BOUNDS } from "../src/index.js";
import { auditExportHosted } from "../src/host.js";
import { sha256HexUtf8, canonicalJson } from "../src/canonical.js";
import {
  admitBytes,
  scanJsonDepth,
  admitDocument,
  CandidateBudget,
  BudgetExceeded,
  SchemaError,
} from "../src/budget.js";
import { parseTimestampStrict } from "../src/schemas.js";
import { parseCidr, isDenyAll, cidrContains } from "../src/checks.js";
import { CASES, PINS, AS_OF_MS, mutatedEnvelope } from "./fixtures.js";

const OPTS = { asOfMs: AS_OF_MS, pins: PINS };
const HOUR = 3600 * 1000;

function verdictsOf(report) {
  const out = {};
  for (const f of report.findings) out[f.check_id] = f.verdict;
  return out;
}

/* ================= DAP-001: unified bounded admission ================= */

test("DAP-001: oversize unknown field refused identically on object and string paths", () => {
  const big = "x".repeat(300000);
  const build = () => {
    const env = mutatedEnvelope("bridge-pass-full", (c) => {
      c.ignored = big;
    });
    return env;
  };
  const rObj = auditExport(build(), OPTS);
  assertEqual(rObj.status, "REFUSED", "object path refused");
  assertEqual(rObj.refused_reason, "BUDGET_EXCEEDED", "object path byte cap");
  assertEqual(rObj.complete, false, "object path incomplete");
  const rStr = auditExport(JSON.stringify(build()), OPTS);
  assertEqual(rStr.status, "REFUSED", "string path refused");
  assertEqual(rStr.refused_reason, "BUDGET_EXCEEDED", "string path byte cap");
});

test("DAP-001: 20-deep nested object refused on both entrypoints (depth 16 cap)", () => {
  const build = () =>
    mutatedEnvelope("bridge-pass-full", (c) => {
      let cur = (c.extra = {});
      for (let i = 0; i < 20; i++) {
        cur.nested = {};
        cur = cur.nested;
      }
    });
  for (const input of [build(), JSON.stringify(build())]) {
    const r = auditExport(input, OPTS);
    assertEqual(r.status, "REFUSED", "deep input refused");
    assertEqual(r.refused_reason, "BUDGET_EXCEEDED", "depth cap");
  }
});

test("DAP-001: array accessor rejected with zero invocation (no map-first read)", () => {
  let invoked = 0;
  const base = CASES.find((x) => x.name === "bridge-pass-full");
  const config = structuredClone(base.envelope.config);
  const digest = sha256HexUtf8(config);
  Object.defineProperty(config.commands, "0", {
    get() {
      invoked++;
      return "C:\\Tools\\evil.exe";
    },
    enumerable: true,
    configurable: true,
  });
  const env = { ...structuredClone(base.envelope), config, source_digest: digest };
  const r = auditExport(env, OPTS);
  assertEqual(r.status, "REFUSED", "refused");
  assertEqual(r.refused_reason, "ACCESSOR_REJECTED", "accessor rejected");
  assertEqual(invoked, 0, "getter never invoked");
});

test("DAP-001: 65th candidate never touched — throwing getter past the cap is not invoked", () => {
  let invoked = 0;
  const g = {};
  for (let i = 0; i < 64; i++) g[`k${i}`] = i;
  Object.defineProperty(g, "evil", {
    get() {
      invoked++;
      throw new Error("must not traverse");
    },
    enumerable: true,
  });
  let threw = null;
  try {
    admitDocument(g, new CandidateBudget(64), { label: "test" });
  } catch (e) {
    threw = e;
  }
  assert(threw instanceof BudgetExceeded, "65th candidate refused");
  assertEqual(invoked, 0, "over-budget getter never invoked");
});

test("DAP-001: exact cap admits 64, +1 refuses", () => {
  const obj64 = {};
  for (let i = 0; i < 64; i++) obj64[`k${i}`] = i;
  admitDocument(obj64, new CandidateBudget(64), { label: "test" });
  const obj65 = { ...obj64, k64: 64 };
  let threw = null;
  try {
    admitDocument(obj65, new CandidateBudget(64), { label: "test" });
  } catch (e) {
    threw = e;
  }
  assert(threw instanceof BudgetExceeded, "+1 over cap refused");
});

test("DAP-001: unknown nested config field is refused, never silently ignored", () => {
  const env = mutatedEnvelope("bridge-pass-full", (c) => {
    c.signer.note = "hello";
  });
  const r = auditExport(env, OPTS);
  assertEqual(r.status, "REFUSED", "refused");
  assertEqual(r.refused_reason, "INVALID_INPUT", "closed schema");
});

test("DAP-001: pins share the aggregate admission budget with the document (shared counter)", () => {
  const fatPins = {};
  for (let i = 0; i < 70; i++) fatPins[`pin_${i}`] = `v${i}`;
  const c = CASES.find((x) => x.name === "bridge-pass-full");
  const r = auditExport(c.envelope, { asOfMs: AS_OF_MS, pins: fatPins });
  assertEqual(r.status, "REFUSED", "fat pins refused");
  assertEqual(r.refused_reason, "BUDGET_EXCEEDED", "shared pins budget");
  // A doc plus a pin set that together exceed 64 consulted candidates refuse
  // even when each fits alone: one aggregate cap per invocation.
  const smallPins = {};
  for (let i = 0; i < 50; i++) smallPins[`pin_${i}`] = `v${i}`;
  const r2 = auditExport(c.envelope, { asOfMs: AS_OF_MS, pins: smallPins });
  assertEqual(r2.status, "REFUSED", "doc+pins over 64 refused");
  assertEqual(r2.refused_reason, "BUDGET_EXCEEDED", "aggregate candidate cap");
});

/* ================= DAP-002: no escaping budget failures; real watchdog ================= */

test("DAP-002: 70-field config returns REFUSED/BUDGET_EXCEEDED, never throws", () => {
  const env = mutatedEnvelope("bridge-pass-full", (c) => {
    for (let i = 0; i < 70; i++) c[`extra_${i}`] = `v${i}`;
  });
  let r = null;
  let threw = null;
  try {
    r = auditExport(env, OPTS);
  } catch (e) {
    threw = e;
  }
  assertEqual(threw, null, "no throw escapes the public API");
  assertEqual(r.status, "REFUSED", "refused");
  assertEqual(r.refused_reason, "BUDGET_EXCEEDED", "named refusal");
  assertEqual(r.complete, false, "incomplete");
  assertEqual(r.findings.length, 0, "no domain findings");
});

test("DAP-002: 70-command allowlist refuses inside the check loop without throwing", () => {
  const cmds = [];
  for (let i = 0; i < 70; i++) cmds.push(`C:\\Tools\\cmd${i}.exe`);
  const env = mutatedEnvelope("bridge-pass-full", (c) => {
    c.commands = cmds;
  });
  let threw = null;
  let r = null;
  try {
    r = auditExport(env, OPTS);
  } catch (e) {
    threw = e;
  }
  assertEqual(threw, null, "no throw escapes");
  assertEqual(r.status, "REFUSED", "refused");
  assertEqual(r.refused_reason, "BUDGET_EXCEEDED", "named refusal");
});

test("DAP-002: BRG-002 charges each array entry before reading it", async () => {
  const { LANE_CHECKS } = await import("../src/checks.js");
  const { Watchdog } = await import("../src/budget.js");
  const cmds = [];
  for (let i = 0; i < 10; i++) cmds.push(`C:\\Tools\\cmd${i}.exe`);
  const mkCtx = (limit) => ({
    config: { commands: cmds },
    machineId: "m",
    collectedAt: new Date(AS_OF_MS).toISOString(),
    collectedAtMs: AS_OF_MS,
    asOfMs: AS_OF_MS,
    pins: PINS,
    pinsDigest: "0".repeat(64),
    budget: new CandidateBudget(limit),
    watchdog: new Watchdog(5000, () => AS_OF_MS),
    coverage: [],
    sourceDigest: "0".repeat(64),
  });
  const check = LANE_CHECKS.bridge.find((c) => c.id === "BRG-002");
  // 1 (commands) + 10 indices = 11 charges needed; budget 6 dies on index 5.
  let threw = null;
  try {
    check.run(mkCtx(6));
  } catch (e) {
    threw = e;
  }
  assert(threw instanceof BudgetExceeded, "budget enforced inside the loop");
  assert(threw.message.includes("BRG-002:commands[5]"), `per-entry label, got: ${threw && threw.message}`);
  // Full budget passes.
  const f = check.run(mkCtx(64));
  assertEqual(f.verdict, "PASS", "adequate budget passes");
});

test("DAP-002: hanging worker is terminated by the hard watchdog with no domain report", async () => {
  const hanging = () => {
    const handlers = {};
    return {
      postMessage() {},
      once(ev, fn) {
        handlers[ev] = fn;
      },
      async terminate() {
        return 0;
      },
    };
  };
  const c = CASES.find((x) => x.name === "bridge-pass-full");
  const start = Date.now();
  const r = await auditExportHosted(JSON.stringify(c.envelope), OPTS, { timeoutMs: 50, spawnWorker: hanging });
  const elapsed = Date.now() - start;
  assertEqual(r.status, "REFUSED", "refused");
  assertEqual(r.refused_reason, "WATCHDOG_EXCEEDED", "hard watchdog reason");
  assertEqual(r.findings.length, 0, "no domain findings");
  assert(elapsed < 2000, `terminated promptly, took ${elapsed}ms`);
});

test("DAP-002: hosted happy path runs the real worker to READY", async () => {
  const c = CASES.find((x) => x.name === "bridge-pass-full");
  const r = await auditExportHosted(JSON.stringify(c.envelope), OPTS);
  assertEqual(r.status, "READY", `hosted audit ready, got ${r.status}/${r.refused_reason}`);
  assertEqual(r.findings.length, 6, "six findings");
});

test("DAP-002: hosted object input with accessor is refused in the parent, getter never invoked", async () => {
  let invoked = 0;
  const c = CASES.find((x) => x.name === "bridge-pass-full");
  const env = structuredClone(c.envelope);
  Object.defineProperty(env.config.commands, "0", {
    get() {
      invoked++;
      return "x";
    },
    enumerable: true,
    configurable: true,
  });
  const r = await auditExportHosted(env, OPTS);
  assertEqual(r.status, "REFUSED", "refused");
  assertEqual(r.refused_reason, "ACCESSOR_REJECTED", "accessor rejected");
  assertEqual(invoked, 0, "getter never invoked");
});

/* ================= DAP-003: evidence binds actual values ================= */

test("DAP-003: BRG-002 evidence re-derives from the original command bytes", () => {
  const c = CASES.find((x) => x.name === "bridge-pass-full");
  const r = auditExport(c.envelope, OPTS);
  const f = r.findings.find((x) => x.check_id === "BRG-002");
  assertEqual(f.evidence.pointer, "$.config.commands", "pointer");
  assertEqual(f.evidence.value_digest, sha256HexUtf8(c.envelope.config.commands), "digest of actual admitted value");
});

test("DAP-003: same-count command mutation changes the evidence digest", () => {
  const envA = mutatedEnvelope("bridge-pass-full", (cfg) => {
    cfg.commands = ["alpha", "beta"];
  });
  const envB = mutatedEnvelope("bridge-pass-full", (cfg) => {
    cfg.commands = ["gamma", "delta"];
  });
  const dA = auditExport(envA, OPTS).findings.find((x) => x.check_id === "BRG-002").evidence.value_digest;
  const dB = auditExport(envB, OPTS).findings.find((x) => x.check_id === "BRG-002").evidence.value_digest;
  assert(dA !== dB, "same-count mutation changes digest (no more '2 explicit commands' prose hash)");
});

test("DAP-003: metadata mutation changes the export identity and report digest", () => {
  const envA = mutatedEnvelope("bridge-pass-full", () => {});
  const envB = structuredClone(envA);
  envB.machine_id = "machine-bridge-99";
  const rA = auditExport(envA, OPTS);
  const rB = auditExport(envB, OPTS);
  assert(rA.digest !== rB.digest, "report digest binds machine identity");
  assertEqual(rB.export_identity.machine_id, "machine-bridge-99", "identity carries machine");
});

test("DAP-003: predicate dependency mutation changes that finding's digest", () => {
  const envA = mutatedEnvelope("ssh-pass-full", () => {});
  const envB = mutatedEnvelope("ssh-pass-full", (c) => {
    c.firewall.remote_address = "10.1.2.0/24";
  });
  const dA = auditExport(envA, OPTS).findings.find((x) => x.check_id === "SSH-003").evidence.value_digest;
  const dB = auditExport(envB, OPTS).findings.find((x) => x.check_id === "SSH-003").evidence.value_digest;
  assert(dA !== dB, "firewall scope mutation changes SSH-003 digest");
  assertEqual(auditExport(envB, OPTS).findings.find((x) => x.check_id === "SSH-003").verdict, "PASS", "still a legitimate PASS");
});

test("DAP-003: findings bind the exact pin set consulted", () => {
  const c = CASES.find((x) => x.name === "bridge-pass-full");
  const rPins = auditExport(c.envelope, OPTS);
  const forged = { ...PINS, signer_fingerprint: "SHA256:synthetic-forged-signer" };
  const rForged = auditExport(c.envelope, { asOfMs: AS_OF_MS, pins: forged });
  assert(rPins.export_identity.pins_digest !== rForged.export_identity.pins_digest, "pin set change binds");
  assertEqual(rForged.findings.find((x) => x.check_id === "BRG-001").verdict, "FAIL", "forged pin fails");
  assertEqual(rForged.export_identity.pins_digest, rForged.findings[0].evidence.pins_digest, "per-finding pin binding");
});

/* ================= DAP-004: closed predicates, no unsupported PASS ================= */

test("DAP-004: deleted password_auth is not key-only PASS", () => {
  const env = mutatedEnvelope("ssh-pass-full", (c) => {
    delete c.auth.password_auth;
  });
  const v = verdictsOf(auditExport(env, OPTS));
  assertEqual(v["SSH-001"], "UNVERIFIED", "missing password_auth is UNVERIFIED, not PASS");
});

test("DAP-004: deleted service binary is not PASS when the pin is retained", () => {
  const env = mutatedEnvelope("ssh-pass-full", (c) => {
    delete c.service.binary;
  });
  const v = verdictsOf(auditExport(env, OPTS));
  assertEqual(v["SSH-004"], "UNVERIFIED", "missing binary is UNVERIFIED, not PASS");
});

test("DAP-004: IPv6 deny-all scope is FAIL, not restricted", () => {
  const env = mutatedEnvelope("ssh-pass-full", (c) => {
    c.firewall.remote_address = "::/0";
  });
  const v = verdictsOf(auditExport(env, OPTS));
  assertEqual(v["SSH-003"], "FAIL", "::/0 is FAIL");
});

test("DAP-004: unparsed ANY scope is FAIL, not restricted", () => {
  const env = mutatedEnvelope("ssh-pass-full", (c) => {
    c.firewall.remote_address = "ANY";
  });
  const v = verdictsOf(auditExport(env, OPTS));
  assertEqual(v["SSH-003"], "FAIL", "ANY is FAIL");
});

test("DAP-004: irrelevant audit coverage with empty export coverage is not clean", () => {
  const env = mutatedEnvelope("bridge-pass-full", (c) => {
    c.audit.coverage = ["irrelevant"];
  });
  env.coverage = [];
  const v = verdictsOf(auditExport(env, OPTS));
  assertEqual(v["BRG-004"], "FAIL", "insufficient declared classes FAIL");
});

test("DAP-004: unbound STOP evidence is not same-machine PASS", () => {
  const env = mutatedEnvelope("bridge-pass-full", (c) => {
    delete c.stop.machine_id;
  });
  const v = verdictsOf(auditExport(env, OPTS));
  assertEqual(v["BRG-003"], "UNVERIFIED", "unbound STOP is UNVERIFIED, not PASS");
});

test("DAP-004: allow-everyone rules FAIL and attacker host never passes", () => {
  const env = mutatedEnvelope("cf-pass-full", (c) => {
    c.access.rules = ["allow everyone"];
    c.origin.expected_host = "attacker.invalid";
  });
  const v = verdictsOf(auditExport(env, OPTS));
  assertEqual(v["CF-001"], "FAIL", "allow-everyone rule FAILs");
  assertEqual(v["CF-002"], "FAIL", "attacker host FAILs");
});

test("DAP-004: allowlist digest must bind the pinned allowlist", () => {
  const env = mutatedEnvelope("bridge-pass-full", (c) => {
    c.signer.allowlist_digest = "b".repeat(64);
  });
  const v = verdictsOf(auditExport(env, OPTS));
  assertEqual(v["BRG-001"], "FAIL", "unbound allowlist digest FAILs");
});

test("DAP-004: scope outside declared LAN ranges is FAIL", () => {
  const env = mutatedEnvelope("ssh-pass-full", (c) => {
    c.firewall.remote_address = "172.16.9.0/24";
  });
  const v = verdictsOf(auditExport(env, OPTS));
  assertEqual(v["SSH-003"], "FAIL", "non-LAN scope FAILs");
});

test("DAP-004: CIDR unit semantics", () => {
  const lan = parseCidr("192.168.1.0/24");
  assert(cidrContains(lan, parseCidr("192.168.1.0/24")), "self contains");
  assert(cidrContains(lan, parseCidr("192.168.1.128/25")), "subnet contains");
  assert(!cidrContains(lan, parseCidr("192.168.2.0/24")), "sibling rejected");
  assert(!cidrContains(lan, parseCidr("192.168.0.0/16")), "supernet rejected");
  assert(isDenyAll(parseCidr("0.0.0.0/0")), "v4 deny-all");
  assert(isDenyAll(parseCidr("::/0")), "v6 deny-all");
  assert(!isDenyAll(parseCidr("::1/128")), "loopback not deny-all");
  assertEqual(parseCidr("ANY"), null, "ANY invalid");
  assertEqual(parseCidr("999.1.1.1/24"), null, "bad octet invalid");
  assertEqual(parseCidr("192.168.1.0/33"), null, "bad prefix invalid");
});

/* ================= DAP-005: missing/stale -> UNVERIFIED; exact timestamps ================= */

test("DAP-005: impossible date is refused at admission, not normalized", () => {
  const env = JSON.parse(JSON.stringify(CASES.find((x) => x.name === "bridge-pass-full").envelope));
  env.collected_at = "2026-02-30T00:00:00Z";
  const r = auditExport(env, OPTS);
  assertEqual(r.status, "REFUSED", "refused");
  assertEqual(r.refused_reason, "INVALID_INPUT", "exact timestamp grammar");
});

test("DAP-005: date-only and missing-timezone strings are refused", () => {
  for (const bad of ["2026-10-16", "2026-10-16T12:00:00", "yesterday", "2026-13-01T00:00:00Z", "2026-10-16T25:00:00Z"]) {
    const env = JSON.parse(JSON.stringify(CASES.find((x) => x.name === "bridge-pass-full").envelope));
    env.collected_at = bad;
    const r = auditExport(env, OPTS);
    assertEqual(r.status, "REFUSED", `refused: ${bad}`);
    assertEqual(r.refused_reason, "INVALID_INPUT", `grammar: ${bad}`);
  }
  // Explicit offsets are accepted when the calendar is real.
  assertEqual(typeof parseTimestampStrict("2026-10-16T12:00:00-05:00"), "number", "offset accepted");
  assertEqual(typeof parseTimestampStrict("2026-10-16T12:00:00.123Z"), "number", "fractional accepted");
});

test("DAP-005: future collection is UNVERIFIED, not PASS", () => {
  const env = mutatedEnvelope("bridge-pass-full", () => {}, AS_OF_MS + HOUR);
  const v = verdictsOf(auditExport(env, OPTS));
  assertEqual(v["BRG-005"], "UNVERIFIED", "future is UNVERIFIED");
});

test("DAP-005: 72h exact is PASS, 72h+1ms is UNVERIFIED", () => {
  const exact = mutatedEnvelope("bridge-pass-full", () => {}, AS_OF_MS - 72 * HOUR);
  const plus1 = mutatedEnvelope("bridge-pass-full", () => {}, AS_OF_MS - 72 * HOUR - 1);
  assertEqual(verdictsOf(auditExport(exact, OPTS))["BRG-005"], "PASS", "72h exact PASS");
  assertEqual(verdictsOf(auditExport(plus1, OPTS))["BRG-005"], "UNVERIFIED", "72h+1ms UNVERIFIED");
});

test("DAP-005: missing signer block is UNVERIFIED, never PASS or FAIL", () => {
  const env = mutatedEnvelope("bridge-pass-full", (c) => {
    delete c.signer;
  });
  const r = auditExport(env, OPTS);
  assertEqual(r.findings.find((x) => x.check_id === "BRG-001").verdict, "UNVERIFIED", "absent signer");
  assertEqual(r.status, "PARTIAL", "partial");
});

test("DAP-005: per-lane missing evidence is UNVERIFIED", () => {
  const cfEnv = mutatedEnvelope("cf-pass-full", (c) => {
    delete c.origin;
  });
  assertEqual(verdictsOf(auditExport(cfEnv, OPTS))["CF-002"], "UNVERIFIED", "absent origin");
  const sshEnv = mutatedEnvelope("ssh-pass-full", (c) => {
    delete c.firewall;
  });
  assertEqual(verdictsOf(auditExport(sshEnv, OPTS))["SSH-003"], "UNVERIFIED", "absent firewall");
});

test("DAP-005: explicit unsafe config still FAILs (password auth)", () => {
  const env = mutatedEnvelope("ssh-pass-full", (c) => {
    c.auth.password_auth = true;
  });
  assertEqual(verdictsOf(auditExport(env, OPTS))["SSH-001"], "FAIL", "explicit unsafe FAILs");
});
