// FEMA NFHL adapter contract — National Flood Hazard Layer, official public
// ArcGIS REST service. Read-only contract for the R0 offline build. No live
// call is made here.
//
// The customary NFHL layer 28 is a CANDIDATE only: the live preflight must
// resolve and persist the current official service/item/layer from FEMA's
// official link chain before this adapter can be accepted. A 403, a moved
// service, or unverifiable identity means BLOCKED — never a scraped mirror.

import { shapeErrors, checkDeclaredResponsePaths } from "../schemaDigest.mjs";

export const CONTRACT = {
  id: "fema-nfhl",
  owner: "Federal Emergency Management Agency (FEMA)",
  product: "National Flood Hazard Layer (NFHL)",
  category: "hazard-data",
  adapterVersion: "1.0.0",
  network: {
    hosts: ["hazards.fema.gov"],
    pathPrefixes: ["/gis/nfhl/rest/services/public/NFHL/"],
    method: "GET",
    maxRedirects: 2,
    credentialMode: "none",
  },
  endpoints: {
    metadataUrlTemplate:
      "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer?f=pjson",
    sampleUrlTemplate:
      "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query?geometry=-95.3698%2C29.7604&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&outSR=4326&f=geojson",
  },
  serviceIdentity: {
    service: "NFHL",
    item: "MapServer",
    layer: "Flood Hazard Zones (layer 28 is a CANDIDATE, not verified)",
    layerId: 28,
    layerCandidate: true,
  },
  response: {
    format: "arcgis-geojson",
    crs: "EPSG:4326",
    requiredFields: [
      "features[].properties.FLD_ZONE",
      "features[].properties.SFHA_TF",
      "features[].properties.PANEL",
      "features[].properties.EFF_DATE",
    ],
    geometryTypes: ["Polygon"],
  },
  terms: {
    landingUrl: "https://www.fema.gov/flood-maps/national-flood-hazard-layer",
    termsUrl: "https://msc.fema.gov/",
    termsDate: "2026-10-16",
    attribution: "Federal Emergency Management Agency (FEMA)",
    coverage: {
      geographic: "United States where NFHL mapping exists; unmapped areas return no match",
      temporal: "Effective regulatory context (map effective date per panel), not live conditions",
    },
    quota: "UNKNOWN",
  },
  policy: {
    spacingMs: 86400000,
    concurrency: 1,
    timeoutMs: 10000,
    caps: { redirects: 2, pages: 1, records: 1, bytes: 5242880, vertices: 1000 },
  },
  observationTimeField: "features[].properties.EFF_DATE (map effective date)",
  retrievalTimeField: "retrievalTime (recorded by the preflight run, never the source)",
  status: "blocked",
  statusReason: "Live preflight 2026-11-20T19:20:44.232Z blocked: NFHL REST endpoint unreachable from the preflight host (hazards.fema.gov closes the connection after the TLS handshake; www.fema.gov responds). No unofficial source substituted; synthetic fixture retained.",
  killSwitch: true,
  lastPreflight: null,
  liveFixtureStatus: "pending-live-preflight",
  fixtureKind: "synthetic-contract",
};

export const RIGHTS = {
  metadataListing: {
    mode: "allowed",
    receipt: "receipts/fema-nfhl.md",
    receiptDate: "2026-11-20",
  },
  imageDisplay: {
    mode: "not_applicable",
    receipt: "receipts/fema-nfhl.md",
    receiptDate: "2026-11-20",
  },
  iframeEmbed: {
    mode: "not_applicable",
    receipt: "receipts/fema-nfhl.md",
    receiptDate: "2026-11-20",
  },
  hotlinking: {
    mode: "not_applicable",
    receipt: "receipts/fema-nfhl.md",
    receiptDate: "2026-11-20",
  },
  proxying: {
    mode: "forbidden",
    receipt: "receipts/fema-nfhl.md",
    receiptDate: "2026-11-20",
  },
  caching: {
    mode: "allowed",
    receipt: "receipts/fema-nfhl.md",
    receiptDate: "2026-11-20",
  },
  archive: {
    mode: "unknown",
    receipt: "receipts/fema-nfhl.md",
    receiptDate: "2026-11-20",
  },
};

export function validateMetadata(metadata) {
  const errors = shapeErrors(metadata, [
    { name: "currentVersion", type: "number", required: true },
    { name: "serviceDescription", type: "string", required: true },
    { name: "layers", type: "array", required: true },
  ], "fema-nfhl.metadata");
  if (errors.length > 0) {
    return errors;
  }
  const layer28 = metadata.layers.find((layer) => layer.id === 28);
  if (!layer28) {
    errors.push(
      "fema-nfhl.metadata.layers: candidate layer 28 is absent; the live preflight must resolve the current official layer instead of assuming it",
    );
  }
  return errors;
}

export function validateSample(sample) {
  const errors = shapeErrors(sample, [
    { name: "type", type: "string", required: true },
    { name: "features", type: "array", required: true },
  ], "fema-nfhl.sample");
  if (errors.length > 0) {
    return errors;
  }
  if (sample.type !== "FeatureCollection") {
    errors.push("fema-nfhl.sample.type: expected FeatureCollection");
    return errors;
  }
  // An empty features array is a VALID result here: it means unmapped / no
  // match at the test point — distinct from unavailable or unauthorized.
  // It must never be reported as "no flood exposure".
  sample.features.forEach((feature, index) => {
    const label = `fema-nfhl.sample.features[${index}]`;
    if (!feature.properties) {
      errors.push(`${label}.properties: missing required field`);
      return;
    }
    errors.push(...shapeErrors(feature.properties, [
      { name: "FLD_ZONE", type: "string", required: true },
      { name: "SFHA_TF", type: "string", required: true },
      { name: "PANEL", type: "string", required: true },
      { name: "EFF_DATE", type: "string", required: true },
    ], `${label}.properties`));
  });
  // The declared contract paths must resolve against the actual response:
  // a contract describing ArcGIS-JSON (attributes) must fail here, not
  // silently pass while the validator checks GeoJSON properties. An empty
  // features array stays valid: the traversal skips paths through it.
  errors.push(
    ...checkDeclaredResponsePaths(sample, CONTRACT, "fema-nfhl.sample"),
  );
  return errors;
}

export function preflightPlan() {
  return [
    {
      step: 1,
      method: "GET",
      urlTemplate: "https://www.fema.gov/flood-maps/national-flood-hazard-layer",
      purpose: "Follow FEMA's current official NFHL link chain to the public ArcGIS REST service (outside the ArcGIS host allowlist; resolve, then record).",
      bounds: { timeoutMs: 10000, bytes: 5242880 },
      note: "The link-chain step executed at the live preflight 2026-11-20T19:20:44.232Z under Jason's authorization; the page linked the official Map Service Center (msc.fema.gov/nfhl). The NFHL REST endpoint itself was unreachable from the preflight host, so FEMA stays blocked.",
    },
    {
      step: 2,
      method: "GET",
      urlTemplate: CONTRACT.endpoints.metadataUrlTemplate,
      purpose: "Fetch MapServer metadata; verify the current official layer identity (28 is a candidate only).",
      bounds: { timeoutMs: 10000, bytes: 5242880 },
    },
    {
      step: 3,
      method: "GET",
      urlTemplate: CONTRACT.endpoints.sampleUrlTemplate,
      purpose: "One tiny point query at a public test point (Houston City Hall) for zone/panel/effective-date fields.",
      bounds: { timeoutMs: 10000, bytes: 5242880, records: 1 },
    },
  ];
}
