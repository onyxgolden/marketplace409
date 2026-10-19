/**
 * sales.js — Sales Agent prototype domain logic.
 * Pure Node 24 ESM, zero dependencies.
 *
 * Deterministic lead classification, do_not_contact suppression, inert
 * outreach-draft construction, and pipeline-health arithmetic over
 * invented fixture leads. All monetary arithmetic is exact
 * BigInt/integer-rational; weighted currency amounts round once,
 * half-away-from-zero, after summing. No cross-currency aggregation.
 */

import { FITS, instantStartMs, instantEndMs } from "./schemas.js";

/**
 * Fit classification precedence (binding, Oct 19 clarification):
 *   1. need_match === false OR budget_match === false  -> FIT_LOW
 *   2. otherwise, any missing required match/timing     -> FIT_UNKNOWN
 *   3. otherwise, both true AND timing_days <= threshold -> FIT_HIGH
 *   4. remaining known values                            -> FIT_MEDIUM
 *
 * Missing required = need_match null, budget_match null, or timing_days null.
 * Returns {fit, gaps} where gaps lists the missing fields for FIT_UNKNOWN.
 */
export function classifyFit(lead, fitHighTimingDays) {
  const { need_match, budget_match, timing_days } = lead;
  if (need_match === false || budget_match === false) {
    return { fit: "FIT_LOW", gaps: [] };
  }
  const gaps = [];
  if (need_match === null) gaps.push("need_match");
  if (budget_match === null) gaps.push("budget_match");
  if (timing_days === null) gaps.push("timing_days");
  if (gaps.length > 0) {
    return { fit: "FIT_UNKNOWN", gaps };
  }
  if (need_match === true && budget_match === true && timing_days <= fitHighTimingDays) {
    return { fit: "FIT_HIGH", gaps: [] };
  }
  return { fit: "FIT_MEDIUM", gaps: [] };
}

/**
 * do_not_contact suppression. Checked BEFORE any draft construction.
 * Returns {suppressed: boolean}. A suppressed lead yields zero variants
 * regardless of fit, notes content, or purported authorization.
 */
export function checkSuppression(lead) {
  return { suppressed: lead.do_not_contact === true };
}

/**
 * Escape untrusted display/notes text for plain-text or escaped-Markdown
 * rendering. Never emits executable markup: escapes HTML-significant
 * characters and SQL-quote sequences in literals.
 */
