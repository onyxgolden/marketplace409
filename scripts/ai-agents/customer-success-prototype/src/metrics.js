/**
 * metrics.js — ticket validity classification and independently
 * recomputed support metrics, Metrics v1.
 *
 * All elapsed time is continuous UTC minutes (no business-hour pauses,
 * no inferred events). Every sum/mean is an exact rational ({num,den}
 * BigInts) — never a floating-point accumulation — so repeat runs are
 * byte-identical and no rounding step can silently decide an equality.
 * The *Exact() functions are the single source of truth for each exact
 * value: both the metric builders below and index.js's header-claim
 * comparison call these same functions, so the comparison is always
 * against the identical value the report actually displays — never a
 * separately reimplemented (and possibly diverging) calculation.
 * Pure Node 24 ESM, zero dependencies, zero I/O.
 */

import { rational, rAdd, rDiv, rToFixed, rToPercentFixed, rToJSON } from "./canonical.js";

const ZERO = rational(0, 1);

/**
 * Validity of one ticket's timestamps/status, independent of its
 * classification. Returns {state: "valid"|"pending"|"invalid", reason}.
 * - invalid: structurally contradictory (future/negative/out-of-order
 *   timestamps, a RESOLVED ticket missing first-response or resolution,
 *   or an OPEN ticket that already has a resolution timestamp) —
 *   explicitly excluded from every metric and from pending_ids.
 * - pending: OPEN with no first response yet — a real, admitted record,
 *   but contributes no response/resolution observation.
 * - valid: contributes a response observation, and (if RESOLVED) a
 *   resolution observation.
 */
export function ticketValidity(ticket, clockMs) {
  const createdMs = Date.parse(ticket.created_at);
  const frMs = ticket.first_response_at === null ? null : Date.parse(ticket.first_response_at);
  const resMs = ticket.resolved_at === null ? null : Date.parse(ticket.resolved_at);

  if (createdMs > clockMs) return { state: "invalid", reason: "FUTURE_TIMESTAMP" };
  if (frMs !== null) {
    if (frMs > clockMs) return { state: "invalid", reason: "FUTURE_TIMESTAMP" };
    if (frMs < createdMs) return { state: "invalid", reason: "NEGATIVE_INTERVAL" };
  }
  if (resMs !== null) {
    if (resMs > clockMs) return { state: "invalid", reason: "FUTURE_TIMESTAMP" };
    if (resMs < createdMs) return { state: "invalid", reason: "NEGATIVE_INTERVAL" };
    if (frMs !== null && resMs < frMs) return { state: "invalid", reason: "NEGATIVE_INTERVAL" };
  }
  if (ticket.status === "RESOLVED" && (frMs === null || resMs === null)) {
    return { state: "invalid", reason: "RESOLVED_INCOMPLETE" };
  }
  if (ticket.status === "OPEN" && resMs !== null) {
    return { state: "invalid", reason: "STATUS_MISMATCH" };
  }
  if (ticket.status === "OPEN" && frMs === null) {
    return { state: "pending", reason: null };
  }
  return {
    state: "valid",
    reason: null,
    responseMs: frMs !== null ? frMs - createdMs : null,
    resolutionMs: ticket.status === "RESOLVED" ? resMs - createdMs : null,
  };
}

/** Exact mean of a list of integer millisecond deltas, as minutes. Pure. */
export function meanMinutesExact(msDeltas) {
  if (msDeltas.length === 0) return null;
  let sum = ZERO;
  for (const ms of msDeltas) sum = rAdd(sum, rational(ms, 60000));
  return rDiv(sum, rational(msDeltas.length, 1));
}

/**
 * CS-002 fix: numerator/denominator must publish the actual exact
 * sum/count the mean was built from, not the observation count twice.
 * Each ms delta is itself a rational (ms/60000) that need not reduce to
 * an integer number of minutes, so the sum cannot be a bare integer
 * without rounding — instead, numerator is the exact total elapsed
 * milliseconds (always an integer; no rounding) and denominator is
 * 60000*count, so numerator/denominator is EXACTLY the mean-in-minutes,
 * unreduced, with zero precision loss for any number of fractional-
 * minute observations. BigInt + decimal-string serialization (the same
 * precision-safety convention rToJSON already uses) rather than a JS
 * Number, since Σms could exceed Number.MAX_SAFE_INTEGER for adversarial
 * timestamp ranges even though it never will for realistic fixtures.
 * This is the SAME exact value as exact_value (just unreduced instead
 * of reduced) — both derived from the one meanMinutesExact() call, so
 * the two can never again diverge into incompatible ratios.
 */
