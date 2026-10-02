// Rentec parity R20 — pure mailing-manager helpers (client-safe).
//
// Letter lifecycle: queued → mailed → delivered. The API route enforces the
// transitions through assertLetterStatusTransition(); the partial unique
// index (owner_id, batch_id, tenant_id) guarantees one letter per tenant per
// batch at the database level.

// The status machine. Reversals that represent real-world corrections are
// allowed (mailed → queued when the owner never actually mailed it,
// delivered → mailed when a delivery confirmation was recorded in error);
// anything else is rejected so the compliance trail cannot be rewritten.
export const LETTER_STATUSES = ["queued", "mailed", "delivered"];
export const LETTER_STATUS_TRANSITIONS = {
  queued: ["mailed"],
  mailed: ["delivered", "queued"],
  delivered: ["mailed"],
};
export function canTransitionLetterStatus(from, to) {
  if (!LETTER_STATUSES.includes(from) || !LETTER_STATUSES.includes(to)) return false;
  return (LETTER_STATUS_TRANSITIONS[from] || []).includes(to);
}

export function assertLetterStatusTransition(from, to) {
  if (!canTransitionLetterStatus(from, to)) {
    throw new Error(`A letter cannot move from "${from}" to "${to}". Allowed moves: queued → mailed, mailed → delivered or back to queued, delivered → back to mailed.`);
  }
}

// Certified-mail evidence rules (compliance). A letter row is the certified-
// mail record, so it may only claim mailed/delivered while it carries a
// tracking number; and once delivery is recorded, the tracking evidence
// cannot be cleared or changed unless the delivery is first explicitly
// reversed under the correction workflow (delivered → mailed).
//
// Inputs mirror the letter row: `letter` is the current row ({ status,
// tracking_number }), `nextStatus` is the requested new status (or null when
// the status is unchanged), and `nextTrackingNumber` is the requested
// tracking value — a cleaned string, null for "clear", or undefined when the
// request does not touch it. Throws a plain-English error; the route maps it
// to a 422. The database check constraint
// rental_mail_letters_tracking_required_for_mailed backs the mailed/delivered
// invariant independently of the route.
export function assertMailingEvidenceRules({ letter, nextStatus = null, nextTrackingNumber = undefined }) {
  const currentTracking = letter.tracking_number || null;
  const effectiveTracking = nextTrackingNumber !== undefined ? nextTrackingNumber : currentTracking;
  const effectiveStatus = nextStatus || letter.status;
  const trackingChanged = nextTrackingNumber !== undefined && nextTrackingNumber !== currentTracking;

  // Delivered tracking is the historical record: clearing or changing it is
  // only allowed under the correction workflow — the status must be reversed
  // to mailed first (in this request or an earlier one).
  if (letter.status === "delivered" && trackingChanged && nextStatus !== "mailed") {
    throw new Error("This letter is already marked delivered — reopen it as mailed first to correct the tracking number.");
  }
  if ((effectiveStatus === "mailed" || effectiveStatus === "delivered") && !effectiveTracking) {
    throw new Error("Record the USPS tracking number first — a letter cannot be marked mailed or delivered without certified-mail evidence.");
  }
}

// USPS tracking numbers are loose in practice (the owner types them by hand
// after mailing at the post office), so validation is lenient: 10–30
// alphanumeric characters, spaces and dashes ignored. Returns the cleaned
// value, or throws a plain-English error.
export function validateTrackingNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("A tracking number is required.");
  const cleaned = raw.replace(/[\s-]+/g, "").toUpperCase();
  if (!/^[A-Z0-9]{10,30}$/.test(cleaned)) {
    throw new Error("That does not look like a tracking number — use the 10–30 character number from the mailing receipt.");
  }
  return cleaned;
}

// Validates the create-batch request body. tenantIds are deduplicated (the
// database would reject the second copy anyway, but the error should name
// the tenant, not a constraint).
export const MAX_BATCH_TENANTS = 200;

export function validateCreateBatchInput(input = {}) {
  const name = String(input.name ?? "").trim().slice(0, 120);
  const templateId = typeof input.templateId === "string" ? input.templateId.trim() : "";
  const rawIds = Array.isArray(input.tenantIds) ? input.tenantIds : [];
  const tenantIds = [];
  for (const candidate of rawIds) {
    const id = String(candidate ?? "").trim();
    if (id && !tenantIds.includes(id)) tenantIds.push(id);
  }
  const returnAddress = input.returnAddress === null || input.returnAddress === undefined
    ? "" : String(input.returnAddress);
  const overrides = input.recipientAddresses && typeof input.recipientAddresses === "object"
    ? input.recipientAddresses : {};
  if (!templateId) return { ok: false, error: "Pick a letter template first." };
  if (tenantIds.length === 0) return { ok: false, error: "Pick at least one tenant to mail." };
  if (tenantIds.length > MAX_BATCH_TENANTS) {
    return { ok: false, error: `A batch holds at most ${MAX_BATCH_TENANTS} letters — split it into two batches.` };
  }
  if (returnAddress.length > 500) return { ok: false, error: "The return address must be 500 characters or fewer." };
  const recipientAddresses = {};
  for (const [tenantId, address] of Object.entries(overrides)) {
    const clean = String(address ?? "").trim();
    if (clean.length > 500) return { ok: false, error: "A recipient address must be 500 characters or fewer." };
    if (clean) recipientAddresses[tenantId] = clean;
  }
  return {
    ok: true,
    clean: {
      name: name || "Mailing batch",
      templateId,
      tenantIds,
      returnAddress: returnAddress.trim(),
      recipientAddresses,
    },
  };
}

// Counts a batch's letters by status for the queue dashboard.
export function summarizeBatchLetters(letters = []) {
  const summary = { total: 0, queued: 0, mailed: 0, delivered: 0 };
  for (const letter of letters || []) {
    summary.total += 1;
    if (letter.status === "mailed") summary.mailed += 1;
    else if (letter.status === "delivered") summary.delivered += 1;
    else summary.queued += 1;
  }
  return summary;
}

// Plain-text rendering of a letter for the file-library copy (and the
// print view). The rendered body is stored verbatim on the letter row, so
// this is the compliance artifact, not a draft.
export function formatLetterForFile({ subject, body, tenantName, tenantAddress, returnAddress, letterDate }) {
  const lines = [];
  if (returnAddress) lines.push(returnAddress, "");
  if (letterDate) lines.push(letterDate, "");
  lines.push(tenantName || "", tenantAddress || "", "");
  if (subject) lines.push(`Re: ${subject}`, "");
  lines.push("VIA CERTIFIED MAIL", "", body || "");
  return lines.join("\n");
}
