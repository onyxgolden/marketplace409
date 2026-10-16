/**
 * index.js — defensive audit pack main entry.
 * Original code. Pure Node 24 ESM. Read-only: inspects supplied synthetic
 * export data, never touches live systems, spawns no child processes,
 * performs no network I/O and writes nothing. The hosted entrypoint with a
 * real worker watchdog lives in host.js; this core stays tool-free.
 *
 * auditExport(input, opts) -> report
 *
 * input: JSON text of a synthetic export envelope, or a plain object.
 *        Both share ONE bounded admission contract (byte/depth limits,
 *        charge-before-inspect on every consulted candidate, accessor-free
 *        own-descriptor reads).
 * opts: { asOfMs, pins: { signer_fingerprint, command_allowlist_digest,
 *         authorized_key_fingerprints, expected_sshd_binary,
 *         expected_origin_host, allowed_lan_cidrs }, now }
 *
 * Report: { status: READY|PARTIAL|REFUSED, complete, lane, machine_id,
 *           applicability, synthetic, advisory_only, limitations,
 *           export_identity, findings: [...], refused_reason?, digest }
 */

import {
  admitBytes,
  scanJsonDepth,
  CandidateBudget,
  BudgetExceeded,
  Watchdog,
  WatchdogExceeded,
  admitDocument,
  SchemaError,
} from "./budget.js";
import { validateEnvelope } from "./schemas.js";
import { LANE_CHECKS, REQUIRED_CHECK_IDS, FRESHNESS_LIMIT_MS } from "./checks.js";
import { findInjection } from "./injection.js";
import { canonicalJson, sha256HexUtf8 } from "./canonical.js";

export { BudgetExceeded, WatchdogExceeded, SchemaError };

const LIMITATIONS =
  "Synthetic advisory check over a self-reported export envelope. Applicability is configuration only. " +
  "Integrity digests are self-computed and grant no authority; this is not live-enforcement verification.";

function refused(lane, machineId, reason, evidencePtr, extra = {}) {
  return {
    status: "REFUSED",
    complete: false,
    lane: lane ?? null,
    machine_id: machineId ?? null,
    applicability: "configuration",
    synthetic: true,
    advisory_only: true,
    limitations: LIMITATIONS,
    export_identity: null,
    findings: [],
    refused_reason: reason,
    refused_evidence: evidencePtr ?? null,
    digest: null,
    ...extra,
  };
}

/** Map a bounded failure to a named refusal. Unknown errors propagate. */
function mapRefusal(e, lane, machineId) {
  if (e instanceof BudgetExceeded) return refused(lane, machineId, "BUDGET_EXCEEDED", "$");
  if (e instanceof WatchdogExceeded) return refused(lane, machineId, "WATCHDOG_EXCEEDED", "$");
  if (e instanceof SchemaError && e.code === "accessor") return refused(lane, machineId, "ACCESSOR_REJECTED", "$");
  if (e instanceof SchemaError) return refused(lane, machineId, "INVALID_INPUT", "$");
  if (e instanceof SyntaxError) return refused(lane, machineId, "INVALID_JSON", "$");
  throw e;
}

/**
 * The audit proper. Every admission and evaluation step runs inside the
 * caller's try/catch (see auditExport): budget, structural, watchdog and
 * schema failures anywhere in this path become bounded named refusals with
 * no domain findings — they never escape the public API.
 */
