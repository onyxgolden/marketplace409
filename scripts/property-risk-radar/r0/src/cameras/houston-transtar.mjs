// Houston TranStar camera evaluator — LINK_ONLY.
// TxDOT content terms expressly forbid copying, framing, and hotlinking
// specific images without written TxDOT consent. Permission for certain RSS
// traffic feeds does NOT grant camera rights. Contract evaluator only: no
// snapshot fetch, no media request, no provider contact.

export const CONTRACT = {
  id: "houston-transtar",
  owner: "Houston TranStar (TxDOT / regional partners)",
  product: "Houston TranStar traffic cameras",
  category: "camera",
  adapterVersion: "1.0.0",
  network: {
    hosts: ["www.houstontranstar.org", "traffic.houstontranstar.org"],
    pathPrefixes: ["/", "/faq/", "/disclaimer.aspx"],
    method: "GET",
    maxRedirects: 2,
    credentialMode: "none",
  },
  endpoints: {
    metadataUrlTemplate: "https://www.houstontranstar.org/",
    sampleUrlTemplate: "https://traffic.houstontranstar.org/disclaimer.aspx",
  },
  serviceIdentity: {
    service: "Houston TranStar",
    item: null,
    layer: null,
    layerId: null,
  },
  response: {
    format: "viewer-link",
    crs: null,
    requiredFields: ["viewerUrl", "disclaimerUrl"],
    geometryTypes: [],
  },
  terms: {
    landingUrl: "https://www.houstontranstar.org/faq/webfaq.aspx",
    termsUrl: "https://traffic.houstontranstar.org/disclaimer.aspx",
    termsDate: "2026-10-16",
    attribution: "Houston TranStar",
    coverage: {
      geographic: "Houston, Texas region",
      temporal: "Snapshots approximately every 3 minutes per FAQ; no stored footage",
    },
    quota: "UNKNOWN",
  },
  policy: {
    spacingMs: 180000,
    concurrency: 1,
    timeoutMs: 10000,
    caps: { redirects: 2, pages: 1, records: 0, bytes: 0, vertices: 0 },
  },
  observationTimeField: null,
  retrievalTimeField: "retrievalTime (recorded by the preflight run, never the source)",
  status: "disabled",
  statusReason:
    "LINK_ONLY until written TxDOT consent or a source-specific license is documented. No image, player, hotlink, proxy, cache, or archive use.",
  killSwitch: true,
  lastPreflight: null,
  liveFixtureStatus: "pending-live-preflight",
  fixtureKind: "synthetic-contract",
  referenceMode: "LINK_ONLY",
};

export const RIGHTS = {
  metadataListing: {
    mode: "allowed",
    receipt: "receipts/houston-transtar.md",
    receiptDate: "2026-11-20",
  },
  imageDisplay: {
    mode: "forbidden",
    receipt: "receipts/houston-transtar.md",
    receiptDate: "2026-11-20",
  },
  iframeEmbed: {
    mode: "forbidden",
    receipt: "receipts/houston-transtar.md",
    receiptDate: "2026-11-20",
  },
  hotlinking: {
    mode: "forbidden",
    receipt: "receipts/houston-transtar.md",
    receiptDate: "2026-11-20",
  },
  proxying: {
    mode: "forbidden",
    receipt: "receipts/houston-transtar.md",
    receiptDate: "2026-11-20",
  },
  caching: {
    mode: "forbidden",
    receipt: "receipts/houston-transtar.md",
    receiptDate: "2026-11-20",
  },
  archive: {
    mode: "forbidden",
    receipt: "receipts/houston-transtar.md",
    receiptDate: "2026-11-20",
  },
};

// Pure evaluator: the disposition is fixed by the recorded terms. It never
// fetches anything and never upgrades itself.
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
