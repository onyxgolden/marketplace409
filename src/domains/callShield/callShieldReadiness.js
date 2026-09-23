// Readiness scoring for Call Shield.
//
// scoreReadiness() reads a case state and returns OBSERVATIONS about the
// evidence on file — never legal conclusions. It answers "how complete is
// this evidence file?" and "are there factors an attorney would want to
// review?", not "is this a violation?" or "what is it worth?"
//
// Statuses:
// - ready: evidence patterns attorneys may review (green)
// - incomplete: gaps the user can still fill (yellow)
// - flagged: a potential exclusion factor was identified — needs human/
//   attorney review. Never "disqualified": e.g. a political call is not
//   automatically fatal; it depends on technology, recipient, consent.

import {
  DNC_REGISTRATION_WINDOW_DAYS,
  READINESS_STATUS,
  REPEAT_CALL_THRESHOLD,
  REPEAT_CALL_WINDOW_MONTHS,
  SIGNAL_TYPES,
} from "./callShieldConstants.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function signal(type, detail, observedAt = null) {
  return { type, detail, observedAt };
}

/**
 * Score a case's evidence readiness.
 *
 * @param {object} caseState - from openCase/rebuildCase
 * @param {object} opts
 * @param {Date|string} opts.asOf - scoring moment (default now)
 * @param {string[]} opts.reportedExclusionFactors - user-reported context the
 *   attorney should review, e.g. "political", "charity", "survey",
 *   "prior_consent", "business_relationship". Recorded as observations.
 * @returns {{ status, signals[], gaps[], exclusionFactors[] }}
 */
export function scoreReadiness(caseState, opts = {}) {
  const asOf = opts.asOf ? new Date(opts.asOf) : new Date();
  const signals = [];
  const gaps = [];
  const exclusionFactors = [];

  const calls = Array.isArray(caseState?.calls) ? caseState.calls : [];
  const dncRegs = Array.isArray(caseState?.dncRegistrations) ? caseState.dncRegistrations : [];
  const optOuts = Array.isArray(caseState?.optOuts) ? caseState.optOuts : [];

  // --- DNC registration present? ---
  const qualifyingReg = dncRegs
    .filter((r) => !Number.isNaN(new Date(r.registeredAt).getTime()))
    .sort((a, b) => new Date(a.registeredAt) - new Date(b.registeredAt))[0];
  if (qualifyingReg) {
    signals.push(
      signal(
        SIGNAL_TYPES.DNC_REGISTRATION_PRESENT,
        `Protected number ${maskPhone(qualifyingReg.phoneNumber)} shows a DNC ` +
          `registration timestamp of ${qualifyingReg.registeredAt}.`,
        qualifyingReg.registeredAt
      )
    );
    // Calls after the registration window closed.
    const windowStart = new Date(qualifyingReg.registeredAt).getTime() + DNC_REGISTRATION_WINDOW_DAYS * DAY_MS;
    const callsAfterWindow = calls.filter((c) => new Date(c.occurredAt).getTime() >= windowStart);
    if (callsAfterWindow.length > 0) {
      signals.push(
        signal(
          SIGNAL_TYPES.CALLS_AFTER_DNC_WINDOW,
          `${callsAfterWindow.length} logged call(s) occurred on or after the ` +
            `${DNC_REGISTRATION_WINDOW_DAYS}-day registration window.`
        )
      );
    }
  } else {
    gaps.push({
      type: SIGNAL_TYPES.EVIDENCE_GAP,
      detail: "No DNC registration timestamp on file. Add one from the registry to strengthen the file.",
    });
  }

  // --- Repeated calls within 12 months attributed to the same reported entity? ---
  const windowStartMs = asOf.getTime() - REPEAT_CALL_WINDOW_MONTHS * 30.44 * DAY_MS;
  const recentCalls = calls.filter((c) => new Date(c.occurredAt).getTime() >= windowStartMs);
  if (recentCalls.length >= REPEAT_CALL_THRESHOLD) {
    signals.push(
      signal(
        SIGNAL_TYPES.REPEATED_CALLS_SAME_ENTITY,
        `${recentCalls.length} call(s) in the last ${REPEAT_CALL_WINDOW_MONTHS} months ` +
          `attributed by the user to "${caseState?.reportedBusinessName || "the reported business"}".`
      )
    );
  } else if (calls.length === 1) {
    gaps.push({
      type: SIGNAL_TYPES.EVIDENCE_GAP,
      detail: "Only one call logged so far. Evidence files are stronger with a documented pattern.",
    });
  } else if (calls.length === 0) {
    gaps.push({
      type: SIGNAL_TYPES.EVIDENCE_GAP,
      detail: "No calls logged yet.",
    });
  }

  // --- Opt-out documented? ---
  if (optOuts.length > 0) {
    const latest = [...optOuts].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))[0];
    signals.push(
      signal(
        SIGNAL_TYPES.OPT_OUT_DOCUMENTED,
        `${optOuts.length} opt-out/revocation statement(s) recorded; most recent ` +
          `${latest.occurredAt} via ${latest.channel}.`,
        latest.occurredAt
      )
    );
  } else {
    gaps.push({
      type: SIGNAL_TYPES.EVIDENCE_GAP,
      detail: "No opt-out or revocation statement recorded. Log the date you asked them to stop.",
    });
  }

  // --- Identity evidence? ---
  const identityBits = [];
  for (const c of calls) {
    if (c.agentName) identityBits.push(`agent name "${c.agentName}"`);
    if (c.businessNameStated) identityBits.push(`stated business "${c.businessNameStated}"`);
  }
  const uniqueBits = [...new Set(identityBits)];
  if (uniqueBits.length > 0) {
    signals.push(
      signal(
        SIGNAL_TYPES.IDENTITY_EVIDENCE_PRESENT,
        `Identity assertions on file: ${uniqueBits.join("; ")}. Recorded as stated by the caller, not verified.`
      )
    );
  } else {
    gaps.push({
      type: SIGNAL_TYPES.EVIDENCE_GAP,
      detail: "No agent name or stated business name captured. Ask for and note these on the next call.",
    });
  }

  // --- User-reported exclusion factors: surfaced for review, never auto-disqualifying. ---
  const reported = Array.isArray(opts.reportedExclusionFactors) ? opts.reportedExclusionFactors : [];
  for (const factor of reported) {
    exclusionFactors.push(
      signal(
        SIGNAL_TYPES.POTENTIAL_EXCLUSION_FACTOR,
        `User reported context "${factor}". Whether this affects the matter depends on ` +
          `technology used, recipient type, consent history, and other facts — flagged for attorney review.`
      )
    );
  }

  // --- Status ---
  let status = READINESS_STATUS.INCOMPLETE;
  const hasCorePattern =
    signals.some((s) => s.type === SIGNAL_TYPES.REPEATED_CALLS_SAME_ENTITY) &&
    signals.some((s) => s.type === SIGNAL_TYPES.OPT_OUT_DOCUMENTED) &&
    signals.some((s) => s.type === SIGNAL_TYPES.DNC_REGISTRATION_PRESENT);
  if (exclusionFactors.length > 0) {
    status = READINESS_STATUS.FLAGGED;
  } else if (hasCorePattern) {
    status = READINESS_STATUS.READY;
  }

  return { status, signals, gaps, exclusionFactors };
}

function maskPhone(phone) {
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `****${digits.slice(-4)}`;
}
