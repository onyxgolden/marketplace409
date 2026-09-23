// HOUSE PLANS (HP-L6) Texas reference seed — curated official-source index.
//
// This module is the single source of truth for the HP-L6 Texas reference
// set: FACTUAL METADATA ONLY (titles, section identifiers, issuing
// authority/jurisdiction, official URLs, topic tags, provenance,
// retrieval/verification dates). It contains no summaries, no code text, no
// paraphrase, and no interpretation — FORGE links to official sources; it
// never authors or reproduces explanatory text about regulatory
// requirements.
//
// Curated index, not a completeness claim: this is a small set of official
// Texas and Southeast-Texas municipal sources verified by hand. It is NOT
// "Texas building requirements", NOT "required Texas codes", and NOT a
// complete index of Texas regulations. Municipal entries are directory
// entries (authority + topic), never statements about what a city requires
// for any project.
//
// The SQL seed migration (supabase/migrations/*_seed_texas_regulatory_sources.sql)
// is generated from TEXAS_SOURCES_SEED so the two cannot drift: a test
// asserts every seed URL appears in the migration exactly once.
//
// sourceType lives seed-side only in HP-L6 (statute / agency_resource /
// municipal_reference) and drives the UI badges that keep the three kinds
// visually distinct. The production table has no source_type column; if a
// later slice adds non-seed sources, that slice should add the column via
// its own migration.

import {
  FORBIDDEN_CONTENT_FIELDS,
  JURISDICTION_STATES,
  validateRegulatorySource,
} from "./regulatorySource";

export const SOURCE_TYPES = Object.freeze({
  STATUTE: "statute",
  AGENCY_RESOURCE: "agency_resource",
  MUNICIPAL_REFERENCE: "municipal_reference",
});

export const SOURCE_TYPE_LABELS = Object.freeze({
  [SOURCE_TYPES.STATUTE]: "Statute",
  [SOURCE_TYPES.AGENCY_RESOURCE]: "Agency resource",
  [SOURCE_TYPES.MUNICIPAL_REFERENCE]: "Municipal reference",
});

// Seed entries use the camelCase domain record shape from regulatorySource.js
// plus sourceType. Frozen: the curated index is fixed data.
export const TEXAS_SOURCES_SEED = Object.freeze([
  Object.freeze({
    title:
      "Texas Local Government Code — Chapter 214, Municipal Regulation of Housing and Other Structures",
    sectionIdentifier: "§214.212",
    issuingAuthority: "Texas Legislature",
    jurisdiction: "Texas",
    edition: null,
    effectiveDate: null,
    officialUrl: "https://statutes.capitol.texas.gov/Docs/LG/htm/LG.214.htm",
    topicTags: Object.freeze(["building-codes", "municipal-authority"]),
    provenance: "Official site of the Texas Legislature",
    retrievalDate: "2026-09-23",
    verificationDate: "2026-09-23",
    jurisdictionState: JURISDICTION_STATES.VERIFIED_SOURCE,
    sourceType: SOURCE_TYPES.STATUTE,
  }),
  Object.freeze({
    title: "What you need to know about windstorm inspections",
    sectionIdentifier: null,
    issuingAuthority: "Texas Department of Insurance",
    jurisdiction: "Texas",
    edition: null,
    effectiveDate: null,
    officialUrl: "https://tdi.texas.gov/tips/need-windstorm-inspection.html",
    topicTags: Object.freeze(["windstorm", "inspections"]),
    provenance: "Texas Department of Insurance",
    retrievalDate: "2026-09-23",
    verificationDate: "2026-09-23",
    jurisdictionState: JURISDICTION_STATES.VERIFIED_SOURCE,
    sourceType: SOURCE_TYPES.AGENCY_RESOURCE,
  }),
  Object.freeze({
    title: "TDI Product Evaluations index",
    sectionIdentifier: null,
    issuingAuthority: "Texas Department of Insurance",
    jurisdiction: "Texas",
    edition: null,
    effectiveDate: null,
    officialUrl: "https://tdi.texas.gov/wind/prod/index.html",
    topicTags: Object.freeze(["windstorm", "windows", "doors"]),
    provenance: "Texas Department of Insurance",
    retrievalDate: "2026-09-23",
    verificationDate: "2026-09-23",
    jurisdictionState: JURISDICTION_STATES.VERIFIED_SOURCE,
    sourceType: SOURCE_TYPES.AGENCY_RESOURCE,
  }),
  Object.freeze({
    title: "WPI-8 windstorm inspection fact sheet",
    sectionIdentifier: null,
    issuingAuthority: "Texas Department of Insurance",
    jurisdiction: "Texas",
    edition: null,
    effectiveDate: null,
    officialUrl: "https://tdi.texas.gov/WIND/documents/WPI-8-fact-sheet-eng-sp.pdf",
    topicTags: Object.freeze(["windstorm", "inspections"]),
    provenance: "Texas Department of Insurance",
    retrievalDate: "2026-09-23",
    verificationDate: "2026-09-23",
    jurisdictionState: JURISDICTION_STATES.VERIFIED_SOURCE,
    sourceType: SOURCE_TYPES.AGENCY_RESOURCE,
  }),
  Object.freeze({
    title: "Building Codes — City of Beaumont",
    sectionIdentifier: null,
    issuingAuthority: "City of Beaumont",
    jurisdiction: "Beaumont, Texas",
    edition: null,
    effectiveDate: null,
    officialUrl: "https://beaumonttexas.gov/707/Building-Codes",
    topicTags: Object.freeze(["building-codes", "permits", "inspections"]),
    provenance: "City of Beaumont",
    retrievalDate: "2026-09-23",
    verificationDate: "2026-09-23",
    jurisdictionState: JURISDICTION_STATES.VERIFIED_SOURCE,
    sourceType: SOURCE_TYPES.MUNICIPAL_REFERENCE,
  }),
  Object.freeze({
    title: "Adopted Building Codes — City of Beaumont",
    sectionIdentifier: null,
    issuingAuthority: "City of Beaumont",
    jurisdiction: "Beaumont, Texas",
    edition: null,
    effectiveDate: null,
    officialUrl: "https://beaumonttexas.gov/160/Adopted-Building-Codes",
    topicTags: Object.freeze(["building-codes", "residential-code"]),
    provenance: "City of Beaumont",
    retrievalDate: "2026-09-23",
    verificationDate: "2026-09-23",
    jurisdictionState: JURISDICTION_STATES.VERIFIED_SOURCE,
    sourceType: SOURCE_TYPES.MUNICIPAL_REFERENCE,
  }),
  Object.freeze({
    title: "City of Port Arthur — official website",
    sectionIdentifier: null,
    issuingAuthority: "City of Port Arthur",
    jurisdiction: "Port Arthur, Texas",
    edition: null,
    effectiveDate: null,
    officialUrl: "https://www.portarthurtx.gov/",
    topicTags: Object.freeze(["building-codes", "permits"]),
    provenance: "City of Port Arthur — see the Permits & Inspections department",
    retrievalDate: "2026-09-23",
    verificationDate: "2026-09-23",
    jurisdictionState: JURISDICTION_STATES.VERIFIED_SOURCE,
    sourceType: SOURCE_TYPES.MUNICIPAL_REFERENCE,
  }),
]);

