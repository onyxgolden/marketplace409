/**
 * registry.js — approved-topic registry lookup, applicability
 * determination, trust-chain authentication and cited-claim assembly
 * for the Tax Agent educational prototype.
 *
 * A source with a Git pin is not current or applicable merely because
 * its bytes verify; a registered template is not authority to publish.
 * Every claim is re-resolved and re-verified against the fixture store
 * on every call — nothing here trusts a pre-baked citation.
 */

import { resolveSourceRef, verifySpan, hasReadGrant, ResolutionError, BudgetError } from "./resolver.js";
import { scanSourceText } from "./injection.js";
import { scanPersonalFacts } from "./personal.js";
import { registryEntryDigest, sourceRefDigest } from "./canonical.js";

function isoNoMillis(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const mo = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const da = d.getUTCDate().toString().padStart(2, "0");
  const h = d.getUTCHours().toString().padStart(2, "0");
  const mi = d.getUTCMinutes().toString().padStart(2, "0");
  const s = d.getUTCSeconds().toString().padStart(2, "0");
  return `${y}-${mo}-${da}T${h}:${mi}:${s}Z`;
}

export function findRegistryEntry(registry, topic_id) {
  return registry.find((e) => e.topic_id === topic_id) ?? null;
}

/** Diagnostic helper. */
function diag(code, severity, reason, source_ref = null, record_id = null) {
  return { code, severity, source_ref, record_id, reason };
}

/**
 * Authenticate the steward -> registration -> review-record trust chain
 * for a registry entry, AND independently verify the entry's own content:
 * its registry_ref must resolve through the same granted/hash-verified
 * fixture store used for claims (never trusted unchecked), and its
 * recomputed content digest must equal both the entry's own declared
 * entry_digest and the digest the authenticated registration binds.
 * registry_ref itself is ALSO bound (TAX-002 residual): the registration
 * must commit to a digest of the entry's exact registry_ref SourceRef,
 * not just the entry's content digest — entry_digest deliberately
 * excludes registry_ref, so without this separate check a structurally
 * valid, correctly-digested entry could swap its provenance pointer to
 * a different, independently legitimate, hash-correct fixture source
 * while keeping the same entry_digest and an untouched registration.
 * Matching ID strings alone never authenticates an entry's content —
 * only a syntactically-valid entry whose content digest, registry-ref
 * digest, version, topic_id and jurisdiction are all exactly what the
 * registration approved passes. Returns {ok:true, registrySourceRef} or
 * {ok:false, diagnostic}.
 */
