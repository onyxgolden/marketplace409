// evaluateCoverage (Slice 3) — per-capability coverage verdicts from
// collected evidence, with the attribution restriction enforced.
//
// Verdicts:
// - "covered": attributable evidence proves THIS capability executed
//   inside its expected interval.
// - "gap": attributable evidence exists but shows no execution in the
//   interval — the capability missed its expected run.
// - "unknown": evidence unavailable, unattributable, or malformed. Never
//   upgraded to covered.
//
// The critical restriction (Slice 2 GO verdict): a successful shared
// workflow run or an unrelated database row cannot prove an individual
// sweep executed. Only evidence with attribution "sweep-exclusive",
// "discriminator", or "workflow-exclusive" can produce "covered".
// "corroborating-only" and "unverified" sources are reported but never
// flip a verdict.

import { collectEvidence } from "./collectEvidence.mjs";
import { getAdapterSpec } from "./evidenceAdapters.mjs";
import { getCapability } from "../runtimeCoverageRegistry.mjs";

const ATTRIBUTABLE = new Set(["sweep-exclusive", "discriminator", "workflow-exclusive"]);

// Expected execution intervals, derived from the registry's cadence.
// Generous relative to the nominal cadence so normal lateness is not a
// gap; a missed cycle is.
function expectedIntervalHours(capability) {
  const cadence = capability.expected_cadence;
  if (cadence === "daily") return 30;
  if (cadence === "twice daily") return 16;
  return null;
}

function hoursAgo(iso, now) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (now - t) / 3600000;
}

function evaluateAttributable(result, intervalHours, now, executionRecord) {
  // Returns { verdict: "covered"|"gap"|"unknown", reason }.
  //
  // The Slice 3 re-review restriction: zero or stale BUSINESS-EFFECT rows
  // (charges, deliveries, attempts, invites) cannot prove a missed
  // execution — a correctly run sweep may have nothing to produce. Only
  // an execution-attempt log that writes on every invocation justifies
  // "gap". Otherwise empty/stale is "unknown".
  const FUTURE_SKEW_HOURS = 1;
  if (result.adapter === "supabase-table") {
    const ev = result.evidence;
    if (!ev || typeof ev.latestAt !== "string") {
      if (ev && ev.rowCount === 0 && ev.latestAt === null) {
        return executionRecord
          ? { verdict: "gap", reason: `execution log empty in the last ${ev.windowHours}h — no run recorded` }
          : { verdict: "unknown", reason: `no attributable business effects in the last ${ev.windowHours}h — idle run indistinguishable from missed run` };
      }
      return { verdict: "unknown", reason: "attributable evidence malformed (latestAt not a string)" };
    }
    const age = hoursAgo(ev.latestAt, now);
    if (age === null) return { verdict: "unknown", reason: `attributable latestAt not parseable: ${ev.latestAt}` };
    if (age < -FUTURE_SKEW_HOURS) {
      return { verdict: "unknown", reason: `attributable timestamp is in the future: ${ev.latestAt}` };
    }
    if (age <= intervalHours) {
      return { verdict: "covered", reason: `attributable execution ${age.toFixed(1)}h ago (interval ${intervalHours}h)` };
    }
    return executionRecord
      ? { verdict: "gap", reason: `last attributable execution ${age.toFixed(1)}h ago, interval is ${intervalHours}h` }
      : { verdict: "unknown", reason: `last attributable business effect ${age.toFixed(1)}h ago (interval ${intervalHours}h) — idle run indistinguishable from missed run` };
  }
  if (result.adapter === "github-actions") {
    const latest = result.evidence && result.evidence.latest;
    if (!latest) {
      return { verdict: "gap", reason: "no workflow runs found" };
    }
    const age = hoursAgo(latest.startedAt, now);
    if (age === null) return { verdict: "unknown", reason: "workflow run startedAt not parseable" };
    if (age < -FUTURE_SKEW_HOURS) {
      return { verdict: "unknown", reason: `workflow run timestamp is in the future: ${latest.startedAt}` };
    }
    if (latest.conclusion === "success" && age <= intervalHours) {
      return { verdict: "covered", reason: `workflow run succeeded ${age.toFixed(1)}h ago (interval ${intervalHours}h)` };
    }
    return {
      verdict: "gap",
      reason: `latest workflow run: conclusion=${latest.conclusion}, ${age.toFixed(1)}h ago (interval ${intervalHours}h)`,
    };
  }
  return { verdict: "unknown", reason: `no evaluator for adapter "${result.adapter}"` };
}