function auditExportInner(input, opts, box) {
  const asOfMs = Number.isFinite(opts.asOfMs) ? opts.asOfMs : Date.now();
  const watchdog = new Watchdog(5000, opts.now || Date.now);
  const budget = new CandidateBudget();

  // --- One bounded admission contract for both entrypoints ---
  let parsed;
  if (typeof input === "string") {
    admitBytes(input);
    scanJsonDepth(input);
    parsed = JSON.parse(input);
  } else if (input !== null && typeof input === "object") {
    parsed = input;
  } else {
    return refused(null, null, "INVALID_INPUT", "$");
  }
  // Charge-before-inspect deep copy: byte/depth caps, accessor-free,
  // first-over-budget candidate never touched.
  const doc = admitDocument(parsed, budget, { label: "admission" });

  // --- Host pin collections through their own bounded admission ---
  // Independent counter: pins are trusted fixture registrations, admitted
  // and hashed so findings bind to exactly the pin set consulted.
  const rawPins = opts.pins !== null && typeof opts.pins === "object" ? opts.pins : {};
  const pins = admitDocument(rawPins, new CandidateBudget(), { label: "pins" });
  const pinsDigest = sha256HexUtf8(pins);

  const env = validateEnvelope(doc);
  box.lane = env.lane;
  box.machineId = env.machineId;

  // Digest integrity: the declared source_digest must equal the SHA-256 of
  // the canonical config bytes. A changed digest refuses the export.
  const actualDigest = sha256HexUtf8(env.config);
  if (actualDigest !== env.sourceDigest) {
    return refused(env.lane, env.machineId, "DIGEST_MISMATCH", "$.source_digest");
  }

  // Injected instruction text: refused as data, never followed.
  const injection = findInjection(env.config, new CandidateBudget());
  if (injection) {
    return {
      ...refused(env.lane, env.machineId, "INJECTED_INPUT", injection.pointer),
      injection_pattern: injection.pattern,
    };
  }

  const ctx = {
    config: env.config,
    machineId: env.machineId,
    collectedAt: env.collectedAt,
    collectedAtMs: env.collectedAtMs,
    asOfMs,
    pins,
    pinsDigest,
    budget,
    watchdog,
    coverage: env.coverage,
    sourceDigest: env.sourceDigest,
  };

  const checks = LANE_CHECKS[env.lane];
  if (!checks) return refused(env.lane, env.machineId, "UNKNOWN_LANE", "$.lane");

  const findings = [];
  const seenIds = [];
  for (const check of checks) {
    watchdog.check();
    seenIds.push(check.id);
    findings.push(check.run(ctx));
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

  // Freshness applicability: a stale or future-dated export cannot support
  // current configuration PASS claims. Downgrade those to UNVERIFIED and
  // label them historical; explicitly observed FAILs are retained, never
  // erased by age.
  const ageMs = asOfMs - env.collectedAtMs;
  const stale = !Number.isFinite(ageMs) || ageMs < 0 || ageMs > FRESHNESS_LIMIT_MS;
  if (stale) {
    for (const f of findings) {
      if (f.verdict === "PASS" && f.freshness_sensitive) {
        f.verdict = "UNVERIFIED";
        f.historical = true;
        f.remediation =
          "Stale or future-dated export: this configuration claim is historical only; " +
          "re-collect within the freshness window before relying on it.";
      }
    }
  }

  const hasFail = findings.some((f) => f.verdict === "FAIL");
  const hasUnverified = findings.some((f) => f.verdict === "UNVERIFIED");
  const status = hasFail || hasUnverified ? "PARTIAL" : "READY";

  // Invariant: only a fully-passing report may claim completeness.
  const complete = status === "READY";
  if (!complete && findings.some((f) => f.verdict !== "FAIL" && f.verdict !== "UNVERIFIED" && f.verdict !== "PASS")) {
    throw new Error("invariant: unknown verdict value");
  }

  // Pinned export identity: machine/service, schema, collection time and
  // coverage travel with every report so findings bind to the export that
  // produced them. Self-computed integrity still grants no authority.
  const exportIdentity = {
    machine_id: env.machineId,
    lane: env.lane,
    schema: env.schema,
    collected_at: env.collectedAt,
    coverage: env.coverage,
    source_digest: env.sourceDigest,
    pins_digest: pinsDigest,
  };

  return {
    status,
    complete,
    lane: env.lane,
    machine_id: env.machineId,
    applicability: "configuration",
    synthetic: true,
    advisory_only: true,
    limitations: LIMITATIONS,
    export_identity: exportIdentity,
    findings,
    refused_reason: null,
    digest: sha256HexUtf8({ lane: env.lane, machine_id: env.machineId, export_identity: exportIdentity, findings }),
  };
}

export function auditExport(input, opts = {}) {
  const box = { lane: null, machineId: null };
  try {
    return auditExportInner(input, opts, box);
  } catch (e) {
    return mapRefusal(e, box.lane, box.machineId);
  }
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
