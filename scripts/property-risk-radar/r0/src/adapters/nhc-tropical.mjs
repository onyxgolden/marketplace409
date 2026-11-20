// NHC tropical adapter contract — NOAA operational tropical MapServer.
// Read-only contract for the R0 offline build. No live call is made here.
// Storms are tracked by stormID + advisory, never by reused AT1/AT2 slots.

import { shapeErrors, checkDeclaredResponsePaths } from "../schemaDigest.mjs";

export const CONTRACT = {
  id: "nhc-tropical",
  owner: "NOAA / National Hurricane Center",
  product: "NHC Tropical Weather — operational MapServer",
  category: "hazard-data",
  adapterVersion: "1.0.0",
  network: {
    hosts: ["mapservices.weather.noaa.gov"],
    pathPrefixes: ["/tropical/rest/services/tropical/NHC_tropical_weather/"],
    method: "GET",
    maxRedirects: 2,
    credentialMode: "none",
  },
  endpoints: {
    metadataUrlTemplate:
      "https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer?f=pjson",
    sampleUrlTemplate:
      "https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer/layers?f=pjson",
  },
  serviceIdentity: {
    service: "NHC_tropical_weather",
    item: "MapServer",
    layer: "forecast points / track / cone (pinned by name+ID at live preflight)",
    layerId: null,
  },
  response: {
    format: "arcgis-geojson",
    crs: "EPSG:4326",
    requiredFields: [
      "features[].properties.STORMNAME",
      "features[].properties.STORMID",
      "features[].properties.ADVISORY",
    ],
    geometryTypes: ["Point", "LineString", "Polygon"],
  },
  terms: {
    landingUrl: "https://www.nhc.noaa.gov/gis/",
    termsUrl: "https://www.weather.gov/disclaimer",
    termsDate: "2026-10-16",
    attribution: "National Hurricane Center (NOAA)",
    coverage: {
      geographic: "Atlantic / Eastern Pacific tropical basins",
      temporal: "Advisory-driven; service updates on a 6-hour / 3-hour cadence",
    },
    quota: "UNKNOWN",
  },
  policy: {
    spacingMs: 900000,
    concurrency: 1,
    timeoutMs: 10000,
    caps: { redirects: 2, pages: 1, records: 1, bytes: 5242880, vertices: 500000 },
  },
  observationTimeField: "features[].properties.ADVISORY (advisory identity; storm time per layer)",
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
    receipt: "receipts/nhc-tropical.md",
    receiptDate: "2026-11-20",
  },
  imageDisplay: {
    mode: "not_applicable",
    receipt: "receipts/nhc-tropical.md",
    receiptDate: "2026-11-20",
  },
  iframeEmbed: {
    mode: "not_applicable",
    receipt: "receipts/nhc-tropical.md",
    receiptDate: "2026-11-20",
  },
  hotlinking: {
    mode: "not_applicable",
    receipt: "receipts/nhc-tropical.md",
    receiptDate: "2026-11-20",
  },
  proxying: {
    mode: "forbidden",
    receipt: "receipts/nhc-tropical.md",
    receiptDate: "2026-11-20",
  },
  caching: {
    mode: "allowed",
    receipt: "receipts/nhc-tropical.md",
    receiptDate: "2026-11-20",
  },
  archive: {
    mode: "unknown",
    receipt: "receipts/nhc-tropical.md",
    receiptDate: "2026-11-20",
  },
};

export function validateMetadata(metadata) {
  const errors = shapeErrors(metadata, [
    { name: "currentVersion", type: "number", required: true },
    { name: "serviceDescription", type: "string", required: true },
    { name: "layers", type: "array", required: true },
  ], "nhc-tropical.metadata");
  if (errors.length > 0) {
    return errors;
  }
  metadata.layers.forEach((layer, index) => {
    errors.push(...shapeErrors(layer, [
      { name: "id", type: "number", required: true },
      { name: "name", type: "string", required: true },
    ], `nhc-tropical.metadata.layers[${index}]`));
  });
  return errors;
}

export function validateSample(sample) {
  const errors = shapeErrors(sample, [
    { name: "type", type: "string", required: true },
    { name: "features", type: "array", required: true },
    // The transfer flag is absent from live responses with no features
    // (verified 2026-11-20: an empty FeatureCollection carries no
    // exceededTransferLimit). Optional: type-checked when present, never
    // required. Its absence is not a failure.
    { name: "exceededTransferLimit", type: "boolean", required: false },
  ], "nhc-tropical.sample");
  if (errors.length > 0) {
    return errors;
  }
  // ArcGIS GeoJSON carries the transfer flag under top-level properties
  // when the service reports it (see WFIGS). When present it must be a
  // boolean; its absence is not a failure.
  if (
    sample.properties &&
    sample.properties.exceededTransferLimit !== undefined &&
    typeof sample.properties.exceededTransferLimit !== "boolean"
  ) {
    errors.push(
      "nhc-tropical.sample.properties.exceededTransferLimit: expected boolean",
    );
  }
  if (sample.type !== "FeatureCollection") {
    errors.push("nhc-tropical.sample.type: expected FeatureCollection");
    return errors;
  }
  if (sample.features.length > 1) {
    errors.push(
      "nhc-tropical.sample: the R0 contract samples exactly one record",
    );
  }
  sample.features.forEach((feature, index) => {
    const label = `nhc-tropical.sample.features[${index}]`;
    if (!feature.properties) {
      errors.push(`${label}.properties: missing required field`);
      return;
    }
    // Storm identity is stormID + advisory. AT1-style slot labels are NOT
    // storm identity and must never be used to track a storm.
    errors.push(...shapeErrors(feature.properties, [
      { name: "STORMNAME", type: "string", required: true },
      { name: "STORMID", type: "string", required: true },
      { name: "ADVISORY", type: "string", required: true },
    ], `${label}.properties`));
    if (
      feature.geometry &&
      !["Point", "LineString", "Polygon"].includes(feature.geometry.type)
    ) {
      errors.push(`${label}.geometry.type: unexpected geometry type`);
    }
  });
  // The declared contract paths must resolve against the actual response:
  // a contract describing ArcGIS-JSON (attributes/Polyline) must fail
  // here, not silently pass while the validator checks GeoJSON properties.
  errors.push(
    ...checkDeclaredResponsePaths(sample, CONTRACT, "nhc-tropical.sample"),
  );
  return errors;
}

export function preflightPlan() {
  return [
    {
      step: 1,
      method: "GET",
      urlTemplate: CONTRACT.endpoints.metadataUrlTemplate,
      purpose: "Fetch MapServer metadata (service identity, layer list).",
      bounds: { timeoutMs: 10000, bytes: 5242880 },
    },
    {
      step: 2,
      method: "GET",
      urlTemplate: CONTRACT.endpoints.sampleUrlTemplate,
      purpose: "Fetch the layer list; pin one forecast-points/track/cone layer by name+ID.",
      bounds: { timeoutMs: 10000, bytes: 5242880 },
    },
    {
      step: 3,
      method: "GET",
      urlTemplate:
        "https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer/{layerId}/query?where=1%3D1&outFields=*&outSR=4326&resultRecordCount=1&f=geojson",
      purpose: "Query exactly one bounded record from the pinned layer.",
      bounds: { timeoutMs: 10000, bytes: 5242880, records: 1 },
    },
  ];
}
