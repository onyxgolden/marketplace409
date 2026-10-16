/**
 * index.js — defensive audit pack main entry.
 * Original code. Pure Node 24 ESM. Read-only: inspects supplied synthetic
 * export data, never touches live systems, spawns no child processes,
 * performs no network I/O and writes nothing.
 *
 * auditExport(input, opts) -> report
 *
 * input: JSON text of a synthetic export envelope, or a plain object.
 * opts: { asOfMs, pins: { signer_fingerprint, authorized_key_fingerprints,
 *         expected_sshd_binary }, now }
 *
 * Report: { status: READY|PARTIAL|REFUSED, complete, lane, machine_id,
 *           findings: [...], refused_reason?, digest }
 */

import {
  admitBytes,
  scanJsonDepth,
  CandidateBudget,
  BudgetExceeded,
  Watchdog,
  WatchdogExceeded,
  ownRead,
} from "./budget.js";
import { validateEnvelope, SchemaError } from "./schemas.js";
import { LANE_CHECKS, REQUIRED_CHECK_IDS } from "./checks.js";
import { findInjection } from "./injection.js";
import { canonicalJson, sha256HexUtf8 } from "./canonical.js";

export { BudgetExceeded, WatchdogExceeded, SchemaError };

/**
 * Walk a programmatic input with own descriptors only. Throws
 * ACCESSOR_REJECTED if any accessor property is found (a getter must
 * never be invoked). Returns a plain-data deep copy of data properties.
 */
function ownDataCopy(value, seen = new Set()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) throw new SchemaError("cycle", "input object graph must be acyclic");
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((v, i) => {
      const d = Object.getOwnPropertyDescriptor(value, i);
      if (d && !("value" in d)) throw accessorError(i);
      return ownDataCopy(d ? d.value : v, seen);
    });
  }
  const out = {};
  for (const k of Object.keys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, k);
    if (!d) continue;
    if (!("value" in d)) throw accessorError(k);
    out[k] = ownDataCopy(d.value, seen);
  }
  return out;
}

function accessorError(key) {
  const e = new SchemaError("accessor", `accessor property ${JSON.stringify(String(key))} rejected without invocation`);
  e.code = "accessor";
  return e;
}

function refused(lane, machineId, reason, evidencePtr) {
  return {
    status: "REFUSED",
    complete: false,
    lane: lane ?? null,
    machine_id: machineId ?? null,
    findings: [],
    refused_reason: reason,
    refused_evidence: evidencePtr ?? null,
    digest: null,
  };
}

export function auditExport(input, opts = {}) {
  const asOfMs = Number.isFinite(opts.asOfMs) ? opts.asOfMs : Date.now();
  const pins = opts.pins || {};
  const watchdog = new Watchdog(5000, opts.now || Date.now);
  const budget = new CandidateBudget();

  let doc;
  try {
    if (typeof input === "string") {
      admitBytes(input);
      scanJsonDepth(input);
      doc = JSON.parse(input);
    } else if (input !== null && typeof input === "object") {
      doc = ownDataCopy(input);
    } else {
      return refused(null, null, "INVALID_INPUT", "$");
    }
  } catch (e) {
    if (e instanceof BudgetExceeded) return refused(null, null, "BUDGET_EXCEEDED", "$");
    if (e instanceof WatchdogExceeded) return refused(null, null, "WATCHDOG_EXCEEDED", "$");
    if (e instanceof SchemaError && e.code === "accessor") return refused(null, null, "ACCESSOR_REJECTED", "$");
    if (e instanceof SchemaError) return refused(null, null, "INVALID_INPUT", "$");
    if (e instanceof SyntaxError) return refused(null, null, "INVALID_JSON", "$");
    throw e;
  }

  let env;
  try {
    env = validateEnvelope(doc);
  } catch (e) {
    if (e instanceof SchemaError && e.code === "accessor") return refused(null, null, "ACCESSOR_REJECTED", "$");
    return refused(null, null, "INVALID_INPUT", "$");
  }

  // Digest integrity: the declared source_digest must equal the SHA-256 of
  // the canonical config bytes. A changed digest refuses the export.
  const actualDigest = sha256HexUtf8(env.config);
  if (actualDigest !== env.sourceDigest) {
    return refused(env.lane, env.machineId, "DIGEST_MISMATCH", "$.source_digest");
  }

  // Injected instruction text: refused as data, never followed.
  const injection = findInjection(env.config, (label) => budget.charge(label));
  if (injection) {
    return {
      ...refused(env.lane, env.machineId, "INJECTED_INPUT", injection.pointer),
      injection_pattern: injection.pattern,
    };
  }

  const ctx = {
    config: env.config,
    machineId: env.machineId,
    collectedAtMs: env.collectedAtMs,
    asOfMs,
    pins,
    budget,
    watchdog,
    coverage: env.coverage,
    sourceDigest: env.sourceDigest,
  };

  const checks = LANE_CHECKS[env.lane];
  if (!checks) return refused(env.lane, env.machineId, "UNKNOWN_LANE", "$.lane");

  const findings = [];
  const seenIds = [];
  try {
    for (const check of checks) {
      watchdog.check();
      seenIds.push(check.id);
      findings.push(check.run(ctx));
    }
  } catch (e) {
    if (e instanceof BudgetExceeded) return refused(env.lane, env.machineId, "BUDGET_EXCEEDED", "$.config");
    if (e instanceof WatchdogExceeded) return refused(env.lane, env.machineId, "WATCHDOG_EXCEEDED", "$.config");
    throw e;
  }

  // Coverage completeness: every required check must have executed.
  // A mutation that omits a check is detected here, not silently passed.
  const required = REQUIRED_CHECK_IDS[env.lane];
  const missing = required.filter((id) => !seenIds.includes(id));
  const extra = seenIds.filter((id) => !required.includes(id));
  if (missing.length > 0 || extra.length > 0) {
    return {
      ...refused(env.lane, env.machineId, "INCOMPLETE_COVERAGE", "$"),
      missing_checks: missing,
      extra_checks: extra,
    };
  }

  const hasFail = findings.some((f) => f.verdict === "FAIL");
  const hasUnverified = findings.some((f) => f.verdict === "UNVERIFIED");
  const status = hasFail || hasUnverified ? "PARTIAL" : "READY";

  // Invariant: only a fully-passing report may claim completeness.
  // Missing/stale evidence is UNVERIFIED, never PASS.
  const complete = status === "READY";
  if (!complete && findings.some((f) => f.verdict !== "FAIL" && f.verdict !== "UNVERIFIED" && f.verdict !== "PASS")) {
    throw new Error("invariant: unknown verdict value");
  }

  return {
    status,
    complete,
    lane: env.lane,
    machine_id: env.machineId,
    findings,
    refused_reason: null,
    digest: sha256HexUtf8({ lane: env.lane, machine_id: env.machineId, findings }),
  };
}

/** Direct-launch helper: audit a JSON file's text. No file I/O inside. */
export function auditText(text, opts) {
  return auditExport(text, opts);
}

export const BOUNDS = {
  maxCandidates: 64,
  maxAdmitBytes: 256 * 1024,
  maxDepth: 16,
  watchdogMs: 5000,
  freshnessHours: 72,
};
