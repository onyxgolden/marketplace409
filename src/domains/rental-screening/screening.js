// Rentec parity R22 — tenant screening domain (server-side, framework-free).
//
// Two layers, per the build-spend doctrine:
//
// FREE LAYER (shipped): the screening workflow on an R21 application —
// status machine, consent verification (fail closed), manual result entry
// (the owner runs screening elsewhere and records the outcome), decision
// support (recommendation inputs + logged reasons), and the tokenized
// applicant link (the applicant provides info/consent; no paid pull).
//
// PROVIDER LAYER (hard gate): screening providers are a swappable stub.
// requestScreeningReport() ALWAYS returns { status: "not_connected" } and
// performs zero network I/O. Going live needs Jason's word: which provider,
// the per-report cost, and who pays (owner or applicant) — see
// SCREENING_GATE.md in this directory.
//
// Compliance: tenant screening is regulated (Fair Credit Reporting Act —
// adverse action notices, permissible purpose). SCREENING_COMPLIANCE_NOTE
// is guidance shown in the UI, not legal advice.

export const SCREENING_STATUSES = Object.freeze([
  "not_requested",
  "requested",
  "in_progress",
  "complete",
]);

// Status machine. complete is terminal; requested may skip straight to
// complete when the owner records manual results without a separate
// in-progress step.
const STATUS_TRANSITIONS = Object.freeze({
  not_requested: ["requested"],
  requested: ["in_progress", "complete"],
  in_progress: ["complete"],
  complete: [],
});

export function canTransitionScreening(from, to) {
  if (!SCREENING_STATUSES.includes(from) || !SCREENING_STATUSES.includes(to)) return false;
  return STATUS_TRANSITIONS[from].includes(to);
}

export const SCREENING_EVENTS = Object.freeze([
  "requested",
  "marked_in_progress",
  "consent_recorded",
  "applicant_info_received",
  "results_recorded",
  "recommendation_set",
  "provider_attempt_blocked",
  "completed",
  "token_regenerated",
]);

// Fail-closed consent predicate: a screening request is only accepted when
// the application carries recorded applicant consent (R21 stores it in
// answers.consent) or the applicant re-confirmed it through the link.
export function screeningConsentIsRecorded(application, screening) {
  if (application?.answers?.consent === true) return true;
  if (screening?.consent_recorded === true) return true;
  return false;
}

// A 24-char URL-safe token: the applicant's no-login link
// (/rentals/screening/<token>). Never the application id.
export function generateScreeningToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(
    bytes,
    (b) => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[b % 62],
  ).join("");
}

export const CREDIT_BANDS = Object.freeze(["poor", "fair", "good", "very_good", "excellent"]);

