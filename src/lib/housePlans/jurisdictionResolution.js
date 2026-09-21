// HOUSE PLANS (HP-L5) jurisdiction resolution.
//
// Link-only scope: resolves user-provided project coordinates to FACTUAL
// jurisdiction geography (state, county, incorporated place) via the
// US Census Geocoder -- a free public factual source, no key required.
// FORGE records what the geocoder reports the location is inside; it never
// interprets which building code, authority, or requirement applies to the
// project. No compliance/check engine, no regulatory text.
//
// Jurisdiction-state contract (vocabulary shared with HP-L1):
//   UNRESOLVED       -- no usable geography (or nothing attempted yet)
//   LIKELY           -- the furthest this slice auto-advances: the Census
//                       Geocoder returned usable state/county/place facts
//   CONFIRMED_BY_USER-- only via confirmJurisdictionByUser() with an
//                       explicit user confirmation; never automatic
//   VERIFIED_SOURCE  -- reserved for later slices with an official source;
//                       HP-L5 never assigns it
//
// This module is pure: no I/O, no DB, no network. The route performs the
// single authorized Census Geocoder call; coordinates are never sent to
// analytics or any other third party.

import { JURISDICTION_STATES } from "./regulatorySource";

export const CENSUS_GEOCODER_BASE_URL =
  "https://geocoding.geo.census.gov/geocoder/geographies/coordinates";
export const CENSUS_BENCHMARK = "Public_AR_Current";
export const CENSUS_VINTAGE = "Current_Current";
export const JURISDICTION_PROVENANCE = "US Census Geocoder";

// Census Geocoder layer keys we read. "Incorporated Places" is present for
// locations inside a city/town; some unincorporated communities appear under
// "Census Designated Places" instead. Anything else is ignored.
const PLACE_LAYERS = Object.freeze(["Incorporated Places", "Census Designated Places"]);

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// Pure validation of user-provided coordinates. Returns { ok, errors }.
// Never throws on malformed input.
export function validateCoordinates(input) {
  const errors = [];
  const record = typeof input === "object" && input !== null && !Array.isArray(input) ? input : {};
  const { latitude, longitude } = record;

  if (!isFiniteNumber(latitude) || latitude < -90 || latitude > 90) {
    errors.push('"latitude" must be a number between -90 and 90');
  }
  if (!isFiniteNumber(longitude) || longitude < -180 || longitude > 180) {
    errors.push('"longitude" must be a number between -180 and 180');
  }
  return { ok: errors.length === 0, errors };
}

// Pure URL builder for the Census Geocoder coordinate lookup. The caller
// (route) performs the fetch; building the URL stays unit-testable here.
export function buildCensusGeocoderUrl(latitude, longitude) {
  const params = new URLSearchParams({
    x: String(longitude),
    y: String(latitude),
    benchmark: CENSUS_BENCHMARK,
    vintage: CENSUS_VINTAGE,
    format: "json",
  });
  return `${CENSUS_GEOCODER_BASE_URL}?${params.toString()}`;
}

