// 511 program evaluator — one contract per program, not a national adapter.
// Registration/key/agreement sources remain disabled. 511NY is recorded as
// the representative example program; no other program is claimed.
// Contract evaluator only: no request, signup, or agreement acceptance.

export const CONTRACT = {
  id: "program-511",
  owner: "Individual state 511 programs (representative: 511NY)",
  product: "511 camera programs",
  category: "camera",
  adapterVersion: "1.0.0",
  network: {
    hosts: ["www.511ny.org", "prod-ny.ibi511.com"],
    pathPrefixes: ["/developers/"],
    method: "GET",
    maxRedirects: 2,
    credentialMode: "none",
  },
  endpoints: {
    metadataUrlTemplate: "https://www.511ny.org/developers/resources",
    sampleUrlTemplate: "https://prod-ny.ibi511.com/developers/help/api/get-api-getcameras_key_format",
  },
  serviceIdentity: {
    service: "511NY developer program (representative)",
    item: null,
    layer: null,
    layerId: null,
  },
  response: {
    format: "api-json",
    crs: null,
    requiredFields: ["agreementUrl"],
    geometryTypes: [],
  },
  terms: {
    landingUrl: "https://www.511ny.org/developers/resources",
    termsUrl: "https://prod-ny.ibi511.com/developers/daa",
    termsDate: "2026-10-16",
    attribution: "511NY / IBI Group",
    coverage: {
      geographic: "New York State (representative program only)",
      temporal: "Per-program agreement terms",
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
    "Disabled: one contract per program, not a national adapter. Registration/key/agreement sources remain disabled until a per-program agreement is separately authorized.",
  killSwitch: true,
  lastPreflight: null,
  liveFixtureStatus: "pending-live-preflight",
  fixtureKind: "synthetic-contract",
  referenceMode: null,
};

export const RIGHTS = {
  metadataListing: {
    mode: "unknown",
    receipt: "receipts/program-511.md",
    receiptDate: "2026-11-20",
  },
  imageDisplay: {
    mode: "forbidden",
    receipt: "receipts/program-511.md",
    receiptDate: "2026-11-20",
  },
  iframeEmbed: {
    mode: "forbidden",
    receipt: "receipts/program-511.md",
    receiptDate: "2026-11-20",
  },
  hotlinking: {
    mode: "forbidden",
    receipt: "receipts/program-511.md",
    receiptDate: "2026-11-20",
  },
  proxying: {
    mode: "forbidden",
    receipt: "receipts/program-511.md",
    receiptDate: "2026-11-20",
  },
  caching: {
    mode: "forbidden",
    receipt: "receipts/program-511.md",
    receiptDate: "2026-11-20",
  },
  archive: {
    mode: "forbidden",
    receipt: "receipts/program-511.md",
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
