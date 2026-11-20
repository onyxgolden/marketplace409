// Windy Webcams API v3 evaluator — disabled.
// Use entails terms acceptance and typically a key/account. This build
// records the terms disposition only: no request, signup, catalog export,
// archive, proxy, or passthrough. Contract evaluator only.

export const CONTRACT = {
  id: "windy",
  owner: "Windy (Windy Webcams API v3)",
  product: "Windy Webcams — free tier",
  category: "camera",
  adapterVersion: "1.0.0",
  network: {
    hosts: ["api.windy.com"],
    pathPrefixes: ["/webcams/"],
    method: "GET",
    maxRedirects: 2,
    credentialMode: "none",
  },
  endpoints: {
    metadataUrlTemplate: "https://api.windy.com/webcams/pricing",
    sampleUrlTemplate: "https://api.windy.com/webcams/docs",
  },
  serviceIdentity: {
    service: "Windy Webcams API v3",
    item: null,
    layer: null,
    layerId: null,
  },
  response: {
    format: "api-json",
    crs: null,
    requiredFields: ["termsUrl"],
    geometryTypes: [],
  },
  terms: {
    landingUrl: "https://api.windy.com/webcams/pricing",
    termsUrl: "https://account.windy.com/agreements/windy-api-webcams-terms-of-use",
    termsDate: "2026-10-16",
    attribution: "Windy",
    coverage: {
      geographic: "Worldwide webcam network (application-only use)",
      temporal: "Camera 'active' may merely mean updated within 24h; not a live guarantee",
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
    "Disabled: use entails terms acceptance and typically a key/account, and the free tier is application-only (no public reusable camera catalog, no redistribution). Terms recorded only.",
  killSwitch: true,
  lastPreflight: null,
  liveFixtureStatus: "pending-live-preflight",
  fixtureKind: "synthetic-contract",
  referenceMode: null,
};

export const RIGHTS = {
  metadataListing: {
    mode: "forbidden",
    receipt: "receipts/windy.md",
    receiptDate: "2026-11-20",
  },
  imageDisplay: {
    mode: "forbidden",
    receipt: "receipts/windy.md",
    receiptDate: "2026-11-20",
  },
  iframeEmbed: {
    mode: "forbidden",
    receipt: "receipts/windy.md",
    receiptDate: "2026-11-20",
  },
  hotlinking: {
    mode: "forbidden",
    receipt: "receipts/windy.md",
    receiptDate: "2026-11-20",
  },
  proxying: {
    mode: "forbidden",
    receipt: "receipts/windy.md",
    receiptDate: "2026-11-20",
  },
  caching: {
    mode: "forbidden",
    receipt: "receipts/windy.md",
    receiptDate: "2026-11-20",
  },
  archive: {
    mode: "forbidden",
    receipt: "receipts/windy.md",
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
