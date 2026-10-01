import { describe, expect, it } from "vitest";
import {
  resolveStatementRecipient,
  buildTenantStatementEmail,
  buildTenantInvoiceEmail,
  buildStatementEventKey,
  buildInvoiceEventKey,
  statementPayloadFingerprint,
} from "./tenantStatementEmail";

const ENTRIES = [
  { kind: "charge", date: "2026-09-01", label: "Rent", amountCents: 160000, balanceAfterCents: 160000, status: "paid" },
  { kind: "payment", date: "2026-09-03", label: "Payment", amountCents: 160000, balanceAfterCents: 0, status: "succeeded" },
  { kind: "charge", date: "2026-10-01", label: "Rent", amountCents: 160000, balanceAfterCents: 160000, status: "due" },
];

describe("resolveStatementRecipient", () => {
  it("returns the trimmed lowercase email from the tenant record", () => {
    expect(resolveStatementRecipient({ email: "  Eric@Example.com " })).toBe("eric@example.com");
  });
  it("throws a clear error when the tenant has no email on file", () => {
    expect(() => resolveStatementRecipient({ email: null })).toThrow("does not have a valid email address");
    expect(() => resolveStatementRecipient({})).toThrow("does not have a valid email address");
  });
  it("throws a clear error for a malformed email", () => {
    expect(() => resolveStatementRecipient({ email: "not-an-email" })).toThrow("does not have a valid email address");
  });
});

describe("buildTenantStatementEmail", () => {
  it("renders the ledger table with debit, credit, and running balance", () => {
    const rendered = buildTenantStatementEmail({
      tenantName: "Eric Carrillo", propertyLabel: "308 Paula", unitLabel: "Unit A",
      asOfDate: "2026-09-30", entries: ENTRIES, balanceCents: 160000,
    });
    expect(rendered.subject).toContain("rent statement");
    expect(rendered.bodyText).toContain("Eric Carrillo");
    expect(rendered.bodyText).toContain("308 Paula");
    // Debit column for the charge, credit column for the payment.
    expect(rendered.bodyText).toContain("$1600.00");
    expect(rendered.bodyText).toContain("Balance due: $1600.00");
  });
  it("shows a zero balance when fully paid", () => {
    const rendered = buildTenantStatementEmail({
      tenantName: "T", asOfDate: "2026-09-30",
      entries: ENTRIES.slice(0, 2), balanceCents: 0,
    });
    expect(rendered.bodyText).toContain("Balance due: $0.00");
  });
  it("handles an empty ledger without crashing", () => {
    const rendered = buildTenantStatementEmail({ tenantName: "T", asOfDate: "2026-09-30", entries: [], balanceCents: 0 });
    expect(rendered.bodyText).toContain("Balance due: $0.00");
  });
});

describe("buildTenantInvoiceEmail", () => {
  it("renders the invoice with amount, paid, and remaining", () => {
    const rendered = buildTenantInvoiceEmail({
      tenantName: "Eric Carrillo", propertyLabel: "308 Paula",
      charge: { id: "c1", label: "Rent", period: "2026-10", dueDate: "2026-10-01", amountCents: 160000, paidCents: 60000, status: "partially_paid" },
    });
    expect(rendered.subject).toContain("Invoice");
    expect(rendered.bodyText).toContain("Amount: $1600.00");
    expect(rendered.bodyText).toContain("Paid: $600.00");
    expect(rendered.bodyText).toContain("Balance due: $1000.00");
  });
});

describe("idempotency keys", () => {
  it("builds distinct keys per tenant/date/payload", () => {
    const a = buildStatementEventKey({ tenantId: "t1", asOfDate: "2026-09-30", payloadFingerprint: "aaa" });
    const b = buildStatementEventKey({ tenantId: "t1", asOfDate: "2026-09-30", payloadFingerprint: "bbb" });
    expect(a).not.toBe(b);
    expect(a).toContain("t1");
  });
  it("builds distinct invoice keys per charge/payload", () => {
    expect(buildInvoiceEventKey({ chargeId: "c1", payloadFingerprint: "aaa" }))
      .not.toBe(buildInvoiceEventKey({ chargeId: "c2", payloadFingerprint: "aaa" }));
  });
  it("fingerprints are stable for identical payloads", () => {
    const rendered = buildTenantStatementEmail({ tenantName: "T", asOfDate: "2026-09-30", entries: ENTRIES, balanceCents: 1 });
    expect(statementPayloadFingerprint(rendered)).toBe(statementPayloadFingerprint(rendered));
  });
});