function authenticateChain(entry, ctx, asOfMs, budget) {
  if (!hasReadGrant(entry.registry_ref, ctx.readGrants)) {
    return { ok: false, diagnostic: diag("READ_DENIED", "error", `read grant missing for registry source ${entry.registry_ref.repo}/${entry.registry_ref.path}`, entry.registry_ref) };
  }
  try {
    resolveSourceRef(entry.registry_ref, ctx.sources, budget);
  } catch (e) {
    if (e instanceof ResolutionError) return { ok: false, diagnostic: diag(e.code, "error", `registry source: ${e.message}`, entry.registry_ref) };
    throw e;
  }
  const recomputedDigest = registryEntryDigest(entry);
  if (recomputedDigest !== entry.entry_digest) {
    return { ok: false, diagnostic: diag("HASH_MISMATCH", "error", `registry entry '${entry.topic_id}' content does not match its own declared entry_digest`, entry.registry_ref, entry.topic_id) };
  }

  const steward = ctx.stewards.find((s) => s.steward_id === entry.steward_id);
  if (!steward) return { ok: false, diagnostic: diag("SOURCE_UNVERIFIED", "error", `steward '${entry.steward_id}' not registered`, null, entry.steward_id) };
  if (steward.revoked) return { ok: false, diagnostic: diag("SOURCE_UNVERIFIED", "error", `steward '${steward.steward_id}' is revoked`, null, steward.steward_id) };
  const validFrom = Date.parse(steward.valid_from);
  const expiresAt = Date.parse(steward.expires_at);
  if (!(validFrom <= asOfMs && asOfMs <= expiresAt)) {
    return { ok: false, diagnostic: diag("SOURCE_UNVERIFIED", "error", `steward '${steward.steward_id}' is not valid at the requested as_of_date`, null, steward.steward_id) };
  }

  const registration = ctx.registrations.find((r) => r.registration_ref === entry.registration_ref);
  if (!registration) return { ok: false, diagnostic: diag("SOURCE_UNVERIFIED", "error", `registration '${entry.registration_ref}' not registered`, null, entry.registration_ref) };
  if (registration.steward_id !== entry.steward_id) {
    return { ok: false, diagnostic: diag("SOURCE_UNVERIFIED", "error", `registration '${registration.registration_ref}' does not belong to steward '${entry.steward_id}'`, null, registration.registration_ref) };
  }
  if (registration.revoked) return { ok: false, diagnostic: diag("SOURCE_UNVERIFIED", "error", `registration '${registration.registration_ref}' is revoked`, null, registration.registration_ref) };
  if (!registration.action_ids.includes("register_topic")) {
    return { ok: false, diagnostic: diag("SOURCE_UNVERIFIED", "error", `registration '${registration.registration_ref}' does not authorize register_topic`, null, registration.registration_ref) };
  }
  // The registration must bind THIS exact approved entry — its topic_id,
  // entry_version, jurisdiction, full-content digest, AND the exact
  // registry_ref it is approved to point to — not merely reference the
  // same steward. A syntactically valid entry whose identifiers happen to
  // match a live registration, but whose content or provenance pointer
  // was never what that registration actually approved, is rejected here.
  // registry_ref is checked by digest, not by resolving it again: it was
  // already independently resolved/hash-verified above, so this step
  // only proves it's the SAME source the registration committed to, not
  // some other valid-but-unapproved source swapped in afterward.
  const entryRegistryRefDigest = sourceRefDigest(entry.registry_ref);
  if (
    registration.topic_id !== entry.topic_id ||
    registration.entry_version !== entry.entry_version ||
    registration.jurisdiction !== entry.jurisdiction ||
    registration.entry_digest !== entry.entry_digest ||
    registration.registry_ref_digest !== entryRegistryRefDigest
  ) {
    return { ok: false, diagnostic: diag("SOURCE_UNVERIFIED", "error", `registration '${registration.registration_ref}' does not bind this entry's exact topic_id/entry_version/jurisdiction/content digest/registry source`, null, registration.registration_ref) };
  }
  const regFrom = Date.parse(registration.valid_from);
  const regTo = Date.parse(registration.expires_at);
  if (!(regFrom <= asOfMs && asOfMs <= regTo)) {
    return { ok: false, diagnostic: diag("SOURCE_UNVERIFIED", "error", `registration '${registration.registration_ref}' is not valid at the requested as_of_date`, null, registration.registration_ref) };
  }

  const review = ctx.reviewRecords.find((r) => r.review_record_ref === entry.review_record_ref);
  if (!review) return { ok: false, diagnostic: diag("STALE_EVIDENCE", "error", `review record '${entry.review_record_ref}' not registered`, null, entry.review_record_ref) };
  if (review.topic_id !== entry.topic_id) {
    return { ok: false, diagnostic: diag("STALE_EVIDENCE", "error", `review record '${review.review_record_ref}' does not cover topic '${entry.topic_id}'`, null, review.review_record_ref) };
  }
  if (review.revoked) return { ok: false, diagnostic: diag("STALE_EVIDENCE", "error", `review record '${review.review_record_ref}' is revoked`, null, review.review_record_ref) };
  const reviewedThrough = Date.parse(review.reviewed_through);
  if (asOfMs > reviewedThrough) {
    return { ok: false, diagnostic: diag("STALE_EVIDENCE", "error", `review record '${review.review_record_ref}' reviewed_through has passed as_of_date`, null, review.review_record_ref) };
  }
  // The review record's own registration must independently be live —
  // a revoked/expired registration cannot carry a review's authority
  // even if the review record's own fields look intact (forged chain).
  const reviewReg = ctx.registrations.find((r) => r.registration_ref === review.registration_ref);
  if (!reviewReg || reviewReg.revoked) {
    return { ok: false, diagnostic: diag("SOURCE_UNVERIFIED", "error", `review record '${review.review_record_ref}' registration '${review.registration_ref}' is not live`, null, review.review_record_ref) };
  }

  return { ok: true, registrySourceRef: entry.registry_ref };
}

/**
 * Resolve one claim: read-grant check, source resolution, span
 * verification, and personal-fact/injection scan of the resolved bytes.
 * Returns {ok:true, resolved:{...}} or {ok:false, diagnostic, quarantine}.
 */
