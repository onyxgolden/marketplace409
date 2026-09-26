// Pure content builder for the tenant join-up invite email.
//
// Sent when the owner explicitly presses "send invite" for a tenant. This is
// an onboarding message only: it names the portal and the next steps, never
// amounts owed (payment reminders have their own lifecycle) and never
// late-fee / collection language.

const COLLECTION_LANGUAGE = /late fee|late charge|past due|overdue|collection|delinquent/i;

// Developer-controlled copy only: every line below is static template text
// with {placeholders}. Tenant-provided values (names, property labels) are
// interpolated AFTER the guard check, so a tenant legitimately named
// "Overdue Eric" or a property called "Collection House" can never trip it.
const INVITE_SUBJECT = "You're invited to your FORGE tenant portal";

const INVITE_BODY_TEMPLATE = [
  "Hello {tenantName},",
  "",
  "Your landlord has invited you to your FORGE tenant portal, where you can view your lease, balance, and payment options.",
  "{leaseBlock}",
  "Next steps:",
  "1. Open the tenant portal link below.",
  "2. Create your free FORGE account with this exact email address: {tenantEmail}",
  "   If you already have a FORGE account, sign in with this exact email address instead.",
  "   A different email address will not connect to your lease.",
  "3. Confirm your email address by clicking the confirmation link in the email we send you.",
  "   This step is required — your lease details cannot appear until your email is confirmed.",
  "4. Your lease details will appear automatically once your confirmed account is linked.",
  "",
  "{portalUrl}",
  "",
  "If you already have portal access, please disregard this message.",
].join("\n");

const LEASE_BLOCK_TEMPLATE = [
  "",
  "Property: {unitLabel}",
  "Monthly rent: {monthlyRent}",
  "Lease starts: {startDate}",
  "",
].join("\n");

// Fail fast at import: if a future edit puts late-fee or collection language
// into the developer-written template, the module refuses to load instead of
// letting the copy reach a tenant.
const TEMPLATE_TEXT = `${INVITE_SUBJECT}\n${INVITE_BODY_TEMPLATE}\n${LEASE_BLOCK_TEMPLATE}`;
if (COLLECTION_LANGUAGE.test(TEMPLATE_TEXT)) {
  throw new Error("Tenant invite email template must not contain late-fee or collection language.");
}

function formatCentsAsUsd(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

// Deterministic 32-bit FNV-1a hash, hex-encoded. Used only to distinguish
// changed invitation payloads inside the idempotency key — not security.
export function fingerprintString(value) {
  let hash = 0x811c9dc5;
  const text = String(value ?? "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// One invite email per tenant per day per distinct invitation payload: the key
// doubles as the Resend idempotency key (the provider sends an Idempotency-Key
// header), so a double click or retried request resolves to a single email.
// The payload fingerprint means a legitimate same-day change (corrected email
// address, corrected lease summary) produces a different key and actually
// sends, while retrying the identical invitation reuses the key and dedups.
export function buildTenantInviteIdempotencyKey({ tenantId, asOfDate, payloadFingerprint }) {
  if (!tenantId || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate || "") || !/^[0-9a-f]{8}$/.test(payloadFingerprint || "")) {
    throw new Error("A tenant id, YYYY-MM-DD date, and payload fingerprint are required.");
  }
  return `tenant-invite-${tenantId}-${asOfDate}-${payloadFingerprint}`;
}

// leaseSummary: { unitLabel, monthlyRentCents, startDate } | null
export function buildTenantInviteEmail({ tenantName, tenantEmail, leaseSummary, portalUrl }) {
  const greeting = (tenantName || "").trim() || "there";
  const leaseBlock = leaseSummary
    ? LEASE_BLOCK_TEMPLATE
      .replace("{unitLabel}", leaseSummary.unitLabel)
      .replace("{monthlyRent}", formatCentsAsUsd(leaseSummary.monthlyRentCents))
      .replace("{startDate}", leaseSummary.startDate)
    : "";
  const bodyText = INVITE_BODY_TEMPLATE
    .replace("{tenantName}", greeting)
    .replace("{leaseBlock}", leaseBlock)
    .replace("{tenantEmail}", tenantEmail)
    .replace("{portalUrl}", portalUrl);
  return { subject: INVITE_SUBJECT, bodyText };
}
