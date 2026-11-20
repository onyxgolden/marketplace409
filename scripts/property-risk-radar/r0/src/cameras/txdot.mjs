// TxDOT camera evaluator — disabled pending a direct reusable-feed/license
// receipt. The official viewer and candidate CCTV ArcGIS metadata may be
// recorded; reachability or a blank copyright does NOT grant image/player
// rights. Contract evaluator only: no media request, no stream guessing,
// no provider contact.

export const CONTRACT = {
  id: "txdot",
  owner: "Texas Department of Transportation (TxDOT)",
  product: "TxDOT live traffic cameras / official viewers",
  category: "camera",
  adapterVersion: "1.0.0",
  network: {
    hosts: ["www.txdot.gov"],
    pathPrefixes: ["/discover/live-traffic-cameras.html"],
    method: "GET",
    maxRedirects: 2,
    credentialMode: "none",
  },
  endpoints: {
    metadataUrlTemplate: "https://www.txdot.gov/discover/live-traffic-cameras.html",
    sampleUrlTemplate: "https://www.txdot.gov/discover/live-traffic-cameras.html",
  },
  serviceIdentity: {
    service: "TxDOT live traffic cameras",
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
    landingUrl: "https://www.txdot.gov/discover/live-traffic-cameras.html",
    termsUrl: "https://www.txdot.gov/discover/live-traffic-cameras.html",
    termsDate: "2026-10-16",
    attribution: "Texas Department of Transportation",
    coverage: {
      geographic: "Texas (district viewers)",
      temporal: "Live viewing; monitoring footage is not recorded per TxDOT",
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
    "Disabled pending a direct reusable-feed/license receipt. Viewer metadata may be recorded; no image/player use without explicit agreement.",
  killSwitch: true,
  lastPreflight: null,
  liveFixtureStatus: "pending-live-preflight",
  fixtureKind: "synthetic-contract",
  referenceMode: "LINK_ONLY",
};

export const RIGHTS = {
  metadataListing: {
    mode: "allowed",
    receipt: "receipts/txdot.md",
    receiptDate: "2026-11-20",
  },
  imageDisplay: {
    mode: "forbidden",
    receipt: "receipts/txdot.md",
    receiptDate: "2026-11-20",
  },
  iframeEmbed: {
    mode: "forbidden",
    receipt: "receipts/txdot.md",
    receiptDate: "2026-11-20",
  },
  hotlinking: {
    mode: "forbidden",
    receipt: "receipts/txdot.md",
    receiptDate: "2026-11-20",
  },
  proxying: {
    mode: "forbidden",
    receipt: "receipts/txdot.md",
    receiptDate: "2026-11-20",
  },
  caching: {
    mode: "forbidden",
    receipt: "receipts/txdot.md",
    receiptDate: "2026-11-20",
  },
  archive: {
    mode: "forbidden",
    receipt: "receipts/txdot.md",
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
