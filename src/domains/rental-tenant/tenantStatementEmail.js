// Pure content builders for owner-triggered tenant statement / invoice emails.
// Rentec parity R2.
//
// The statement reuses the tenant ledger read model (buildTenantPaymentLedger):
// the emailed statement is the same Date / Description / Debit / Credit /
// Balance table the ledger page prints, rendered as plain text. There is
// exactly one statement layout — this module renders it for email; the page
// renders it for print. Do not fork a second layout.
//
// Tone: a factual accounting document. Amounts owed are the point of a
// statement (unlike the portal invite, which must never carry them).

import { fingerprintString } from "./tenantInviteEmail";

const EMAIL_RE = /^\S+@\S+\.\S+$/;

function formatCents(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
}

function padRight(text, width) {
  const str = String(text ?? "");
  return str.length >= width ? str.slice(0, width) : str + " ".repeat(width - str.length);
}

function padLeft(text, width) {
  const str = String(text ?? "");
  return str.length >= width ? str.slice(0, width) : " ".repeat(width - str.length) + str;
}

// The recipient always comes from the owner's own tenant record — never
// free-form input — so the endpoint cannot be repurposed as a relay.
export function resolveStatementRecipient(tenant) {
  const email = String(tenant?.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new Error("The tenant does not have a valid email address on file.");
  }
  return email;
}

function statementEntryLine(entry) {
  const isCharge = entry.kind === "charge";
  const isPayment = entry.kind === "payment";
  const debit = isCharge ? formatCents(entry.amountCents) : "";
  const credit = isPayment ? formatCents(entry.amountCents) : "";
  const balance = formatCents(entry.balanceAfterCents);
  return `${padRight(formatDate(entry.date), 12)}${padRight(entry.label || "", 38)}${padLeft(debit, 12)}${padLeft(credit, 12)}${padLeft(balance, 14)}`;
}

// Full tenant statement email from the ledger read model. entries must be the
// chronological entries from buildTenantPaymentLedger (they carry
// balanceAfterCents); balanceCents is the final running balance.
export function buildTenantStatementEmail({ tenantName, propertyLabel, unitLabel, asOfDate, entries, balanceCents, senderName }) {
  const rows = Array.isArray(entries) ? entries : [];
  const header = [
    `${senderName || "FORGE Rental Manager"} — Tenant Statement`,
    `Tenant: ${tenantName || "Tenant"}`,
    [propertyLabel, unitLabel].filter(Boolean).join(" · ") || null,
    `Statement date: ${asOfDate}`,
    "",
    `${padRight("Date", 12)}${padRight("Description", 38)}${padLeft("Debit", 12)}${padLeft("Credit", 12)}${padLeft("Balance", 14)}`,
    "-".repeat(88),
    ...rows.map(statementEntryLine),
    "-".repeat(88),
    `Balance due: ${formatCents(balanceCents)}`,
    "",
    "This statement reflects your ledger as of the date above. Reply to this email or contact your landlord with any questions.",
  ].filter((line) => line !== null);
  const bodyText = header.join("\n");
  return {
    subject: `Your rent statement — ${formatDate(asOfDate)}`,
    bodyText,
  };
}

// Single-invoice email for one charge (the ledger row's "Email invoice").
// charge: { id, chargeType, period, dueDate, amountCents, paidCents, status, notes }.
export function buildTenantInvoiceEmail({ tenantName, propertyLabel, unitLabel, charge, senderName }) {
  const amountCents = Number(charge?.amountCents || 0);
  const paidCents = Number(charge?.paidCents || 0);
  const remainingCents = amountCents - paidCents;
  const bodyText = [
    `${senderName || "FORGE Rental Manager"} — Invoice`,
    `Tenant: ${tenantName || "Tenant"}`,
    [propertyLabel, unitLabel].filter(Boolean).join(" · ") || null,
    "",
    `Invoice: ${charge?.label || charge?.chargeType || "Charge"}${charge?.period ? ` (${charge.period})` : ""}`,
    `Due date: ${formatDate(charge?.dueDate)}`,
    `Amount: ${formatCents(amountCents)}`,
    `Paid: ${formatCents(paidCents)}`,
    `Balance due: ${formatCents(remainingCents)}`,
    charge?.notes ? `Notes: ${charge.notes}` : null,
    "",
    "Please remit payment by the due date above. Reply to this email or contact your landlord with any questions.",
  ].filter((line) => line !== null).join("\n");
  return {
    subject: `Invoice — ${charge?.label || "rent charge"} due ${formatDate(charge?.dueDate)}`,
    bodyText,
  };
}

// Idempotency: a double-click (identical payload) resolves to the same
// event_key and never re-sends; a changed ledger produces a new key and
// actually sends. The key is the outbox event_key AND the provider
// idempotency key.
export function buildStatementEventKey({ tenantId, asOfDate, payloadFingerprint }) {
  return `statement:${tenantId}:${asOfDate}:${payloadFingerprint}`;
}

export function buildInvoiceEventKey({ chargeId, payloadFingerprint }) {
  return `invoice:${chargeId}:${payloadFingerprint}`;
}

export function statementPayloadFingerprint(rendered) {
  return fingerprintString(`${rendered.subject}\n${rendered.bodyText}`);
}
