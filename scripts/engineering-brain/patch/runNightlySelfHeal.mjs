/**
 * runNightlySelfHeal.mjs — Slice 9: nightly runner wiring.
 *
 * One evidence file in, up to maxAttempts driver runs out. Each attempt calls
 * the Slice 8 driver (runSelfHeal), which opens at most one fix PR per signal.
 *
 *   runNightlySelfHeal({
 *     evidencePath, repoRoot, baseCommit,
 *     maxAttempts = 3, signalId = null, dryRun = false,
 *     deps = {},
 *   })
 *
 * Injectable deps (all hermetic in tests):
 *   - readEvidence(path) -> parsed JSON (default: fs.readFileSync + JSON.parse)
 *   - listFixPrs() -> [{ number, state, head, title }] (default: none known)
 *   - runDriver(opts) -> runSelfHeal result (default: the real driver)
 *   - pushBranch / openPr -> passed through to the driver (Slice 7 seam)
 *
 * Returns { ok, attempted, skipped, deferred, warnings } where each entry is
 * { signalId, outcome, stage?, reason?, branch?, pr? }.
 *
 * Fail-closed: bad inputs, unreadable evidence, or a driver that *throws*
 * (clean stops return, they never throw) fail the run. A throw is recorded
 * and remaining signals still run; the run reports ok:false at the end.
 * The runner never merges, deploys, or writes production data — its only
 * mutating actions are branch push + PR creation via the reviewed Slice 7
 * path, and only when dryRun is false.
 */

import fs from "node:fs";
import { parseCollectedEvidence } from "../query/loadCollectedEvidence.mjs";
import { runSelfHeal as defaultRunDriver } from "./runSelfHeal.mjs";
import { FIX_BRANCH_PREFIX } from "./prepareFixPr.mjs";

export const DEFAULT_MAX_ATTEMPTS = 3;

const fail = (stage, reason, extra = {}) => ({ ok: false, stage, reason, ...extra });

function defaultReadEvidence(evidencePath) {
  let raw;
  try {
    raw = fs.readFileSync(evidencePath, "utf8");
  } catch (e) {
    throw new Error(`cannot read evidence file "${evidencePath}": ${e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`evidence file "${evidencePath}" is not valid JSON: ${e.message}`);
  }
}

function isHexSha(value) {
  return typeof value === "string" && /^[0-9a-f]{7,64}$/i.test(value);
}

/**
 * Match a prior fix PR to a signal. Branch names are deterministic
 * (engbrain-fix/<class>-<signal>-<diff8>) and PR titles carry
 * "from <signalId>", so require both the prefix and the id.
 */
export function findPriorFixPr(fixPrs, signalId) {
  const list = Array.isArray(fixPrs) ? fixPrs : [];
  return (
    list.find(
      (pr) =>
        pr &&
        typeof pr.head === "string" &&
        pr.head.startsWith(FIX_BRANCH_PREFIX) &&
        typeof pr.title === "string" &&
        pr.title.includes(String(signalId)),
    ) || null
  );
}

function skipOutcomeFor(prior) {
  if (!prior) return null;
  const state = String(prior.state || "").toLowerCase();
  if (state === "open") return "already-open";
  if (state === "merged") return "already-merged";
  return "already-closed";
}

export function runNightlySelfHeal({
  evidencePath,
  repoRoot,
  baseCommit,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  signalId = null,
  dryRun = false,
  deps = {},
}) {
  // --- validate ---
  if (!evidencePath || !repoRoot || !baseCommit) {
    return fail("validate", "missing-context");
  }
  if (!isHexSha(baseCommit)) {
    return fail("validate", "malformed-base-commit");
  }
  const attempts = Number(maxAttempts);
  if (!Number.isInteger(attempts) || attempts < 1) {
    return fail("validate", "malformed-max-attempts");
  }

  const readEvidence = deps.readEvidence || defaultReadEvidence;
  const listFixPrs = deps.listFixPrs || (() => []);
  const runDriver = deps.runDriver || defaultRunDriver;

  // --- load evidence (fail-closed) ---
  let payload;
  try {
    payload = readEvidence(evidencePath);
  } catch (e) {
    return fail("load-evidence", "unreadable-evidence", {
      detail: String((e && e.message) || e).slice(0, 300),
    });
  }
  let signals;
  let warnings = [];
  try {
    ({ signals, warnings } = parseCollectedEvidence(payload));
  } catch (e) {
    return fail("load-evidence", "malformed-evidence", {
      detail: String((e && e.message) || e).slice(0, 300),
    });
  }

  if (signalId != null && signalId !== "") {
    signals = signals.filter((s) => s.signal_id === String(signalId));
    if (signals.length === 0) {
      return fail("validate", "unknown-signal", { signalId: String(signalId) });
    }
  }

  // Deterministic order night to night.
  signals = [...signals].sort((a, b) => String(a.signal_id).localeCompare(String(b.signal_id)));

  if (signals.length === 0) {
    return { ok: true, attempted: [], skipped: [], deferred: [], warnings, note: "no-usable-signals" };
  }

  // --- dedupe against prior fix PRs ---
  let fixPrs = [];
  try {
    fixPrs = listFixPrs() || [];
  } catch (e) {
    return fail("list-fix-prs", "list-fix-prs-threw", {
      detail: String((e && e.message) || e).slice(0, 300),
    });
  }

  const attempted = [];
  const skipped = [];
  const deferred = [];
  let threw = false;
  let budget = attempts;

  for (const signal of signals) {
    const id = String(signal.signal_id);
    const prior = findPriorFixPr(fixPrs, id);
    const skipOutcome = skipOutcomeFor(prior);
    if (skipOutcome) {
      skipped.push({ signalId: id, outcome: skipOutcome, pr: prior.number ?? null });
      continue;
    }
    if (budget <= 0) {
      deferred.push({ signalId: id, outcome: "deferred", reason: "max-attempts-reached" });
      continue;
    }
    budget -= 1;

    if (dryRun) {
      attempted.push({ signalId: id, outcome: "would-attempt" });
      continue;
    }

    let result;
    try {
      result = runDriver({
        evidencePath,
        signalId: id,
        repoRoot,
        baseCommit,
        manifestPath: deps.manifestPath,
        deps,
      });
    } catch (e) {
      threw = true;
      attempted.push({
        signalId: id,
        outcome: "driver-threw",
        detail: String((e && e.message) || e).slice(0, 300),
      });
      continue;
    }

    if (result && result.ok) {
      attempted.push({
        signalId: id,
        outcome: "pr-opened",
        branch: result.branch || null,
        pr: result.pr || null,
      });
    } else {
      attempted.push({
        signalId: id,
        outcome: "clean-stop",
        stage: (result && result.stage) || "unknown",
        reason: (result && result.reason) || "unknown",
      });
    }
  }

  if (threw) {
    return { ok: false, stage: "run-driver", reason: "driver-threw", attempted, skipped, deferred, warnings };
  }
  return { ok: true, attempted, skipped, deferred, warnings };
}
