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

/** Staged-version request types (DSCR-R1-002). */
export const VERSION_REQUEST_TYPES = Object.freeze({
  term_edit: "term_edit",
  removal_request: "removal_request",
});

/**
 * Freshness-timestamp effects of each moderation transition (DSCR-R1-001,
 * DSCR-R2-001).
 *
 * Authoritative semantics:
 * - last_provider_confirmed_at: the provider last asserted their terms are
 *   current. The public directory (filterListings) hides listings whose
 *   provider confirmation is absent or older than STALENESS_THRESHOLD_DAYS.
 * - last_directory_reviewed_at: the directory admin last reviewed the listing.
 * - applies_terms_as_of: which payload supplies the live terms_as_of_date
 *   ("payload" = the submission row, "version" = the staged version row).
 *
 * Transitions that put (or keep) a listing in front of the public must
 * establish provider-confirmed freshness; otherwise the listing would be
 * published yet invisible in the default directory view. This table mirrors
 * the dscr_review_transition RPC's timestamp behavior.
 *
 * DSCR-R2-001: `publish` refreshes ONLY the directory-review timestamp.
 * Provider freshness is never manufactured by an admin publish action — it
 * comes from a provider assertion (initial submission, approved staged edit)
 * or explicit reviewable evidence. A republished listing whose provider
 * confirmation is stale stays hidden from the default directory until the
 * provider re-asserts. `publish` additionally requires
 * identity_review_status = 'identity-confirmed' (see canPublish), so a
 * rejected initial submission can never reach the public view through it.
 */
export const TRANSITION_FRESHNESS = Object.freeze({
  approve_submission: Object.freeze({
    provider_confirmed: true,
    directory_reviewed: true,
    applies_terms_as_of: "payload",
  }),
  approve_version: Object.freeze({
    provider_confirmed: true,
    directory_reviewed: true,
    applies_terms_as_of: "version",
  }),
  publish: Object.freeze({
    // DSCR-R2-001: publish refreshes the directory-review timestamp only.
    // Provider freshness is never manufactured by an admin publish action.
    provider_confirmed: false,
    directory_reviewed: true,
    applies_terms_as_of: null,
  }),
  reconfirm: Object.freeze({
    provider_confirmed: true,
    directory_reviewed: true,
    applies_terms_as_of: null,
  }),
  reject_submission: Object.freeze({
    provider_confirmed: false,
    directory_reviewed: false,
    applies_terms_as_of: null,
  }),
  reject_version: Object.freeze({
    provider_confirmed: false,
    directory_reviewed: false,
    applies_terms_as_of: null,
  }),
  unpublish: Object.freeze({
    provider_confirmed: false,
    directory_reviewed: false,
    applies_terms_as_of: null,
  }),
  remove: Object.freeze({
    provider_confirmed: false,
    directory_reviewed: false,
    applies_terms_as_of: null,
  }),
});

/**
 * Simulate the freshness-timestamp effects of a moderation transition on a
 * listing object, per TRANSITION_FRESHNESS. Mirrors the dscr_review_transition
 * RPC for transition-to-public-query tests (DSCR-R1-001).
 * @param {object} listing
 * @param {string} action
 * @param {Date} [now]
 * @returns {object} a new listing object with the transition's timestamps applied
 */
export function applyTransitionFreshness(listing, action, now = new Date()) {
  const fx = TRANSITION_FRESHNESS[action];
  const next = { ...listing };
  if (!fx) return next;
  if (fx.provider_confirmed)
    next.last_provider_confirmed_at = now.toISOString();
  if (fx.directory_reviewed)
    next.last_directory_reviewed_at = now.toISOString();
  return next;
}

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

/**
 * Whether the `publish` transition is allowed for a listing (DSCR-R2-001).
 * Mirrors the dscr_review_transition RPC guard: publish fails closed unless
 * the listing is unpublished AND identity was confirmed through
 * approve_submission. A rejected initial submission
 * (identity_review_status = 'pending') can never be published — it must go
 * through approve_submission. Previously approved + administratively
 * unpublished listings (identity-confirmed) keep the republish path.
 * @param {object} listing
 * @returns {boolean}
 */
export function canPublish(listing) {
  if (!listing) return false;
  return (
    listing.status === "unpublished" &&
    listing.identity_review_status === "identity-confirmed"
  );
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