export async function evaluateCapability(capabilityId, { now, deps } = {}) {
  const at = Number.isFinite(now) ? now : Date.now();
  const capability = getCapability(capabilityId);
  if (!capability) {
    return { capability_id: capabilityId, verdict: "unknown", reason: "unknown capability", corroborating: [] };
  }
  const collected = await collectEvidence(capabilityId, { now: at, deps });
  if (!collected.ok) {
    // Covers unknown capability, invalid specs, and "no evidence
    // adapters" — all reported before cadence is consulted.
    return {
      capability_id: capabilityId,
      verdict: "unknown",
      reason: `evidence unavailable: ${collected.error}`,
      results: collected.results,
      corroborating: [],
    };
  }
  const spec = getAdapterSpec(capabilityId);
  const attributable = collected.results.filter((r) => r.ok && ATTRIBUTABLE.has(r.attribution));
  const corroborating = collected.results
    .filter((r) => !ATTRIBUTABLE.has(r.attribution))
    .map((r) => ({
      adapter: r.adapter,
      attribution: r.attribution,
      ok: r.ok,
      summary: r.ok
        ? r.adapter === "supabase-table"
          ? `${r.evidence.rowCount} rows, latest ${r.evidence.latestAt}`
          : `latest run ${r.evidence.latest ? r.evidence.latest.conclusion : "none"}`
        : r.error,
    }));

  // Conditional capabilities (e.g. the watchdog): no verified trigger or
  // cadence, so no execution is expected on a healthy cycle. Checked
  // before cadence — a conditional has no expected interval. Never gap,
  // never covered — unknown, with observed rows noted.
  if (spec && spec.evaluation_mode === "conditional") {
    const observed = attributable
      .filter((r) => r.adapter === "supabase-table" && r.evidence)
      .map((r) => r.evidence.rowCount)
      .join(", ");
    return {
      capability_id: capabilityId,
      verdict: "unknown",
      reason: `conditional recovery capability; trigger and cadence unverified — no execution expected on a healthy cycle${observed ? ` (${observed} attributable row(s) observed)` : ""}`,
      corroborating,
    };
  }

  const intervalHours = expectedIntervalHours(capability);
  if (intervalHours === null) {
    return {
      capability_id: capabilityId,
      verdict: "unknown",
      reason: `unrecognized expected_cadence "${capability.expected_cadence}"`,
      corroborating: [],
    };
  }

  if (attributable.length === 0) {
    return {
      capability_id: capabilityId,
      verdict: "unknown",
      reason:
        collected.results.length === 0
          ? "no evidence sources"
          : "no attributable evidence source; corroborating sources cannot prove execution",
      corroborating,
    };
  }

  const evaluations = attributable.map((r) => ({
    ...evaluateAttributable(r, intervalHours, at, r.execution_record === true),
    source: r.attribution,
  }));
  const covered = evaluations.find((e) => e.verdict === "covered");
  if (covered) {
    return { capability_id: capabilityId, verdict: "covered", reason: covered.reason, corroborating };
  }
  const gap = evaluations.find((e) => e.verdict === "gap");
  if (gap) {
    return { capability_id: capabilityId, verdict: "gap", reason: gap.reason, corroborating };
  }
  const first = evaluations[0];
  return { capability_id: capabilityId, verdict: "unknown", reason: first.reason, corroborating };
}

export async function evaluateAll({ now, deps } = {}) {
  const { CAPABILITIES } = await import("../runtimeCoverageRegistry.mjs");
  const results = [];
  for (const c of CAPABILITIES) {
    results.push(await evaluateCapability(c.id, { now, deps }));
  }
  return results;
}
