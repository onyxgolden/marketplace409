// Rentec parity R23 — e-filing partner layer: DESIGN ONLY, HARD GATE.
//
// SPEND DECISION (Jason's build-spend motto, hard boundary): e-filing partners
// charge per-filing fees. Nothing in this module signs up for, configures,
// contacts, or pays any e-filing partner. The partner integration is modeled as
// a swappable stub with a stable contract so a real provider (e.g. a FIRE
// transmitter service) can be wired later WITHOUT touching the data-prep,
// recipient, or export code:
//
//   - getEfilePartnerStatus() always reports { connected: false }.
//   - requestEfileSubmission() ALWAYS refuses with the gate message and makes
//     NO network call (the test suite asserts fetch is never invoked).
//
// WHAT JASON WOULD NEED TO APPROVE before e-filing goes live:
//   1. Partner choice (which e-filing provider / FIRE transmitter).
//   2. Per-filing cost (partners bill per form filed — real spend).
//   3. The provider's credentials and TCC (Transmitter Control Code), stored in
//      the Secure Vault, never in chat or code.
//   4. A live end-to-end verification with his CPA before the first real filing.
//
// Until then the UI shows "E-file: not connected — export and file manually"
// and the /api/rental/1099/efile-submit route returns the gate message.

export const EFILE_GATE_MESSAGE =
  "E-filing is not connected. Choose an e-filing partner and approve the per-filing cost before e-filing can go live — for now, export the 1099 file and file manually or with your CPA.";

export const EFILE_APPROVAL_CHECKLIST = Object.freeze([
  "Partner choice — which e-filing provider the business will file through",
  "Per-filing cost — partners charge per form filed; needs Jason's word under the build-spend doctrine",
  "Provider credentials + IRS Transmitter Control Code (TCC), stored in the Secure Vault — never in chat or code",
  "End-to-end verification with the CPA before the first real filing",
]);

// Stable contract for the future real provider. A connected implementation
// would return { connected: true, provider: "<name>", connectedAt } and this
// module would route submit() to it. Today the stub is the only implementation.
export function getEfilePartnerStatus() {
  return Object.freeze({
    connected: false,
    provider: null,
    lastCheckedAt: new Date().toISOString(),
    message: "E-file: not connected — export and file manually.",
    approvalChecklist: EFILE_APPROVAL_CHECKLIST,
  });
}

// Never performs a network call. The 409 response shape mirrors what a
// connected-but-failed submission would return, minus the provider call.
export function requestEfileSubmission({ taxYear } = {}) {
  return Object.freeze({
    ok: false,
    submitted: false,
    error: EFILE_GATE_MESSAGE,
    taxYear: taxYear ?? null,
  });
}