function resolveClaim(claim, ctx, budget) {
  const ref = claim.source_ref;
  if (!hasReadGrant(ref, ctx.readGrants)) {
    return { ok: false, diagnostic: diag("READ_DENIED", "error", `read grant missing for ${ref.repo}/${ref.path}`, ref) };
  }
  let resolution;
  try {
    resolution = resolveSourceRef(ref, ctx.sources, budget);
  } catch (e) {
    if (e instanceof ResolutionError) return { ok: false, diagnostic: diag(e.code, "error", e.message, ref) };
    if (e instanceof BudgetError) throw e;
    throw e;
  }
  const sourceScan = scanSourceText(resolution.text);
  const personalScan = scanPersonalFacts(resolution.text);
  if (sourceScan.injected || personalScan.personal) {
    return {
      ok: false,
      quarantine: { repo: ref.repo, path: ref.path },
      diagnostic: sourceScan.injected
        ? diag("INSTRUCTION_INJECTION", "critical", `source ${ref.repo}/${ref.path} contains a seeded directive family; quarantined`, ref)
        : diag("PERSONALIZED_INPUT", "critical", `source ${ref.repo}/${ref.path} contains personal-fact-looking content; quarantined`, ref),
    };
  }
  let span;
  try {
    span = verifySpan(resolution.bytes, claim.text, budget);
  } catch (e) {
    if (e instanceof ResolutionError) return { ok: false, diagnostic: diag(e.code, "error", e.message, ref) };
    if (e instanceof BudgetError) throw e;
    throw e;
  }
  return { ok: true, resolved: { claim, ref, span, text: claim.text } };
}

function buildCitation(resolved, entry, block, task, clock) {
  const { ref, span } = resolved;
  const pathBase = ref.path.split("/").pop().replace(/\.(md|txt)$/, "");
  return {
    repo: ref.repo,
    path: ref.path,
    commit: ref.commit,
    blob: ref.blob,
    algorithm: "git-sha1",
    revision: ref.revision,
    quoted_span: span.quoted_text,
    span,
    source_id: pathBase,
    source_title: `Synthetic educational source — ${entry.topic_label}`,
    official_source_url: null,
    jurisdiction: entry.jurisdiction,
    tax_year_effective: { from: block.tax_year_from, to: block.tax_year_to },
    applicable_from: block.effective_from,
    applicable_to: block.reviewed_through,
    as_of_date: task.as_of_date,
    publication_date: block.effective_from,
    retrieved_at: isoNoMillis(clock),
    reviewed_through: block.reviewed_through,
    query_as_of_date: task.as_of_date,
    verification: "VERIFIED",
    applicability: task.mode === "current_education" ? "APPLICABLE" : "HISTORICAL",
    synthetic: true,
  };
}

/**
 * Assemble a draft (or a blocked/review outcome) for a known registry
 * entry. Returns the agent-field portion of the output envelope; status
 * is always one of DRAFT | REVIEW_REQUIRED | BLOCKED (REFUSED is decided
 * earlier, before this function runs).
 */
