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

function evaluateAttributable(result, intervalHours, now) {
  // Returns { verdict: "covered"|"gap"|"unknown", reason }.
  if (result.adapter === "supabase-table") {
    const ev = result.evidence;
    if (!ev || typeof ev.latestAt !== "string") {
      // latestAt null (with rowCount 0) means nothing ran in the window.
      if (ev && ev.rowCount === 0 && ev.latestAt === null) {
        return { verdict: "gap", reason: `no attributable rows in the last ${ev.windowHours}h` };
      }
      return { verdict: "unknown", reason: "attributable evidence malformed (latestAt not a string)" };
    }
    const age = hoursAgo(ev.latestAt, now);
    if (age === null) return { verdict: "unknown", reason: `attributable latestAt not parseable: ${ev.latestAt}` };
    if (age <= intervalHours) {
      return { verdict: "covered", reason: `attributable execution ${age.toFixed(1)}h ago (interval ${intervalHours}h)` };
    }
    return { verdict: "gap", reason: `last attributable execution ${age.toFixed(1)}h ago, interval is ${intervalHours}h` };
  }
  if (result.adapter === "github-actions") {
    const latest = result.evidence && result.evidence.latest;
    if (!latest) {
      return { verdict: "gap", reason: "no workflow runs found" };
    }
    const age = hoursAgo(latest.startedAt, now);
    if (age === null) return { verdict: "unknown", reason: "workflow run startedAt not parseable" };
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
  const intervalHours = expectedIntervalHours(capability);
  if (intervalHours === null) {
    return {
      capability_id: capabilityId,
      verdict: "unknown",
      reason: `unrecognized expected_cadence "${capability.expected_cadence}"`,
      corroborating: [],
    };
  }
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

  const evaluations = attributable.map((r) => ({ ...evaluateAttributable(r, intervalHours, at), source: r.attribution }));
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