function firstItem(payload, layer) {
  const layers = payload?.result?.geographies;
  if (typeof layers !== "object" || layers === null) return null;
  const items = layers[layer];
  if (!Array.isArray(items) || items.length === 0) return null;
  const item = items[0];
  return typeof item === "object" && item !== null ? item : null;
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function geographyEntry(item, nameKeys) {
  if (!item) return null;
  const name = nameKeys.map((key) => text(item[key])).find(Boolean) || null;
  const fips = text(item.GEOID);
  if (!name && !fips) return null;
  return Object.freeze({ name, fips });
}

// Pure extraction of factual geography from a Census Geocoder response.
// Returns { ok: true, geography } or { ok: false, errors }. Never throws,
// even on malformed payloads. Factual fields only: names + FIPS codes.
export function parseCensusGeographies(payload) {
  const stateItem = firstItem(payload, "States");
  const countyItem = firstItem(payload, "Counties");
  const subdivisionItem = firstItem(payload, "County Subdivisions");
  const tractItem = firstItem(payload, "Census Tracts");
  let placeItem = null;
  for (const layer of PLACE_LAYERS) {
    placeItem = firstItem(payload, layer);
    if (placeItem) break;
  }

  const state = geographyEntry(stateItem, ["NAME", "BASENAME"]);
  const county = geographyEntry(countyItem, ["NAME", "BASENAME"]);
  const place = geographyEntry(placeItem, ["NAME", "BASENAME"]);
  const countySubdivision = geographyEntry(subdivisionItem, ["NAME", "BASENAME"]);
  const tract = geographyEntry(tractItem, ["NAME", "BASENAME"]);

  if (!state && !county && !place) {
    return { ok: false, errors: ["Census Geocoder returned no usable state, county, or place geography"] };
  }

  const stateWithAbbreviation = state
    ? Object.freeze({ ...state, abbreviation: text(stateItem.STUSAB) })
    : null;

  return {
    ok: true,
    geography: Object.freeze({
      state: stateWithAbbreviation,
      county,
      place,
      countySubdivision,
      tract,
    }),
  };
}

function freezeResolution(record) {
  return Object.freeze({
    jurisdictionState: record.jurisdictionState,
    geography: record.geography ? Object.freeze({ ...record.geography }) : null,
    provenance: record.provenance,
    retrievedAt: record.retrievedAt,
    latitude: record.latitude,
    longitude: record.longitude,
  });
}

// Builds the LIKELY resolution from parsed geography facts. This is the
// furthest HP-L5 auto-advances a project: UNRESOLVED -> LIKELY.
export function buildLikelyJurisdiction(geography, options = {}) {
  const retrievedAt =
    typeof options.retrievedAt === "string" && options.retrievedAt.trim().length > 0
      ? options.retrievedAt.trim()
      : new Date().toISOString();
  return freezeResolution({
    jurisdictionState: JURISDICTION_STATES.LIKELY,
    geography: geography || null,
    provenance: JURISDICTION_PROVENANCE,
    retrievedAt,
    latitude: isFiniteNumber(options.latitude) ? options.latitude : null,
    longitude: isFiniteNumber(options.longitude) ? options.longitude : null,
  });
}

// UNRESOLVED resolution: the geocoder returned nothing usable (or the
// lookup failed). Factual about the attempt, not a determination.
export function unresolvedJurisdiction(options = {}) {
  const retrievedAt =
    typeof options.retrievedAt === "string" && options.retrievedAt.trim().length > 0
      ? options.retrievedAt.trim()
      : new Date().toISOString();
  const reason =
    typeof options.reason === "string" && options.reason.trim().length > 0
      ? options.reason.trim()
      : "no usable geography returned";
  return Object.freeze({
    jurisdictionState: JURISDICTION_STATES.UNRESOLVED,
    geography: null,
    provenance: JURISDICTION_PROVENANCE,
    retrievedAt,
    latitude: isFiniteNumber(options.latitude) ? options.latitude : null,
    longitude: isFiniteNumber(options.longitude) ? options.longitude : null,
    reason,
  });
}

// Explicit user confirmation is the ONLY path to CONFIRMED_BY_USER.
// confirmed must be exactly true; anything else returns the input
// unchanged. Never throws.
export function confirmJurisdictionByUser(resolution, options = {}) {
  if (!resolution || typeof resolution !== "object") return resolution;
  if (options.confirmed !== true) return resolution;
  if (
    resolution.jurisdictionState !== JURISDICTION_STATES.LIKELY &&
    resolution.jurisdictionState !== JURISDICTION_STATES.UNRESOLVED
  ) {
    return resolution;
  }
  return Object.freeze({ ...resolution, jurisdictionState: JURISDICTION_STATES.CONFIRMED_BY_USER });
}

// Factual display label from a resolution record: "Austin city,
// Travis County, Texas". Descriptive only -- never a compliance statement.
export function jurisdictionDisplayLabel(resolution) {
  const geography = resolution?.geography;
  if (!geography) return "Jurisdiction unresolved";
  const parts = [];
  if (geography.place?.name) parts.push(geography.place.name);
  if (geography.county?.name) parts.push(geography.county.name);
  if (geography.state?.name) parts.push(geography.state.name);
  return parts.length > 0 ? parts.join(", ") : "Jurisdiction unresolved";
}
