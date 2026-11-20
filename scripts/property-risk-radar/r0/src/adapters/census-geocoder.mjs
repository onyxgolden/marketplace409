// Census Geocoder adapter contract — onelineaddress, Public_AR_Current
// benchmark. Read-only contract for the R0 offline build. No live call is
// made here.
//
// The geocoder returns an address-range INTERPOLATED result, not a rooftop
// or proof a structure exists. The returned benchmark identity is persisted
// with results; "Current" is mutable.

import { shapeErrors } from "../schemaDigest.mjs";

// The official Census API example address (Census documentation). A public
// example, not a real user's property.
export const EXAMPLE_ADDRESS = "4600 Silver Hill Rd, Washington, DC 20233";

export const CONTRACT = {
  id: "census-geocoder",
  owner: "U.S. Census Bureau",
  product: "Census Geocoder — onelineaddress",
  category: "geocoder",
  adapterVersion: "1.0.0",
  network: {
    hosts: ["geocoding.geo.census.gov"],
    pathPrefixes: ["/geocoder/locations/onelineaddress"],
    method: "GET",
    maxRedirects: 2,
    credentialMode: "none",
  },
  endpoints: {
    metadataUrlTemplate:
      "https://www.census.gov/programs-surveys/geography/technical-documentation/complete-technical-documentation/census-geocoder.html",
    sampleUrlTemplate:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=4600%20Silver%20Hill%20Rd%2C%20Washington%2C%20DC%20233&benchmark=Public_AR_Current&format=json",
  },
  serviceIdentity: {
    service: "Census Geocoder",
    item: "onelineaddress",
    layer: null,
    layerId: null,
  },
  response: {
    format: "json",
    crs: "EPSG:4326",
    requiredFields: [
      "result.input.address",
      "result.input.benchmark",
      "result.addressMatches[].matchedAddress",
      "result.addressMatches[].coordinates",
      "result.addressMatches[].addressComponents",
    ],
    geometryTypes: ["Point"],
  },
  terms: {
    landingUrl:
      "https://www.census.gov/programs-surveys/geography/technical-documentation/complete-technical-documentation/census-geocoder.html",
    termsUrl: "https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html",
    termsDate: "2026-10-16",
    attribution: "U.S. Census Bureau",
    coverage: {
      geographic: "United States street addresses",
      temporal: "Current benchmark (mutable); matched-address vintage per result",
    },
    quota: "UNKNOWN",
  },
  policy: {
    spacingMs: 1000,
    concurrency: 1,
    timeoutMs: 10000,
    caps: { redirects: 2, pages: 1, records: 1, bytes: 5242880, vertices: 0 },
  },
  observationTimeField: "result.addressMatches[].addressComponents (vintage per match)",
  retrievalTimeField: "retrievalTime (recorded by the preflight run, never the source)",
  status: "disabled",
  statusReason:
    "Contract recorded. No live preflight run in the R0 offline build; acceptance pending separately authorized live preflight.",
  killSwitch: true,
  lastPreflight: null,
  liveFixtureStatus: "pending-live-preflight",
  fixtureKind: "synthetic-contract",
};

export const RIGHTS = {
  metadataListing: {
    mode: "allowed",
    receipt: "receipts/census-geocoder.md",
    receiptDate: "2026-11-20",
  },
  imageDisplay: {
    mode: "not_applicable",
    receipt: "receipts/census-geocoder.md",
    receiptDate: "2026-11-20",
  },
  iframeEmbed: {
    mode: "not_applicable",
    receipt: "receipts/census-geocoder.md",
    receiptDate: "2026-11-20",
  },
  hotlinking: {
    mode: "not_applicable",
    receipt: "receipts/census-geocoder.md",
    receiptDate: "2026-11-20",
  },
  proxying: {
    mode: "forbidden",
    receipt: "receipts/census-geocoder.md",
    receiptDate: "2026-11-20",
  },
  caching: {
    mode: "allowed",
    receipt: "receipts/census-geocoder.md",
    receiptDate: "2026-11-20",
  },
  archive: {
    mode: "unknown",
    receipt: "receipts/census-geocoder.md",
    receiptDate: "2026-11-20",
  },
};

export function validateMetadata(metadata) {
  // The Census "metadata" fixture records the documented service surface:
  // the endpoint, the benchmark parameter, and the interpolation limitation.
  const errors = shapeErrors(metadata, [
    { name: "service", type: "string", required: true },
    { name: "benchmark", type: "string", required: true },
    { name: "interpolated", type: "boolean", required: true },
  ], "census-geocoder.metadata");
  if (errors.length > 0) {
    return errors;
  }
  if (metadata.benchmark !== "Public_AR_Current") {
    errors.push(
      "census-geocoder.metadata.benchmark: expected Public_AR_Current",
    );
  }
  if (metadata.interpolated !== true) {
    errors.push(
      "census-geocoder.metadata.interpolated: the geocoder is address-range interpolated, never rooftop",
    );
  }
  return errors;
}

export function validateSample(sample) {
  const errors = shapeErrors(sample, [
    { name: "result", type: "object", required: true },
  ], "census-geocoder.sample");
  if (errors.length > 0) {
    return errors;
  }
  errors.push(...shapeErrors(sample.result, [
    { name: "input", type: "object", required: true },
    { name: "addressMatches", type: "array", required: true },
  ], "census-geocoder.sample.result"));
  if (sample.result.input) {
    errors.push(...shapeErrors(sample.result.input, [
      { name: "address", type: "string", required: true },
      { name: "benchmark", type: "string", required: true },
    ], "census-geocoder.sample.result.input"));
    if (
      sample.result.input.benchmark &&
      sample.result.input.benchmark !== "Public_AR_Current"
    ) {
      errors.push(
        "census-geocoder.sample.result.input.benchmark: expected Public_AR_Current",
      );
    }
  }
  // Zero matches is a VALID result (unmatched address) — distinct from an
  // error. It must never be resolved to a guessed city center.
  sample.result.addressMatches.forEach((match, index) => {
    const label = `census-geocoder.sample.result.addressMatches[${index}]`;
    errors.push(...shapeErrors(match, [
      { name: "matchedAddress", type: "string", required: true },
      { name: "coordinates", type: "object", required: true },
      { name: "addressComponents", type: "object", required: true },
    ], label));
    if (match.coordinates) {
      errors.push(...shapeErrors(match.coordinates, [
        { name: "x", type: "number", required: true },
        { name: "y", type: "number", required: true },
      ], `${label}.coordinates`));
    }
  });
  return errors;
}

export function preflightPlan() {
  return [
    {
      step: 1,
      method: "GET",
      urlTemplate: CONTRACT.endpoints.sampleUrlTemplate,
      purpose: "Geocode the official Census example address; record input/match/components/coordinates/returned benchmark.",
      bounds: { timeoutMs: 10000, bytes: 5242880, records: 1 },
    },
  ];
}
