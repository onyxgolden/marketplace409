/**
 * runNightlyDocDrift.mjs — Slice 11: nightly doc-drift wiring.
 *
 * Scan in, up to maxFixes fix PRs out. Each attempt takes one proposable
 * doc-drift finding through the reviewed prepareFixPr pipeline (branch +
 * PR; never merge) with the Slice 10 doc-aware applyAndVerify.
 *
 *   runNightlyDocDrift({
 *     repoRoot, docs = ["docs"], baseCommit,
 *     maxFixes = 3, driftId = null, dryRun = false,
 *     deps = {},
 *   })
 *
 * Injectable deps (all hermetic in tests):
 *   - scanAndPropose({ repoRoot, docs }) -> Slice 10 report entries
 *       [{ finding, proposable, reason, explanation, patch }]
 *   - listFixPrs() -> [{ number, state, head, title }] (default: none known)
 *   - runDriver({ finding, patch, repoRoot, baseCommit, driftId, deps })
 *       -> prepareFixPr result (default: the real pipeline)
 *   - pushBranch / openPr -> passed through to the driver (Slice 7 seam)
 *
 * Returns { ok, attempted, skipped, deferred, warnings } where each entry is
 * { driftId, outcome, stage?, reason?, branch?, pr? }.
 *
 * Drift ids are stable: `doc-drift/<class>/<docPath>:<line>` — the same
 * signalId the Slice 10 CLI stamps into fix-PR titles, so the Slice 9
 * findPriorFixPr dedupe (branch prefix + title match) applies unchanged:
 * a drift with any prior fix PR (open, merged, or human-closed) is never
 * re-attempted. Findings with no deterministic patch are skipped, never
 * attempted.
 *
 * Fail-closed: bad inputs, an unreadable/unscannable repo, or a driver that
 * *throws* (clean stops return, they never throw) fail the run. A throw is
 * recorded and remaining findings still run; the run reports ok:false at
 * the end. The runner never merges, deploys, or writes production data —
 * its only mutating actions are branch push + PR creation via the reviewed
 * Slice 7 path, and only when dryRun is false.
 */

import { scanAndPropose as defaultScanAndPropose, applyDocPatch } from "./runDocDriftCli.mjs";
import { findPriorFixPr } from "../patch/runNightlySelfHeal.mjs";
import { prepareFixPr } from "../patch/prepareFixPr.mjs";

export const DEFAULT_MAX_FIXES = 3;

const fail = (stage, reason, extra = {}) => ({ ok: false, stage, reason, ...extra });

function isHexSha(value) {
  return typeof value === "string" && /^[0-9a-f]{7,64}$/i.test(value);
}

/** Stable drift identity: doubles as the fix-PR signalId for dedupe. */
export function driftIdFor(finding) {
  return `doc-drift/${finding.driftClass}/${finding.docPath}:${finding.line}`;
}

function skipOutcomeFor(prior) {
  if (!prior) return null;
  const state = String(prior.state || "").toLowerCase();
  if (state === "open") return "already-open";
  if (state === "merged") return "already-merged";
  return "already-closed";
}

function defaultRunDriver({ finding, patch, repoRoot, baseCommit, driftId, deps = {} }) {
  return prepareFixPr({
    patch,
    repoRoot,
    baseCommit,
    context: { signalId: driftId },
    deps: {
      applyAndVerify: applyDocPatch,
      ...(deps.pushBranch ? { pushBranch: deps.pushBranch } : {}),
      ...(deps.openPr ? { openPr: deps.openPr } : {}),
    },
  });
}

export function runNightlyDocDrift({
  repoRoot,
  docs = ["docs"],
  baseCommit,
  maxFixes = DEFAULT_MAX_FIXES,
  driftId = null,
  dryRun = false,
  deps = {},
}) {
  // --- validate ---
  if (!repoRoot || !baseCommit) {
    return fail("validate", "missing-context");
  }
  if (!isHexSha(baseCommit)) {
    return fail("validate", "malformed-base-commit");
  }
  const budget0 = Number(maxFixes);
  if (!Number.isInteger(budget0) || budget0 < 1) {
    return fail("validate", "malformed-max-fixes");
  }

  const scanAndPropose = deps.scanAndPropose || defaultScanAndPropose;
  const listFixPrs = deps.listFixPrs || (() => []);
  const runDriver = deps.runDriver || defaultRunDriver;

  // --- scan (fail-closed) ---
  let report;
  try {
    report = scanAndPropose({ repoRoot, docs }) || [];
  } catch (e) {
    return fail("scan", "scan-threw", {
      detail: String((e && e.message) || e).slice(0, 300),
    });
  }

  if (driftId != null && driftId !== "") {
    report = report.filter((r) => driftIdFor(r.finding) === String(driftId));
    if (report.length === 0) {
      return fail("validate", "unknown-drift", { driftId: String(driftId) });
    }
  }

  // scanAndPropose already sorts deterministically (doc path, then line);
  // re-sort defensively so a custom seam cannot change night-to-night order.
  report = [...report].sort((a, b) => {
    const x = driftIdFor(a.finding);
    const y = driftIdFor(b.finding);
    return x < y ? -1 : x > y ? 1 : 0;
  });

  if (report.length === 0) {
    return { ok: true, attempted: [], skipped: [], deferred: [], warnings: [], note: "no-findings" };
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
  const warnings = [];
  let threw = false;
  let budget = budget0;

  for (const entry of report) {
    const id = driftIdFor(entry.finding);

    if (!entry.proposable || !entry.patch || entry.patch.noPatch) {
      skipped.push({ driftId: id, outcome: "no-patch", reason: entry.reason || "not-proposable" });
      continue;
    }

    const prior = findPriorFixPr(fixPrs, id);
    const skipOutcome = skipOutcomeFor(prior);
    if (skipOutcome) {
      skipped.push({ driftId: id, outcome: skipOutcome, pr: prior.number ?? null });
      continue;
    }
    if (budget <= 0) {
      deferred.push({ driftId: id, outcome: "deferred", reason: "max-fixes-reached" });
      continue;
    }
    budget -= 1;

    if (dryRun) {
      attempted.push({ driftId: id, outcome: "would-attempt" });
      continue;
    }

    let result;
    try {
      result = runDriver({
        finding: entry.finding,
        patch: entry.patch,
        repoRoot,
        baseCommit,
        driftId: id,
        deps,
      });
    } catch (e) {
      threw = true;
      attempted.push({
        driftId: id,
        outcome: "driver-threw",
        detail: String((e && e.message) || e).slice(0, 300),
      });
      continue;
    }

    if (result && result.ok) {
      attempted.push({
        driftId: id,
        outcome: "pr-opened",
        branch: result.branch || null,
        pr: result.pr || null,
      });
    } else {
      attempted.push({
        driftId: id,
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