// Seed-side source-type lookup for UI badges: official URL -> sourceType.
// Only curated seed URLs resolve; anything else returns null (never guessed).
const SOURCE_TYPE_BY_URL = new Map(
  TEXAS_SOURCES_SEED.map((entry) => [entry.officialUrl, entry.sourceType])
);

export function sourceTypeForUrl(url) {
  if (typeof url !== "string") return null;
  return SOURCE_TYPE_BY_URL.get(url.trim()) || null;
}

// Source-validation discipline (review requirement): official sources only.
// https required; hostnames must be official government domains (or on the
// explicit allowlist for city sites); URL shorteners and third-party
// mirrors are rejected. Pure function — unit tested against every seed URL.
const KNOWN_SHORTENERS = Object.freeze([
  "bit.ly",
  "tinyurl.com",
  "goo.gl",
  "t.co",
  "ow.ly",
  "is.gd",
  "buff.ly",
]);

const EXPLICIT_OFFICIAL_DOMAINS = Object.freeze([
  "statutes.capitol.texas.gov",
  "capitol.texas.gov",
  "tdi.texas.gov",
  "appscenter.tdi.texas.gov",
  "beaumonttexas.gov",
  "www.beaumonttexas.gov",
  "portarthurtx.gov",
  "www.portarthurtx.gov",
]);

export function isAllowedSourceUrl(value) {
  if (typeof value !== "string") return false;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (KNOWN_SHORTENERS.includes(host)) return false;
  if (EXPLICIT_OFFICIAL_DOMAINS.includes(host)) return true;
  // Any other official government hostname (.gov / .texas.gov) is allowed;
  // third-party mirrors and commercial domains are not.
  return host.endsWith(".gov") || host.endsWith(".texas.gov");
}

// Full seed validation: metadata-only shape (via validateRegulatorySource),
// a known sourceType, and an allowed official URL. Returns { ok, errors }.
export function validateSeedEntry(entry) {
  const errors = [];
  const result = validateRegulatorySource(entry);
  if (!result.ok) errors.push(...result.errors);
  if (!Object.values(SOURCE_TYPES).includes(entry?.sourceType)) {
    errors.push(
      `"sourceType" must be one of: ${Object.values(SOURCE_TYPES).join(", ")}`
    );
  }
  if (!isAllowedSourceUrl(entry?.officialUrl)) {
    errors.push(
      `"officialUrl" must be an https URL on an official government domain (no shorteners, no third-party mirrors)`
    );
  }
  return { ok: errors.length === 0, errors };
}

// Builds the DB row objects (snake_case) for one owner. Pure: used by the
// migration generator and by the idempotency test. The SQL migration is
// generated from this function's output so the two cannot drift.
export function buildSeedRows(ownerId) {
  return TEXAS_SOURCES_SEED.map((entry) => ({
    owner_id: ownerId,
    title: entry.title,
    section_identifier: entry.sectionIdentifier,
    issuing_authority: entry.issuingAuthority,
    jurisdiction: entry.jurisdiction,
    edition: entry.edition,
    effective_date: entry.effectiveDate,
    official_url: entry.officialUrl,
    topic_tags: [...entry.topicTags],
    provenance: entry.provenance,
    retrieval_date: entry.retrievalDate,
    verification_date: entry.verificationDate,
    jurisdiction_state: entry.jurisdictionState,
  }));
}

// Guards the metadata-only boundary at the module level: no seed entry may
// carry explanatory-text fields, even though validateRegulatorySource would
// also reject them.
export function assertNoForbiddenFields() {
  const violations = [];
  TEXAS_SOURCES_SEED.forEach((entry, index) => {
    for (const field of FORBIDDEN_CONTENT_FIELDS) {
      if (entry[field] !== undefined && entry[field] !== null) {
        violations.push(`seed[${index}].${field}`);
      }
    }
  });
  return violations;
}
