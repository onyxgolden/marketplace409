// EarthCam evaluator — link-only absent a specific no-cost FORGE embed
// authorization. Published media integration is licensed; permission to
// embed one's own MyEarthCam stream is not permission for all network
// streams. Contract evaluator only: no media request, no assumed API.

export const CONTRACT = {
  id: "earthcam",
  owner: "EarthCam",
  product: "EarthCam network cameras",
  category: "camera",
  adapterVersion: "1.0.0",
  network: {
    hosts: ["www.earthcam.com"],
    pathPrefixes: ["/"],
    method: "GET",
    maxRedirects: 2,
    credentialMode: "none",
  },
  endpoints: {
    metadataUrlTemplate: "https://www.earthcam.com/company/mediapriorityaccess/",
    sampleUrlTemplate: "https://www.earthcam.com/myearthcam/help/faq.php",
  },
  serviceIdentity: {
    service: "EarthCam",
    item: null,
    layer: null,
    layerId: null,
  },
  response: {
    format: "viewer-link",
    crs: null,
    requiredFields: ["viewerUrl"],
    geometryTypes: [],
  },
  terms: {
    landingUrl: "https://www.earthcam.com/company/mediapriorityaccess/",
    termsUrl: "https://www.earthcam.com/myearthcam/help/faq.php",
    termsDate: "2026-10-16",
    attribution: "EarthCam",
    coverage: {
      geographic: "Worldwide network",
      temporal: "Per-stream licensing",
    },
    quota: "UNKNOWN",
  },
  policy: {
    spacingMs: 86400000,
    concurrency: 1,
    timeoutMs: 10000,
    caps: { redirects: 2, pages: 1, records: 0, bytes: 0, vertices: 0 },
  },
  observationTimeField: null,
  retrievalTimeField: "retrievalTime (recorded by the preflight run, never the source)",
  status: "disabled",
  statusReason:
    "LINK_ONLY absent a specific no-cost FORGE embed authorization. Licensed media integration only; no assumed free commercial network API.",
  killSwitch: true,
  lastPreflight: null,
  liveFixtureStatus: "pending-live-preflight",
  fixtureKind: "synthetic-contract",
  referenceMode: "LINK_ONLY",
};

export const RIGHTS = {
  metadataListing: {
    mode: "allowed",
    receipt: "receipts/earthcam.md",
    receiptDate: "2026-11-20",
  },
  imageDisplay: {
    mode: "forbidden",
    receipt: "receipts/earthcam.md",
    receiptDate: "2026-11-20",
  },
  iframeEmbed: {
    mode: "forbidden",
    receipt: "receipts/earthcam.md",
    receiptDate: "2026-11-20",
  },
  hotlinking: {
    mode: "forbidden",
    receipt: "receipts/earthcam.md",
    receiptDate: "2026-11-20",
  },
  proxying: {
    mode: "forbidden",
    receipt: "receipts/earthcam.md",
    receiptDate: "2026-11-20",
  },
  caching: {
    mode: "forbidden",
    receipt: "receipts/earthcam.md",
    receiptDate: "2026-11-20",
  },
  archive: {
    mode: "forbidden",
    receipt: "receipts/earthcam.md",
    receiptDate: "2026-11-20",
  },
};

export function evaluate() {
  return {
    id: CONTRACT.id,
    status: CONTRACT.status,
    referenceMode: CONTRACT.referenceMode,
    displayAllowed: false,
    reason: CONTRACT.statusReason,
    rights: RIGHTS,
  };
}
