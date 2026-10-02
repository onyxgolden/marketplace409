// Rentec parity R20 — paid mail-send provider interface (DESIGN ONLY, HARD GATE).
//
// THE PAID-SEND LAYER IS NOT WIRED. This module defines the contract a
// future provider adapter must implement, plus a stub that always refuses.
// Under Jason's build-spend doctrine, certified-mail APIs (USPS, Lob, etc.)
// cost per-piece postage plus API spend, so the send call is never made
// until he explicitly approves ALL THREE of:
//   1. The provider choice (e.g. Lob, USPS Click-N-Ship API, or another).
//   2. The per-piece cost (postage + API fee), quoted in writing.
//   3. Who pays (owner absorbs it, or it is billed back to the tenant).
//
// What is built (free layer, this slice):
//   * letter templates, composer, preview, print
//   * bulk-send queue (letters sit "queued" until the owner mails them)
//   * manual tracking-number entry (owner mails at the post office, types in the number)
//   * delivery-status model + file-library copies
//
// What a future provider adapter must implement to go live:
//   async sendLetter({ to, from, subject, body }) →
//     { providerMessageId, trackingNumber? }
// The adapter lives here, reads credentials from server-side env vars only,
// and is selected by a workspace setting — never by client-supplied input.

export const PROVIDER_NOT_CONNECTED_MESSAGE =
  "Send via provider: not connected — print or mail manually.";

// The contract every future adapter fulfills. Kept as a plain object so a
// new provider is one file plus a factory case — no route changes.
export const mailProviderContract = Object.freeze({
  name: "provider-adapter",
  // adapter.sendLetter({ to, from, subject, body }) → Promise<{ providerMessageId, trackingNumber? }>
});

export function getMailProviderStatus() {
  return {
    connected: false,
    provider: null,
    message: PROVIDER_NOT_CONNECTED_MESSAGE,
    // The three approvals Jason must give before send goes live:
    pendingApprovals: [
      "Choose the mail provider (Lob, USPS API, or another).",
      "Confirm the per-piece cost (postage + API fee).",
      "Decide who pays (owner absorbs it or bills it back to the tenant).",
    ],
  };
}

// The stub. It is called by POST /api/rental/mailing/provider and always
// refuses — it never reads credentials, never touches the network, and never
// constructs an outbound request. A real adapter replaces the throw, not the
// gate around it.
export async function sendLetterViaProvider() {
  const error = new Error(
    `${PROVIDER_NOT_CONNECTED_MESSAGE} Provider send stays off until Jason approves the provider, its per-piece cost, and who pays.`,
  );
  error.code = "PROVIDER_NOT_CONNECTED";
  throw error;
}