export function timeMetric(msDeltas, pendingCount, excludedCount, totalPopulation, isPopulationVerified) {
  const exact = meanMinutesExact(msDeltas);
  const count = msDeltas.length;
  let sumMs = 0n;
  for (const ms of msDeltas) sumMs += BigInt(ms);
  const scaledDenominator = 60000n * BigInt(count);
  return {
    numerator: count === 0 ? "0" : sumMs.toString(),
    denominator: count === 0 ? "0" : scaledDenominator.toString(),
    exact_value: rToJSON(exact),
    display: exact === null ? "UNDEFINED" : rToFixed(exact, 2),
    evidence_state: count === 0 ? "unverifiable" : isPopulationVerified ? "verified" : "unverifiable",
    pending_count: pendingCount,
    excluded_count: excludedCount,
    total_population: totalPopulation,
  };
}

/** Exact SLA ratio: compliant valid-first-responses / all valid first
 *  responses, inclusive boundary against the trusted threshold. Pure. */
export function slaRatioExact(responseMinutesExactList, thresholdMinutes) {
  const denominator = responseMinutesExactList.length;
  if (denominator === 0) return { compliant: 0, denominator: 0, ratio: null };
  const threshold = rational(thresholdMinutes, 1);
  let compliant = 0;
  for (const m of responseMinutesExactList) {
    if (m.num * threshold.den <= threshold.num * m.den) compliant += 1;
  }
  return { compliant, denominator, ratio: rDiv(rational(compliant, 1), rational(denominator, 1)) };
}

/** SLA response compliance = valid first responses within the trusted
 *  threshold (inclusive) / all valid first responses. Never claims
 *  overall open-ticket SLA attainment — only the measured valid subset. */
export function slaComplianceMetric(responseMinutesExactList, thresholdMinutes, pendingCount, excludedCount, totalPopulation, isPopulationVerified) {
  const { compliant, denominator, ratio } = slaRatioExact(responseMinutesExactList, thresholdMinutes);
  return {
    numerator: compliant,
    denominator,
    exact_value: rToJSON(ratio),
    display: ratio === null ? "UNDEFINED" : `${rToPercentFixed(ratio, 2)}%`,
    evidence_state: denominator === 0 ? "unverifiable" : isPopulationVerified ? "verified" : "unverifiable",
    pending_count: pendingCount,
    excluded_count: excludedCount,
    total_population: totalPopulation,
  };
}

/** Exact CSAT sum/mean/positive-share. Pure. */
export function csatExact(ratings) {
  const ratedCount = ratings.length;
  if (ratedCount === 0) return { sum: 0n, ratedCount: 0, mean: null, positiveCount: 0, positiveShare: null };
  let sum = 0n;
  for (const r of ratings) sum += BigInt(r);
  const mean = rDiv(rational(sum, 1), rational(ratedCount, 1));
  const positiveCount = ratings.filter((r) => r >= 4).length;
  const positiveShare = rDiv(rational(positiveCount, 1), rational(ratedCount, 1));
  return { sum, ratedCount, mean, positiveCount, positiveShare };
}

/** CSAT mean and positive share are separate measures, never conflated. */
export function csatMetrics(ratings, isPopulationVerified) {
  const { sum, ratedCount, mean, positiveCount, positiveShare } = csatExact(ratings);
  if (ratedCount === 0) {
    const undefinedMetric = { numerator: 0, denominator: 0, exact_value: null, display: "UNDEFINED", evidence_state: "unverifiable" };
    return { mean: { ...undefinedMetric }, positive_share: { ...undefinedMetric } };
  }
  return {
    mean: {
      numerator: Number(sum),
      denominator: ratedCount,
      exact_value: rToJSON(mean),
      display: rToFixed(mean, 2),
      evidence_state: isPopulationVerified ? "verified" : "unverifiable",
    },
    positive_share: {
      numerator: positiveCount,
      denominator: ratedCount,
      exact_value: rToJSON(positiveShare),
      display: `${rToPercentFixed(positiveShare, 2)}%`,
      evidence_state: isPopulationVerified ? "verified" : "unverifiable",
    },
  };
}
