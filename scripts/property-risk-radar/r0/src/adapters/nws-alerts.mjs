// NWS alerts adapter contract — National Weather Service api.weather.gov.
// Read-only contract for the R0 offline build. No live call is made here;
// preflightPlan() only DESCRIBES the bounded calls a separately authorized
// live preflight would make.

import { shapeErrors, isLngLat } from "../schemaDigest.mjs";

export const CONTRACT = {
  id: "nws-alerts",
  owner: "NOAA / National Weather Service",
  product: "NWS API — active alerts",
  category: "hazard-data",
  adapterVersion: "1.0.0",
  network: {
    hosts: ["api.weather.gov"],
    pathPrefixes: ["/openapi.json", "/alerts/"],
    method: "GET",
    maxRedirects: 2,
    credentialMode: "none",
  },
  endpoints: {
    metadataUrlTemplate: "https://api.weather.gov/openapi.json",
    sampleUrlTemplate:
      "https://api.weather.gov/alerts/active?status=actual&message_type=alert",
  },
  serviceIdentity: {
    service: "NWS API",
    item: null,
    layer: null,
    layerId: null,
  },
  response: {
    format: "geojson",
    crs: "EPSG:4326",
    requiredFields: [
      "features[].id",
      "features[].properties.status",
      "features[].properties.messageType",
      "features[].properties.effective",
      "features[].properties.expires",
      "features[].properties.areaDesc",
    ],
    geometryTypes: ["Polygon", "MultiPolygon", null],
  },
  terms: {
    landingUrl: "https://www.weather.gov/documentation/services-web-api",
    termsUrl: "https://www.weather.gov/disclaimer",
    termsDate: "2026-10-16",
    attribution: "National Weather Service (NOAA)",
    coverage: {
      geographic: "United States (CONUS, AK, HI, territories)",
      temporal: "Current active alerts; validity per alert effective/expires",
    },
    quota: "UNKNOWN",
  },
  policy: {
    spacingMs: 30000,
    concurrency: 1,
    timeoutMs: 10000,
    caps: { redirects: 2, pages: 1, records: 1000, bytes: 5242880, vertices: 500000 },
  },
  observationTimeField: "features[].properties.effective",
  retrievalTimeField: "retrievalTime (recorded by the preflight run, never the source)",
  status: "accepted",
  statusReason: "Live preflight 2026-11-20T19:20:44.232Z passed under Jason's authorization; current live fixture recorded.",
  killSwitch: true,
  lastPreflight: "2026-11-20T19:20:44.232Z",
  liveFixtureStatus: "live",
  fixtureKind: "live",
};

export const RIGHTS = {
  metadataListing: {
    mode: "allowed",
    receipt: "receipts/nws-alerts.md",
    receiptDate: "2026-11-20",
  },
  imageDisplay: {
    mode: "not_applicable",
    receipt: "receipts/nws-alerts.md",
    receiptDate: "2026-11-20",
  },
  iframeEmbed: {
    mode: "not_applicable",
    receipt: "receipts/nws-alerts.md",
    receiptDate: "2026-11-20",
  },
  hotlinking: {
    mode: "not_applicable",
    receipt: "receipts/nws-alerts.md",
    receiptDate: "2026-11-20",
  },
  proxying: {
    mode: "forbidden",
    receipt: "receipts/nws-alerts.md",
    receiptDate: "2026-11-20",
  },
  caching: {
    mode: "allowed",
    receipt: "receipts/nws-alerts.md",
    receiptDate: "2026-11-20",
  },
  archive: {
    mode: "unknown",
    receipt: "receipts/nws-alerts.md",
    receiptDate: "2026-11-20",
  },
};

// The OpenAPI document is metadata, not data. We validate only that it is
// an OpenAPI document for api.weather.gov — the full endpoint surface is
// pinned by the adapter contract, not by trusting the live document.
export function validateMetadata(metadata) {
  const errors = shapeErrors(metadata, [
    { name: "openapi", type: "string", required: true },
    { name: "info", type: "object", required: true },
    { name: "paths", type: "object", required: true },
  ], "nws-alerts.metadata");
  if (errors.length > 0) {
    return errors;
  }
  if (!metadata.openapi.startsWith("3.")) {
    errors.push("nws-alerts.metadata.openapi: expected OpenAPI 3.x document");
  }
  if (!Object.prototype.hasOwnProperty.call(metadata.paths, "/alerts/active")) {
    errors.push("nws-alerts.metadata.paths: missing /alerts/active path");
  }
  return errors;
}

const ALERT_STATUSES = ["Actual", "Exercise", "System", "Test", "Draft"];
const ALERT_MESSAGE_TYPES = ["Alert", "Update", "Cancel"];

export function validateSample(sample) {
  const errors = shapeErrors(sample, [
    { name: "type", type: "string", required: true },
    { name: "features", type: "array", required: true },
  ], "nws-alerts.sample");
  if (errors.length > 0) {
    return errors;
  }
  if (sample.type !== "FeatureCollection") {
    errors.push("nws-alerts.sample.type: expected FeatureCollection");
    return errors;
  }
  sample.features.forEach((feature, index) => {
    const label = `nws-alerts.sample.features[${index}]`;
    errors.push(...shapeErrors(feature, [
      { name: "type", type: "string", required: true },
      { name: "id", type: "string", required: true },
      { name: "properties", type: "object", required: true },
    ], label));
    if (feature.properties) {
      const props = feature.properties;
      errors.push(...shapeErrors(props, [
        { name: "status", type: "string", required: true, enum: ALERT_STATUSES },
        { name: "messageType", type: "string", required: true, enum: ALERT_MESSAGE_TYPES },
        { name: "effective", type: "string", required: true },
        { name: "expires", type: "string", required: true },
        { name: "areaDesc", type: "string", required: true },
      ], `${label}.properties`));
    }
    // Geometry may be null (zone-only warning): the key must exist, but a
    // null geometry is a valid observation, never proof of "no warning".
    if (feature.geometry !== null && feature.geometry !== undefined) {
      if (!["Polygon", "MultiPolygon"].includes(feature.geometry.type)) {
        errors.push(`${label}.geometry.type: expected Polygon or MultiPolygon`);
      }
    }
  });
  return errors;
}

export function preflightPlan() {
  return [
    {
      step: 1,
      method: "GET",
      urlTemplate: CONTRACT.endpoints.metadataUrlTemplate,
      purpose: "Fetch the NWS OpenAPI document and digest it.",
      bounds: { timeoutMs: 10000, bytes: 5242880 },
    },
    {
      step: 2,
      method: "GET",
      urlTemplate: CONTRACT.endpoints.sampleUrlTemplate,
      purpose: "Fetch the bounded active-alerts FeatureCollection.",
      bounds: { timeoutMs: 10000, bytes: 5242880, records: 1000 },
      headers: { Accept: "application/geo+json" },
    },
  ];
}

// A synthetic sample is not live evidence. Fixture helpers keep that
// distinction explicit for tests and the report.
export function isSyntheticFixture(sample) {
  return sample && sample.synthetic === true;
}

export { isLngLat };
