// AI receipt extraction — SWAPPABLE INTERFACE + hard-gated stub.
// Rentec parity R26.
//
// SPEND DECISION (hard boundary — Jason's build-spend motto): vision/LLM
// extraction costs per image and per token. No paid AI API is wired, no
// model is called, no signup exists. The only implementation shipped is the
// "not connected" stub below: it ALWAYS reports not_connected and performs
// zero network calls.
//
// How a real implementation plugs in:
//   1. Implement `extractReceiptData` with the same contract (see
//      EXTRACTION_CONTRACT below): input { fileBytes | fileUrl, mimeType },
//      output { status, vendorName?, receiptDate?, amountCents?, taxCents?,
//      lineItems?, rawJson?, provider, model, error? }.
//   2. The UI calls the /extract route, which resolves the implementation
//      through `resolveExtractionProvider()` — today that always resolves to
//      the stub. A live implementation requires Jason's explicit word per
//      docs/rentec-parity/AI_SCAN_GATE.md (which model, per-image cost, where
//      it runs — e.g. local Ollama on the iBUYPOWER box vs a paid API — and
//      which data may leave the machine).
//   3. Gate checklist before going live: cost approved, credentials stored
//      via the approved secure flow (never chat, never files), redaction of
//      secrets from logs, and a kill switch (AI_SCAN_ENABLED env default off).
//
// The route NEVER falls back to a silent no-op: when extraction is not
// connected the UI shows "AI scan: not connected — enter details manually".

export const EXTRACTION_STATUS = Object.freeze({
  NOT_CONNECTED: "not_connected",
  PENDING: "pending",
  COMPLETE: "complete",
  FAILED: "failed",
});

// The contract every extraction provider must honor. Input is the receipt
// file; output is always a plain object with a `status` field so callers
// never have to guess whether extraction is live.
export const EXTRACTION_CONTRACT = Object.freeze({
  input: ["fileBytes (Uint8Array | Buffer)", "mimeType (string)", "fileName (string, optional)"],
  output: [
    "status: 'not_connected' | 'pending' | 'complete' | 'failed'",
    "provider: string — e.g. 'stub', 'ollama-local', 'openai'",
    "message: string — human-readable status for the UI",
    "vendorName?: string",
    "receiptDate?: string (YYYY-MM-DD)",
    "amountCents?: number",
    "taxCents?: number",
    "lineItems?: [{ description, amountCents }]",
    "rawJson?: object — provider-native payload, for audit",
    "error?: string — only when status is 'failed'",
  ],
});

const NOT_CONNECTED_MESSAGE =
  "AI scan is not connected. Enter the receipt details manually — " +
  "no image was sent anywhere. Connecting AI extraction needs the owner's approval (see AI_SCAN_GATE.md).";

// The stub implementation: always not_connected, zero network calls.
// `input` is accepted (and ignored) so the call shape matches the contract.
export async function extractReceiptDataStub(input) {
  void input;
  return {
    status: EXTRACTION_STATUS.NOT_CONNECTED,
    provider: "stub",
    message: NOT_CONNECTED_MESSAGE,
  };
}

// Provider resolution. Today there is exactly one provider — the stub.
// This is the single seam where a future gated implementation would be
// selected; adding one here without Jason's explicit word is out of scope.
export function resolveExtractionProvider() {
  return { name: "stub", extract: extractReceiptDataStub };
}

export async function extractReceiptData(input) {
  const provider = resolveExtractionProvider();
  return provider.extract(input);
}

export function isExtractionConnected() {
  return resolveExtractionProvider().name !== "stub";
}
