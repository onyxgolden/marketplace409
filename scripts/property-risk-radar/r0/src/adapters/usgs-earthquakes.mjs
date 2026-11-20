// USGS earthquake adapter contract — summary GeoJSON feed, last 24h.
// Read-only contract for the R0 offline build. No live call is made here.

import { shapeErrors, isLngLat } from "../schemaDigest.mjs";

export const CONTRACT = {
  id: "usgs-earthquakes",
  owner: "U.S. Geological Survey",
  product: "USGS Earthquake Hazards Program — summary feeds",
  category: "hazard-data",
  adapterVersion: "1.0.0",
  network: {
    hosts: ["earthquake.usgs.gov"],
    pathPrefixes: ["/earthquakes/feed/v1.0/summary/"],
    method: "GET",
    maxRedirects: 2,
    credentialMode: "none",
  },
  endpoints: {
    metadataUrlTemplate:
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php",
    sampleUrlTemplate:
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
  },
  serviceIdentity: {
    service: "USGS GeoJSON summary feed",
    item: "all_day",
    layer: null,
    layerId: null,
  },
  response: {
    format: "geojson",
    crs: "EPSG:4326",
    requiredFields: [
      "metadata.generated",
      "metadata.count",
      "features[].geometry.coordinates",
      "features[].properties.mag",
      "features[].properties.place",
      "features[].properties.time",
      "features[].properties.updated",
    ],
    geometryTypes: ["Point"],
  },
  terms: {
    landingUrl: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php",
    termsUrl:
      "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits",
    termsDate: "2026-10-16",
    attribution: "U.S. Geological Survey",
    coverage: {
      geographic: "Global (feed is worldwide; FORGE use is US-focused)",
      temporal: "Last 24 hours in all_day; generated time is source time",
    },
    quota: "UNKNOWN",
  },
  policy: {
    spacingMs: 60000,
    concurrency: 1,
    timeoutMs: 10000,
    caps: { redirects: 2, pages: 1, records: 10000, bytes: 5242880, vertices: 500000 },
  },
  observationTimeField: "features[].properties.time",
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
    receipt: "receipts/usgs-earthquakes.md",
    receiptDate: "2026-11-20",
  },
  imageDisplay: {
    mode: "not_applicable",
    receipt: "receipts/usgs-earthquakes.md",
    receiptDate: "2026-11-20",
  },
  iframeEmbed: {
    mode: "not_applicable",
    receipt: "receipts/usgs-earthquakes.md",
    receiptDate: "2026-11-20",
  },
  hotlinking: {
    mode: "not_applicable",
    receipt: "receipts/usgs-earthquakes.md",
    receiptDate: "2026-11-20",
  },
  proxying: {
    mode: "forbidden",
    receipt: "receipts/usgs-earthquakes.md",
    receiptDate: "2026-11-20",
  },
  caching: {
    mode: "allowed",
    receipt: "receipts/usgs-earthquakes.md",
    receiptDate: "2026-11-20",
  },
  archive: {
    mode: "unknown",
    receipt: "receipts/usgs-earthquakes.md",
    receiptDate: "2026-11-20",
  },
};

export function validateMetadata(metadata) {
  const errors = shapeErrors(metadata, [
    { name: "generated", type: "number", required: true },
    { name: "count", type: "number", required: true },
  ], "usgs-earthquakes.metadata");
  return errors;
}

export function validateSample(sample) {
  const errors = shapeErrors(sample, [
    { name: "type", type: "string", required: true },
    { name: "metadata", type: "object", required: true },
    { name: "features", type: "array", required: true },
  ], "usgs-earthquakes.sample");
  if (errors.length > 0) {
    return errors;
  }
  if (sample.type !== "FeatureCollection") {
    errors.push("usgs-earthquakes.sample.type: expected FeatureCollection");
    return errors;
  }
  errors.push(...validateMetadata(sample.metadata));
  if (sample.metadata.count !== sample.features.length) {
    errors.push(
      "usgs-earthquakes.sample: metadata.count does not match features length",
    );
  }
  sample.features.forEach((feature, index) => {
    const label = `usgs-earthquakes.sample.features[${index}]`;
    if (!feature.geometry || feature.geometry.type !== "Point") {
      errors.push(`${label}.geometry: expected a Point geometry`);
    } else if (!isLngLat(feature.geometry.coordinates)) {
      errors.push(`${label}.geometry.coordinates: expected [lng, lat] in WGS84 range`);
    }
    if (feature.properties) {
      errors.push(...shapeErrors(feature.properties, [
        { name: "mag", type: "number", required: true },
        { name: "place", type: "string", required: true },
        { name: "time", type: "number", required: true },
        { name: "updated", type: "number", required: true },
        { name: "type", type: "string", required: true },
      ], `${label}.properties`));
    } else {
      errors.push(`${label}.properties: missing required field`);
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
      purpose: "Fetch the bounded all_day GeoJSON summary feed.",
      bounds: { timeoutMs: 10000, bytes: 5242880, records: 10000 },
    },
  ];
}
