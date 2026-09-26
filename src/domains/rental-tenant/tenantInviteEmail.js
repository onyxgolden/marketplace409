// Pure content builder for the tenant join-up invite email.
//
// Sent when the owner explicitly presses "send invite" for a tenant. This is
// an onboarding message only: it names the portal and the next steps, never
// amounts owed (payment reminders have their own lifecycle) and never
// late-fee / collection language.

const COLLECTION_LANGUAGE = /late fee|late charge|past due|overdue|collection|delinquent/i;

function formatCentsAsUsd(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

// One invite email per tenant per day: the key doubles as the Resend
// idempotency key (the provider sends an Idempotency-Key header), so a double
// click or retried request resolves to a single email.
export function buildTenantInviteIdempotencyKey({ tenantId, asOfDate }) {
  if (!tenantId || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate || "")) {
    throw new Error("A tenant id and YYYY-MM-DD date are required.");
  }
  return `tenant-invite-${tenantId}-${asOfDate}`;
}

// leaseSummary: { unitLabel, monthlyRentCents, startDate } | null
export function buildTenantInviteEmail({ tenantName, tenantEmail, leaseSummary, portalUrl }) {
  const greeting = (tenantName || "").trim() || "there";
  const subject = "You're invited to your FORGE tenant portal";
  const lines = [
    `Hello ${greeting},`,
    "",
    "Your landlord has invited you to your FORGE tenant portal, where you can view your lease, balance, and payment options.",
  ];
  if (leaseSummary) {
    lines.push(
      "",
      `Property: ${leaseSummary.unitLabel}`,
      `Monthly rent: ${formatCentsAsUsd(leaseSummary.monthlyRentCents)}`,
      `Lease starts: ${leaseSummary.startDate}`,
    );
  }
  lines.push(
    "",
    "Next steps:",
    "1. Open the tenant portal link below.",
    `2. Sign in with this email address: ${tenantEmail}`,
    "3. Your lease details will appear automatically once your account is linked.",
    "",
    portalUrl,
    "",
    "If you already have portal access, please disregard this message.",
  );
  const bodyText = lines.join("\n");
  if (COLLECTION_LANGUAGE.test(subject) || COLLECTION_LANGUAGE.test(bodyText)) {
    throw new Error("Tenant invite email content must not contain late-fee or collection language.");
  }
  return { subject, bodyText };
}
