import { describe, expect, it } from "vitest";

import { createRentalLease } from "../rental-lease.types";

function buildLease(overrides = {}) {
  return {
    id: "lease_kent_1",
    propertyId: "4800-kent-ave",
    unitId: "unit_kent_main",
    tenantIds: ["tenant_1"],
    status: "draft" as const,
    startDate: "2026-09-01",
    endDate: "2027-08-31",
    monthlyRentCents: 125000,
    currencyCode: "usd",
    rentDueDay: 1,
    documentEvidenceId: null,
    activatedAt: null,
    endedAt: null,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
    notes: null,
    ...overrides,
  };
}

describe("RentalLease", () => {
  it("creates an immutable lease and normalizes tenant and currency values", () => {
    const lease = createRentalLease(buildLease({
      tenantIds: [" tenant_1 ", "tenant_1"],
      notes: "  Kent Avenue first tenant.  ",
    }));

    expect(lease.tenantIds).toEqual(["tenant_1"]);
    expect(lease.currencyCode).toBe("USD");
    expect(lease.notes).toBe("Kent Avenue first tenant.");
    expect(Object.isFrozen(lease)).toBe(true);
    expect(Object.isFrozen(lease.tenantIds)).toBe(true);
  });

  it.each(["draft", "active", "ended", "terminated", "cancelled"] as const)(
    "supports %s leases",
    (status) => {
      expect(createRentalLease(buildLease({ status })).status).toBe(status);
    },
  );

  it.each([
    ["id", { id: "" }],
    ["property", { propertyId: "" }],
    ["unit", { unitId: "" }],
    ["tenant", { tenantIds: [] }],
    ["rent", { monthlyRentCents: 0 }],
    ["integer rent", { monthlyRentCents: 1.5 }],
    ["due day", { rentDueDay: 29 }],
    ["currency", { currencyCode: "US" }],
    ["start date", { startDate: "not-a-date" }],
    ["date order", { endDate: "2026-08-31" }],
    ["activation", { activatedAt: "not-a-date" }],
  ])("rejects an invalid %s", (_label, overrides) => {
    expect(() => createRentalLease(buildLease(overrides))).toThrow();
  });

  it("rejects unsupported statuses", () => {
    expect(() => createRentalLease(buildLease({ status: "unknown" }) as never))
      .toThrow("Rental lease requires a supported status.");
  });

  // Rentec-parity R10: begin-charges date, distinct from the move-in date.
  it("defaults the begin-charges date to the move-in date when omitted", () => {
    expect(createRentalLease(buildLease()).beginChargesDate).toBe("2026-09-01");
    expect(createRentalLease(buildLease({ beginChargesDate: null as unknown as string })).beginChargesDate).toBe("2026-09-01");
  });
  it("keeps an explicit begin-charges date distinct from the move-in date", () => {
    const lease = createRentalLease(buildLease({ startDate: "2026-08-28", beginChargesDate: "2026-09-01" }));
    expect(lease.startDate).toBe("2026-08-28");
    expect(lease.beginChargesDate).toBe("2026-09-01");
  });
  it("rejects an invalid begin-charges date", () => {
    expect(() => createRentalLease(buildLease({ beginChargesDate: "09/01/2026" }))).toThrow();
  });
});