export function assembleDraft({ task, entry, ctx, budget, clock }) {
  if (task.topic_label !== entry.topic_label) {
    return blocked("TOPIC_LABEL_MISMATCH", `topic_label does not exactly match the registered title for '${entry.topic_id}'`);
  }

  const block = task.mode === "current_education" ? entry.current : entry.historical;
  if (!block) {
    return blocked("UNKNOWN_DATE_INTERVAL", `no ${task.mode} fixture coverage is registered for topic '${entry.topic_id}'`);
  }

  const yearInBlock = task.tax_year >= block.tax_year_from && task.tax_year <= block.tax_year_to;
  if (!yearInBlock) {
    const otherBlock = task.mode === "current_education" ? entry.historical : entry.current;
    const yearInOther = otherBlock && task.tax_year >= otherBlock.tax_year_from && task.tax_year <= otherBlock.tax_year_to;
    if (task.mode === "current_education" && yearInOther) {
      return blocked("HISTORICAL_AVAILABILITY_ONLY", `tax_year ${task.tax_year} is only available as historical_education coverage (${otherBlock.tax_year_from}-${otherBlock.tax_year_to})`, { historical_from: otherBlock.tax_year_from, historical_to: otherBlock.tax_year_to });
    }
    return blocked("UNKNOWN_DATE_INTERVAL", `tax_year ${task.tax_year} is outside the registered ${task.mode} coverage (${block.tax_year_from}-${block.tax_year_to})`);
  }

  const asOfMs = Date.parse(task.as_of_date);
  const effFrom = Date.parse(block.effective_from);
  const reviewedThrough = Date.parse(block.reviewed_through);
  if (asOfMs < effFrom) {
    return blocked("UNKNOWN_DATE_INTERVAL", `as_of_date predates the registered coverage effective_from (${block.effective_from})`);
  }
  if (asOfMs > reviewedThrough) {
    return blocked("STALE_EVIDENCE", `as_of_date is beyond the registered coverage reviewed_through (${block.reviewed_through})`);
  }

  const chain = authenticateChain(entry, ctx, asOfMs, budget);
  if (!chain.ok) return blockedWithDiagnostic(chain.diagnostic);
  const registrySourceRef = chain.registrySourceRef;

  // Group claims by concept_key: >1 distinct text under one key is a
  // preserved, unresolved contradiction — never averaged or silently merged.
  const byConcept = new Map();
  for (const claim of block.claims) {
    if (!byConcept.has(claim.concept_key)) byConcept.set(claim.concept_key, []);
    byConcept.get(claim.concept_key).push(claim);
  }

  const resolvedClaims = [];
  const citations = [];
  const quarantined = [];
  for (const claim of block.claims) {
    const r = resolveClaim(claim, ctx, budget);
    if (!r.ok) {
      if (r.quarantine) quarantined.push(r.quarantine);
      return blockedWithDiagnostic(r.diagnostic, quarantined);
    }
    const citation = buildCitation(r.resolved, entry, block, task, clock);
    resolvedClaims.push({ claim_id: claim.claim_id, concept_key: claim.concept_key, text: claim.text, citation_ids: [citation.source_id] });
    citations.push(citation);
  }

  let conflict = false;
  for (const [, group] of byConcept) {
    const distinctTexts = new Set(group.map((c) => c.text));
    if (distinctTexts.size > 1) conflict = true;
  }
  if (conflict) {
    return {
      status: "BLOCKED",
      explanation: null,
      claims: resolvedClaims,
      citations,
      registry_match: registryMatch(entry),
      educational_only: true,
      publication_authorized: false,
      published: false,
      expert_review_required: true,
      advice_flags: [],
      referral: null,
      applicability_summary: { mode: task.mode, tax_year: task.tax_year, jurisdiction: task.jurisdiction, coverage: task.mode === "current_education" ? "current" : "historical" },
      // `historical` identifies a historical DRAFT specifically — this
      // outcome is BLOCKED, never a draft, so it is always false here
      // regardless of which mode was requested.
      historical: false,
      uncertainty_flags: ["CONFLICTING_SOURCES"],
      _diagnostics: [diag("CONFLICTING_SOURCES", "error", "contradictory synthetic claims under the same concept_key; both preserved, neither selected")],
      _quarantined: [],
      _registry_source_ref: registrySourceRef,
    };
  }

  const explanation = `SYNTHETIC EDUCATIONAL EXAMPLE — NOT TAX GUIDANCE. ${resolvedClaims.map((c) => c.text).join(" ")} DRAFT — NOT PUBLISHED.`;
  return {
    status: "DRAFT",
    explanation,
    claims: resolvedClaims,
    citations,
    registry_match: registryMatch(entry),
    educational_only: true,
    publication_authorized: false,
    published: false,
    expert_review_required: false,
    advice_flags: [],
    referral: null,
    applicability_summary: { mode: task.mode, tax_year: task.tax_year, jurisdiction: task.jurisdiction, coverage: task.mode === "current_education" ? "current" : "historical" },
    historical: task.mode === "historical_education",
    uncertainty_flags: [],
    _diagnostics: [],
    _quarantined: [],
    _complete: true,
    _registry_source_ref: registrySourceRef,
  };

  function blocked(code, reason, extra = {}) {
    return blockedWithDiagnostic(diag(code, "error", reason), [], extra);
  }
  function blockedWithDiagnostic(diagnostic, quarantine = [], extra = {}) {
    return {
      status: "BLOCKED",
      explanation: null,
      claims: [],
      citations: [],
      registry_match: registryMatch(entry),
      educational_only: true,
      publication_authorized: false,
      published: false,
      expert_review_required: true,
      advice_flags: [],
      referral: null,
      applicability_summary: { mode: task.mode, tax_year: task.tax_year, jurisdiction: task.jurisdiction, coverage: "none", ...extra },
      // Same rule: BLOCKED is never a draft, so never a historical DRAFT.
      historical: false,
      uncertainty_flags: [diagnostic.code],
      _diagnostics: [diagnostic],
      _quarantined: quarantine,
      _registry_source_ref: null,
    };
  }
}

function registryMatch(entry) {
  return {
    topic_id: entry.topic_id,
    registry_ref: `${entry.topic_id}@${entry.entry_version}`,
    entry_version: entry.entry_version,
    registration_ref: entry.registration_ref,
    review_record_ref: entry.review_record_ref,
  };
}

export function reviewRequiredUnknownTopic(task) {
  return {
    status: "REVIEW_REQUIRED",
    explanation: null,
    claims: [],
    citations: [],
    registry_match: null,
    educational_only: true,
    publication_authorized: false,
    published: false,
    expert_review_required: true,
    advice_flags: [],
    referral: null,
    applicability_summary: { mode: task.mode, tax_year: task.tax_year, jurisdiction: task.jurisdiction, coverage: "none" },
    historical: false,
    uncertainty_flags: ["UNREGISTERED_TOPIC"],
    _diagnostics: [diag("UNSUPPORTED_TASK", "warning", `topic_id '${task.topic_id}' is not a registered approved topic; routed to review`, null)],
    _quarantined: [],
    _registry_source_ref: null,
  };
}