// Standard band boundaries used only to cross-check a manually entered
// score against its band; the owner's own criteria rule the decision.
export function creditBandForScore(score) {
  if (!Number.isInteger(score) || score < 300 || score > 850) return null;
  if (score < 580) return "poor";
  if (score < 670) return "fair";
  if (score < 740) return "good";
  if (score < 800) return "very_good";
  return "excellent";
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Validates manually entered screening results. Returns human-readable
// errors (empty = valid). Results may be recorded only on a screening in
// 'requested' or 'in_progress'.
export function validateManualResults(input) {
  const errors = [];
  if (!isPlainObject(input)) return ["Screening results are required."];
  const { creditScore, creditBand, criminalFlag, criminalNotes, evictionFlag, evictionNotes } = input;
  if (creditScore !== undefined && creditScore !== null && creditScore !== "") {
    if (!Number.isInteger(creditScore) || creditScore < 300 || creditScore > 850) {
      errors.push("Credit score must be a whole number between 300 and 850.");
    }
  }
  if (creditBand !== undefined && creditBand !== null && creditBand !== "") {
    if (!CREDIT_BANDS.includes(creditBand)) {
      errors.push(`Credit band must be one of ${CREDIT_BANDS.join(", ")}.`);
    } else if (Number.isInteger(creditScore) && creditBandForScore(creditScore) !== creditBand) {
      errors.push(`The credit band "${creditBand}" does not match the score ${creditScore}.`);
    }
  }
  for (const [flag, name] of [[criminalFlag, "criminal"], [evictionFlag, "eviction"]]) {
    if (flag !== undefined && flag !== null && typeof flag !== "boolean") {
      errors.push(`The ${name} history flag must be true or false.`);
    }
  }
  for (const [notes, name] of [[criminalNotes, "criminal"], [evictionNotes, "eviction"]]) {
    if (notes !== undefined && notes !== null && typeof notes !== "string") {
      errors.push(`The ${name} history notes must be text.`);
    } else if (typeof notes === "string" && notes.length > 4000) {
      errors.push(`The ${name} history notes are too long (max 4000 characters).`);
    }
  }
  return errors;
}

export const RECOMMENDATIONS = Object.freeze(["approve", "conditional", "deny"]);

// Decision SUPPORT only: a neutral suggestion from the recorded results.
// The owner always makes the actual decision (via R21's approve/deny flow);
// this never denies anyone on its own.
export function suggestRecommendation({ criminalFlag, evictionFlag, creditScore, creditBand } = {}) {
  const reasons = [];
  if (criminalFlag === true) reasons.push("Criminal history flag is set.");
  if (evictionFlag === true) reasons.push("Eviction history flag is set.");
  const band = creditBand || (Number.isInteger(creditScore) ? creditBandForScore(creditScore) : null);
  if (band === "poor") reasons.push("Credit band is poor.");
  if (criminalFlag === true || evictionFlag === true) {
    return { recommendation: "deny", reasons };
  }
  if (band === "poor") {
    return { recommendation: "conditional", reasons };
  }
  return { recommendation: "approve", reasons: reasons.length ? reasons : ["No screening flags recorded."] };
}

export function validateRecommendation(input) {
  const errors = [];
  if (!isPlainObject(input)) return ["A recommendation is required."];
  if (!RECOMMENDATIONS.includes(input.recommendation)) {
    errors.push(`Recommendation must be one of ${RECOMMENDATIONS.join(", ")}.`);
  }
  if (input.reasons !== undefined && input.reasons !== null && typeof input.reasons !== "string") {
    errors.push("Recommendation reasons must be text.");
  } else if (typeof input.reasons === "string" && input.reasons.length > 4000) {
    errors.push("Recommendation reasons are too long (max 4000 characters).");
  }
  return errors;
}

// Completion requires results to have been RECORDED — a screening must not
// be marked complete with an empty result set. results_recorded_at is
// written atomically with the results themselves (record_results sets both
// in one RPC), so it is the source of truth: an owner who records explicit
// "no flags" results (criminalFlag=false, evictionFlag=false, no credit
// data) still completes the screening. The value-based checks below are a
// fallback for results recorded before the atomic write existed.
export function screeningHasResults(screening) {
  if (!isPlainObject(screening)) return false;
  if (screening.results_recorded_at) return true;
  return (
    Number.isInteger(screening.credit_score)
    || isNonEmptyString(screening.credit_band)
    || isNonEmptyString(screening.criminal_notes)
    || isNonEmptyString(screening.eviction_notes)
    || screening.criminal_flag === true
    || screening.eviction_flag === true
  );
}

// --- Provider layer: HARD GATE ------------------------------------------------

// Catalogued providers. mode "provider_gated" = needs Jason's word:
// which provider, the per-report cost, and who pays (owner or applicant).
export const SCREENING_PROVIDERS = Object.freeze([
  {
    key: "transunion",
    name: "TransUnion",
    mode: "provider_gated",
    needs: "Screening-provider account agreement; per-report fee and who pays (owner or applicant) confirmed with Jason before any integration.",
  },
  {
    key: "experian",
    name: "Experian",
    mode: "provider_gated",
    needs: "Screening-provider account agreement; per-report fee and who pays (owner or applicant) confirmed with Jason before any integration.",
  },
  {
    key: "equifax",
    name: "Equifax",
    mode: "provider_gated",
    needs: "Screening-provider account agreement; per-report fee and who pays (owner or applicant) confirmed with Jason before any integration.",
  },
  {
    key: "checkr",
    name: "Checkr",
    mode: "provider_gated",
    needs: "Background-check provider agreement; per-report fee and who pays (owner or applicant) confirmed with Jason before any integration.",
  },
]);

// The swappable stub for future integrated reports. HARD GATE: this function
// MUST NOT perform network I/O. Every call reports "not_connected" so no
// provider is ever contacted — and no per-report fee ever incurred — without
// Jason's explicit approval of the provider and its cost.
export function requestScreeningReport({ providerKey } = {}) {
  const provider = SCREENING_PROVIDERS.find((entry) => entry.key === providerKey);
  if (!provider) {
    return { status: "not_connected", providerKey: providerKey || null, pulled: false, reason: "Unknown screening provider." };
  }
  return {
    status: "not_connected",
    providerKey: provider.key,
    providerName: provider.name,
    mode: provider.mode,
    reason: `Integrated reports from ${provider.name} are gated: ${provider.needs}`,
    pulled: false,
  };
}

export function listProviderStatus() {
  return SCREENING_PROVIDERS.map((provider) => ({ ...requestScreeningReport({ providerKey: provider.key }), needs: provider.needs }));
}

// --- Applicant link: rate limit + input validation ----------------------------

export const SCREENING_PUBLIC_RATE_LIMIT = Object.freeze({ windowMs: 60 * 60 * 1000, maxAttempts: 15 });

// Pure rate-limit predicate so the guard is unit-testable without a
// database. recentAttempts: sorted-desc timestamps (ms) of this
// token+IP's hits.
export function isPublicLinkRateLimited({ recentAttempts = [], now = Date.now() } = {}) {
  const windowStart = now - SCREENING_PUBLIC_RATE_LIMIT.windowMs;
  const inWindow = recentAttempts.filter((ts) => Number(ts) >= windowStart);
  return inWindow.length >= SCREENING_PUBLIC_RATE_LIMIT.maxAttempts;
}

// Validates what the applicant submits through the tokenized link: identity
// confirmation fields are optional, screening consent is mandatory.
export function validateApplicantScreeningInput(input) {
  const errors = [];
  if (!isPlainObject(input)) return ["Screening info is required."];
  if (input.consent !== true) errors.push("Screening consent is required before your information can be used.");
  const { fullName, phone, address, dateOfBirth, ssnLast4 } = input;
  for (const [value, name] of [[fullName, "full name"], [phone, "phone"], [address, "address"]]) {
    if (value !== undefined && value !== null && typeof value !== "string") errors.push(`Your ${name} must be text.`);
  }
  if (dateOfBirth !== undefined && dateOfBirth !== null && dateOfBirth !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateOfBirth))) errors.push("Date of birth must be YYYY-MM-DD.");
  }
  if (ssnLast4 !== undefined && ssnLast4 !== null && ssnLast4 !== "") {
    if (!/^\d{4}$/.test(String(ssnLast4))) errors.push("The last 4 of your SSN must be exactly 4 digits.");
  }
  return errors;
}

export function normalizeApplicantScreeningInput(input) {
  const pick = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const out = {
    fullName: pick(input.fullName),
    phone: pick(input.phone),
    address: pick(input.address),
    dateOfBirth: pick(input.dateOfBirth),
    ssnLast4: pick(input.ssnLast4),
  };
  return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== null));
}

// --- Compliance ----------------------------------------------------------------

export const SCREENING_COMPLIANCE_NOTE = "Screening guidance only — not legal advice. "
  + "If you deny an application based on a screening report, federal law (the Fair Credit Reporting Act) "
  + "may require you to send the applicant an adverse action notice. Confirm the requirements with your "
  + "attorney before acting.";
