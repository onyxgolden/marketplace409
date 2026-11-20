// WFIGS current interagency fire perimeters adapter contract — NIFC public
// ArcGIS REST FeatureServer. Read-only contract for the R0 offline build.
// No live call is made here.

import { shapeErrors } from "../schemaDigest.mjs";

export const CONTRACT = {
  id: "wfigs-perimeters",
  owner: "National Interagency Fire Center (NIFC)",
  product: "WFIGS — Current Interagency Fire Perimeters",
  category: "hazard-data",
  adapterVersion: "1.0.0",
  network: {
    hosts: ["services3.arcgis.com"],
    pathPrefixes: [
      "/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/",
    ],
    method: "GET",
    maxRedirects: 2,
    credentialMode: "none",
  },
  endpoints: {
    metadataUrlTemplate:
      "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0?f=pjson",
    sampleUrlTemplate:
      "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?where=1%3D1&outFields=*&geometry=&outSR=4326&resultRecordCount=1&f=geojson",
  },
  serviceIdentity: {
    service: "WFIGS_Interagency_Perimeters_Current",
    item: "FeatureServer",
    layer: "WFIGS Interagency Perimeters Current",
    layerId: 0,
  },
  response: {
    format: "arcgis-geojson",
    crs: "EPSG:4326",
    requiredFields: [
      "features[].attributes.OBJECTID",
      "features[].attributes.IncidentName",
      "features[].geometry.rings",
      "exceededTransferLimit",
    ],
    geometryTypes: ["Polygon"],
  },
  terms: {
    landingUrl:
      "https://data-nifc.opendata.arcgis.com/datasets/nifc::wfigs-current-interagency-fire-perimeters/about",
    termsUrl: "https://data-nifc.opendata.arcgis.com/",
    termsDate: "2026-10-16",
    attribution: "National Interagency Fire Center (NIFC)",
    coverage: {
      geographic: "United States (interagency incidents)",
      temporal: "Current perimeters; source update time per feature",
    },
    quota: "UNKNOWN",
  },
  policy: {
    spacingMs: 1000,
    concurrency: 1,
    timeoutMs: 10000,
    caps: { redirects: 2, pages: 1, records: 1, bytes: 5242880, vertices: 500000 },
  },
  observationTimeField: "features[].attributes.DateCurrent",
  retrievalTimeField: "retrievalTime (recorded by the preflight run, never the source)",
  status: "disabled",
  statusReason:
    "Contract recorded. No live preflight run in the R0 offline build; acceptance pending separately authorized live preflight. A current live fixture is still owed for this adapter.",
  killSwitch: true,
  lastPreflight: null,
  liveFixtureStatus: "pending-live-preflight",
  fixtureKind: "synthetic-contract",
};

export const RIGHTS = {
  metadataListing: {
    mode: "allowed",
    receipt: "receipts/wfigs-perimeters.md",
    receiptDate: "2026-11-20",
  },
  imageDisplay: {
    mode: "not_applicable",
    receipt: "receipts/wfigs-perimeters.md",
    receiptDate: "2026-11-20",
  },
  iframeEmbed: {
    mode: "not_applicable",
    receipt: "receipts/wfigs-perimeters.md",
    receiptDate: "2026-11-20",
  },
  hotlinking: {
    mode: "not_applicable",
    receipt: "receipts/wfigs-perimeters.md",
    receiptDate: "2026-11-20",
  },
  proxying: {
    mode: "forbidden",
    receipt: "receipts/wfigs-perimeters.md",
    receiptDate: "2026-11-20",
  },
  caching: {
    mode: "allowed",
    receipt: "receipts/wfigs-perimeters.md",
    receiptDate: "2026-11-20",
  },
  archive: {
    mode: "unknown",
    receipt: "receipts/wfigs-perimeters.md",
    receiptDate: "2026-11-20",
  },
};

export function validateMetadata(metadata) {
  const errors = shapeErrors(metadata, [
    { name: "currentVersion", type: "number", required: true },
    { name: "name", type: "string", required: true },
    { name: "maxRecordCount", type: "number", required: true },
    { name: "supportsPagination", type: "boolean", required: true },
  ], "wfigs-perimeters.metadata");
  if (errors.length > 0) {
    return errors;
  }
  if (metadata.maxRecordCount > 2000) {
    errors.push(
      "wfigs-perimeters.metadata.maxRecordCount: expected the documented 2000-record ceiling or less",
    );
  }
  return errors;
}

export function validateSample(sample) {
  const errors = shapeErrors(sample, [
    { name: "type", type: "string", required: true },
    { name: "features", type: "array", required: true },
    { name: "exceededTransferLimit", type: "boolean", required: true },
  ], "wfigs-perimeters.sample");
  if (errors.length > 0) {
    return errors;
  }
  if (sample.type !== "FeatureCollection") {
    errors.push("wfigs-perimeters.sample.type: expected FeatureCollection");
    return errors;
  }
  if (sample.features.length > 1) {
    errors.push(
      "wfigs-perimeters.sample: the R0 contract samples exactly one record",
    );
  }
  sample.features.forEach((feature, index) => {
    const label = `wfigs-perimeters.sample.features[${index}]`;
    if (!feature.properties) {
      errors.push(`${label}.properties: missing required field`);
      return;
    }
    errors.push(...shapeErrors(feature.properties, [
      { name: "OBJECTID", type: "number", required: true },
      { name: "IncidentName", type: "string", required: true },
    ], `${label}.properties`));
    if (
      !feature.geometry ||
      feature.geometry.type !== "Polygon" ||
      !Array.isArray(feature.geometry.coordinates)
    ) {
      errors.push(`${label}.geometry: expected a Polygon geometry`);
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
      purpose: "Fetch layer 0 metadata (identity, fields, record limit, pagination).",
      bounds: { timeoutMs: 10000, bytes: 5242880 },
    },
    {
      step: 2,
      method: "GET",
      urlTemplate: CONTRACT.endpoints.sampleUrlTemplate,
      purpose: "Query exactly one record as GeoJSON; record exceededTransferLimit, do not crawl.",
      bounds: { timeoutMs: 10000, bytes: 5242880, records: 1 },
    },
  ];
}
