/**
 * DSCR lender listing helpers.
 *
 * NMLS format validation is SYNTACTIC ONLY — a format-valid number does not
 * establish ownership, licensing status, or term accuracy (DSCR-SCOPE-002).
 * Verification happens through the moderation lifecycle and the public
 * NMLS Consumer Access link, never from the number alone.
 */

/**
 * Validate NMLS company number format.
 * NMLS company IDs are numeric, typically 5-8 digits.
 * @param {string|number} value
 * @returns {{valid:boolean, normalized:string|null, error:string|null}}
 */
export function validateNmlsFormat(value) {
  const str = String(value ?? "").trim();
  if (!str) {
    return { valid: false, normalized: null, error: "NMLS number is required." };
  }
  if (!/^\d+$/.test(str)) {
    return {
      valid: false,
      normalized: null,
      error: "NMLS number must contain only digits.",
    };
  }
  if (str.length < 5 || str.length > 8) {
    return {
      valid: false,
      normalized: null,
      error: "NMLS number must be 5 to 8 digits.",
    };
  }
  return { valid: true, normalized: str, error: null };
}

/**
 * Build the public NMLS Consumer Access lookup URL for a company number.
 * Users verify licensing independently — FORGE never asserts it from the number.
 * @param {string} nmlsNumber
 * @returns {string}
 */
export function nmlsConsumerAccessUrl(nmlsNumber) {
  return `https://www.nmlsconsumeraccess.org/EntityDetails.aspx/COMPANY/${encodeURIComponent(
    nmlsNumber
  )}`;
}

/** Days after which unreconfirmed terms are considered stale. */
export const STALENESS_THRESHOLD_DAYS = 180;

/**
 * Moderation lifecycle (DSCR-SCOPE-003 / DSCR-IMPL-001).
 *
 * Statuses: draft | pending_review | published | unpublished
 * Listings are NEVER hard-deleted: removal sets status = 'unpublished'
 * (soft removal). The audit table is append-only at the DB boundary.
 *
 * Admin actions and the source status each requires:
 */
export const MODERATION_TRANSITIONS = Object.freeze({
  approve_submission: Object.freeze({ from: ["pending_review"], to: "published" }),
  reject_submission: Object.freeze({ from: ["pending_review"], to: "unpublished" }),
  approve_version: Object.freeze({ from: ["draft", "pending_review", "published", "unpublished"], to: null }), // applies staged payload; status unchanged
  reject_version: Object.freeze({ from: ["draft", "pending_review", "published", "unpublished"], to: null }), // live listing unchanged
  publish: Object.freeze({ from: ["unpublished"], to: "published" }),
  unpublish: Object.freeze({ from: ["published"], to: "unpublished" }),
  reconfirm: Object.freeze({ from: ["published"], to: "published" }), // refreshes last_directory_reviewed_at
  remove: Object.freeze({ from: ["published", "unpublished", "pending_review"], to: "unpublished" }), // soft removal
});

export const MODERATION_ACTIONS = Object.freeze(Object.keys(MODERATION_TRANSITIONS));

/**
 * Whether an admin action is allowed from a given listing status.
 * Version approve/reject act on the staged version row, so any listing
 * status is acceptable (the version row itself must be pending — enforced
 * in the dscr_review_transition RPC).
 * @param {string} status
 * @param {string} action
 * @returns {boolean}
 */
export function canTransition(status, action) {
  const t = MODERATION_TRANSITIONS[action];
  if (!t) return false;
  return t.from.includes(status);
}

/** Abuse-report validation bounds (DSCR-IMPL-005: fail closed). */
export const REPORT_REASON_MIN = 10;
export const REPORT_REASON_MAX = 2000;
export const REPORT_LIMIT_PER_LENDER_PER_DAY = 1;
export const REPORT_LIMIT_PER_USER_PER_DAY = 10;

/**
 * Validate an abuse report reason. Returns {valid, error}.
 * @param {string} reason
 */
export function validateReport(reason) {
  const r = String(reason ?? "").trim();
  if (r.length < REPORT_REASON_MIN) {
    return {
      valid: false,
      error: `Please describe the problem (at least ${REPORT_REASON_MIN} characters).`,
    };
  }
  if (r.length > REPORT_REASON_MAX) {
    return {
      valid: false,
      error: `Report is too long (max ${REPORT_REASON_MAX} characters).`,
    };
  }
  return { valid: true, error: null };
}

/**
 * Determine whether listing terms are stale.
 * @param {string|Date|null} lastConfirmedAt
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isTermsStale(lastConfirmedAt, now = new Date()) {
  if (!lastConfirmedAt) return true;
  const confirmed = new Date(lastConfirmedAt);
  if (Number.isNaN(confirmed.getTime())) return true;
  const ageMs = now.getTime() - confirmed.getTime();
  return ageMs > STALENESS_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Neutral deterministic default ordering: alphabetical by company name.
 * Must not imply endorsement or ranking.
 * @param {Array<{company_name:string}>} listings
 * @returns {Array}
 */
export function orderListingsNeutral(listings) {
  return [...listings].sort((a, b) =>
    String(a.company_name ?? "").localeCompare(String(b.company_name ?? ""), "en", {
      sensitivity: "base",
    })
  );
}

/**
 * Filter listings by state, loan size, property type, transaction type.
 * Stale listings are excluded from default views unless includeStale is set.
 */
export function filterListings(
  listings,
  { state, minLoan, maxLoan, propertyType, transactionType, includeStale = false } = {}
) {
  return listings.filter((l) => {
    if (!includeStale && isTermsStale(l.last_provider_confirmed_at)) return false;
    if (l.status !== "published") return false;
    if (
      state &&
      !(l.states_served ?? []).some(
        (s) => String(s).toUpperCase() === String(state).toUpperCase()
      )
    )
      return false;
    if (minLoan != null && (l.max_loan_amount ?? Infinity) < minLoan) return false;
    if (maxLoan != null && (l.min_loan_amount ?? 0) > maxLoan) return false;
    if (
      propertyType &&
      !(l.property_types ?? []).includes(propertyType)
    )
      return false;
    if (
      transactionType &&
      !(l.transaction_types ?? []).includes(transactionType)
    )
      return false;
    return true;
  });
}
