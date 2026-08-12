import { describe, expect, it } from "vitest";
import { createRentReportingEnrollment } from "../rent-reporting.types";
const base = { id: "reporting_1", tenantId: "tenant_1", leaseId: "lease_1", provider: "boom",
  providerEnrollmentId: null, furnisherName: "Boom", status: "pending" as const, monthlyFeeCents: 500,
  currencyCode: "usd", consentTextVersion: "rent-reporting-v1", consentedAt: "2026-08-12T00:00:00Z",
  cancelledAt: null, createdAt: "2026-08-12T00:00:00Z", updatedAt: "2026-08-12T00:00:00Z" };
describe("rent reporting enrollment", () => {
  it("records explicit consent and a separate monthly fee", () => {
    expect(createRentReportingEnrollment(base)).toMatchObject({ monthlyFeeCents: 500, currencyCode: "USD", consentTextVersion: "rent-reporting-v1" });
  });
  it("does not call an enrollment active without the vendor reference", () => {
    expect(() => createRentReportingEnrollment({ ...base, status: "active" })).toThrow("provider enrollment id");
  });
  it("requires cancellation evidence", () => {
    expect(() => createRentReportingEnrollment({ ...base, status: "cancelled" })).toThrow("cancelledAt");
  });
});