export function escapeUntrusted(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/`/g, "&#x60;");
}

/**
 * Build the two inert outreach variants for an eligible lead.
 * Eligibility (checked by the caller): fit === FIT_HIGH, product entry
 * verified, no quarantine on the record, options.include_drafts true.
 *
 * Both variants are fixed templates over allowlisted product/benefit
 * tokens only. No discount, commitment, personal contact details, or
 * notes-provided instructions may appear. Every variant carries the
 * literal marker "DRAFT — NOT SENT".
 */
export function buildDrafts(lead, productEntry, criteria) {
  const displayName = escapeUntrusted(lead.display_name);
  const productToken = productEntry.product_token;
  const benefitTokens = productEntry.benefit_tokens.map(escapeUntrusted).join(", ");
  const header = "DRAFT — NOT SENT";
  const introduction = [
    header,
    `Introduction for ${displayName} (lead ${lead.lead_id}).`,
    `Product: ${productToken}. Benefits: ${benefitTokens}.`,
    "This is a draft template only. No outreach has been sent.",
  ].join(" ");
  const clarification = [
    header,
    `Clarification for ${displayName} (lead ${lead.lead_id}).`,
    `Product: ${productToken}. Benefits: ${benefitTokens}.`,
    "This is a draft template only. No outreach has been sent.",
  ].join(" ");
  return [
    { variant: "introduction", text: introduction, marker: header },
    { variant: "clarification", text: clarification, marker: header },
  ];
}

/** Parse an integer-minor-units string to BigInt. */
export function parseMinor(s) {
  return BigInt(s);
}

/** Format a BigInt minor-units value back to the canonical string. */
export function formatMinor(bi) {
  return bi.toString();
}

/**
 * Weighted amount for one lead: amount_minor * probability_num / probability_den,
 * kept as an exact rational {num: BigInt, den: BigInt} — never a float.
 */
export function weightedRational(amountMinorStr, probabilityNum, probabilityDen) {
  const amount = BigInt(amountMinorStr);
  return { num: amount * BigInt(probabilityNum), den: BigInt(probabilityDen) };
}

/** Add two rationals exactly: {num, den}. */
export function addRationals(a, b) {
  return { num: a.num * b.den + b.num * a.den, den: a.den * b.den };
}

/**
 * Round an exact rational to integer minor units, half-away-from-zero.
 * num/den with den > 0.
 */
export function roundRationalHalfAway(num, den) {
  if (den <= 0n) throw new Error("denominator must be positive");
  const sign = num < 0n ? -1n : 1n;
  const abs = num < 0n ? -num : num;
  const q = abs / den;
  const r = abs % den;
  // Half-away-from-zero: round up when 2*r >= den.
  const rounded = r * 2n >= den ? q + 1n : q;
  return sign * rounded;
}

/**
 * Sum exact weighted rationals for a currency group, then round once,
 * half-away-from-zero, to integer minor units. Returns the string.
 */
export function sumWeightedRounded(rationals) {
  let total = { num: 0n, den: 1n };
  for (const r of rationals) total = addRationals(total, r);
  return formatMinor(roundRationalHalfAway(total.num, total.den));
}

/** Sum integer-minor strings exactly. Returns the string. */
export function sumMinorExact(strs) {
  let total = 0n;
  for (const s of strs) total += BigInt(s);
  return formatMinor(total);
}

const OPEN_STAGES = ["NEW", "QUALIFICATION", "PROPOSAL"];
const CLOSED_STAGES = ["CLOSED_WON", "CLOSED_LOST"];

function minutesBetween(aIso, bIso) {
  // Both are validated "YYYY-MM-DD" or full instants; compare as UTC ms.
  const da = aIso.length === 10 ? `${aIso}T00:00:00Z` : aIso;
  const db = bIso.length === 10 ? `${bIso}T00:00:00Z` : bIso;
  return Math.floor((Date.parse(db) - Date.parse(da)) / 60000);
}

/**
 * Pipeline-health arithmetic over classified leads.
 *
 * leads: array of {record, fit, gaps, suppressed} with validated records.
 * options: {report_interval_start, report_interval_end, as_of}.
 *
 * Returns per-currency-group metrics:
 *   {currency, counts_by_fit, counts_by_stage, open_gross_minor,
 *    open_weighted_minor, win_rate, stage_ages, unverifiable}
 *
 * - Open pipeline = stages NEW/QUALIFICATION/PROPOSAL.
 * - Closed outcomes excluded from open pipeline.
 * - Win rate = CLOSED_WON / (CLOSED_WON + CLOSED_LOST) over closed_at
 *   within the inclusive UTC report interval; zero outcomes => UNDEFINED.
 * - Stage age = (as_of - stage_entered_at) elapsed UTC minutes on open rows.
 * - Currencies never mixed.
 * - Invalid temporal order or future events => affected metrics unverifiable.
 */
export function computePipelineMetrics(classified, options) {
  const { report_interval_start, report_interval_end, as_of } = options;
  const groups = new Map(); // currency -> accumulator

  const acc = (currency) => {
    if (!groups.has(currency)) {
      groups.set(currency, {
        currency,
        counts_by_fit: { FIT_HIGH: 0, FIT_MEDIUM: 0, FIT_LOW: 0, FIT_UNKNOWN: 0 },
        counts_by_stage: { NEW: 0, QUALIFICATION: 0, PROPOSAL: 0, CLOSED_WON: 0, CLOSED_LOST: 0 },
        open_gross_strs: [],
        open_weighted_rationals: [],
        closed_won: 0,
        closed_lost: 0,
        stage_ages: [],
        unverifiable: false,
        unverifiable_reasons: [],
      });
    }
    return groups.get(currency);
  };

  for (const c of classified) {
    const lead = c.record;
    const g = acc(lead.currency);
    g.counts_by_fit[c.fit] += 1;
    g.counts_by_stage[lead.stage] += 1;

    // Temporal sanity: created_at <= stage_entered_at; closed rows need
    // closed_at >= stage_entered_at; nothing in the future vs as_of.
    const createdMs = Date.parse(lead.created_at.length === 10 ? `${lead.created_at}T00:00:00Z` : lead.created_at);
    const enteredMs = Date.parse(lead.stage_entered_at.length === 10 ? `${lead.stage_entered_at}T00:00:00Z` : lead.stage_entered_at);
    const asOfMs = Date.parse(as_of.length === 10 ? `${as_of}T00:00:00Z` : as_of);
    let temporalBad = false;
    if (createdMs > enteredMs) temporalBad = true;
    if (enteredMs > asOfMs) temporalBad = true;
    if (lead.closed_at !== null) {
      const closedMs = Date.parse(lead.closed_at.length === 10 ? `${lead.closed_at}T00:00:00Z` : lead.closed_at);
      if (closedMs < enteredMs || closedMs > asOfMs) temporalBad = true;
    }
    if (temporalBad) {
      g.unverifiable = true;
      g.unverifiable_reasons.push(`temporal order violation for lead ${lead.lead_id}`);
      continue;
    }

    if (OPEN_STAGES.includes(lead.stage)) {
      // S653-003: an open row carrying a closed_at is inconsistent state —
      // the affected metrics are unverifiable, not silently counted.
      if (lead.closed_at !== null) {
        g.unverifiable = true;
        g.unverifiable_reasons.push(`open stage with closed_at for lead ${lead.lead_id}`);
        continue;
      }
      g.open_gross_strs.push(lead.amount_minor);
      g.open_weighted_rationals.push(weightedRational(lead.amount_minor, lead.probability_num, lead.probability_den));
      g.stage_ages.push({ lead_id: lead.lead_id, stage_age_minutes: minutesBetween(lead.stage_entered_at, as_of) });
    } else if (lead.stage === "CLOSED_WON" || lead.stage === "CLOSED_LOST") {
      // S653-003: a closed row WITHOUT closed_at is missing outcome
      // evidence — the win-rate metric is unverifiable. This is not a
      // verified empty denominator (UNDEFINED is only for zero closed
      // rows with all other closed rows fully evidenced).
      if (lead.closed_at === null) {
        g.unverifiable = true;
        g.unverifiable_reasons.push(`closed stage without closed_at for lead ${lead.lead_id}`);
        continue;
      }
      // Win-rate denominator: closed_at within the report interval,
      // compared as normalized full UTC instants (S653-003). Date-only
      // endpoints use the inclusive civil-date treatment: start at
      // 00:00:00Z, end at 23:59:59Z. No ten-character slicing.
      const closedMs = instantStartMs(lead.closed_at);
      if (closedMs >= instantStartMs(report_interval_start) && closedMs <= instantEndMs(report_interval_end)) {
        if (lead.stage === "CLOSED_WON") g.closed_won += 1;
        else g.closed_lost += 1;
      }
    }
  }

  const result = [];
  for (const g of groups.values()) {
    const closedTotal = g.closed_won + g.closed_lost;
    result.push({
      currency: g.currency,
      counts_by_fit: g.counts_by_fit,
      counts_by_stage: g.counts_by_stage,
      open_gross_minor: sumMinorExact(g.open_gross_strs),
      open_weighted_minor: sumWeightedRounded(g.open_weighted_rationals),
      win_rate: closedTotal === 0 ? { state: "UNDEFINED" } : { state: "DEFINED", won: g.closed_won, lost: g.closed_lost, value: g.closed_won / closedTotal },
      stage_ages: g.stage_ages,
      unverifiable: g.unverifiable,
      unverifiable_reasons: g.unverifiable_reasons,
    });
  }
  // Stable currency ordering.
  result.sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
  return result;
}

/**
 * Compare header claims against exact recomputation.
 * Returns {checked, match, claimed, computed, currency, interval_match}.
 * A mismatch — or a header whose interval does not describe the same
 * calculation period as the task options — suppresses the definitive
 * pipeline summary (summary:null). The comparison evidence is retained.
 * Header values are claims about the recomputation, never inputs to it.
 */
export function compareHeaderClaims(headerClaims, metrics, options) {
  if (!headerClaims) return { checked: false };
  // S653-003: the header must describe the same population/period as the
  // task's report interval; otherwise the claim is not applicable to this
  // recomputation and the summary is suppressed.
  const interval_match =
    !!options &&
    headerClaims.report_interval_start === options.report_interval_start &&
    headerClaims.report_interval_end === options.report_interval_end;
  const group = metrics.find((m) => m.currency === headerClaims.currency);
  const computed = group ? group.open_gross_minor : "0";
  const match = interval_match && computed === headerClaims.open_gross_minor;
  return {
    checked: true,
    match,
    interval_match,
    claimed: headerClaims.open_gross_minor,
    computed,
    currency: headerClaims.currency,
    evidence: "computed-recomputation (not source bytes; no byte citation available)",
  };
}
