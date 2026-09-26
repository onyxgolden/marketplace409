import { describe, expect, it } from "vitest";
import { buildTenantInviteEmail, buildTenantInviteIdempotencyKey } from "../tenantInviteEmail.js";

describe("buildTenantInviteIdempotencyKey", () => {
  it("builds a stable per-tenant per-day key", () => {
    const key = buildTenantInviteIdempotencyKey({ tenantId: "tenant_1", asOfDate: "2026-09-25" });
    expect(key).toBe("tenant-invite-tenant_1-2026-09-25");
    expect(buildTenantInviteIdempotencyKey({ tenantId: "tenant_1", asOfDate: "2026-09-26" })).not.toBe(key);
  });

  it("rejects invalid input", () => {
    expect(() => buildTenantInviteIdempotencyKey({ tenantId: "", asOfDate: "2026-09-25" })).toThrow();
    expect(() => buildTenantInviteIdempotencyKey({ tenantId: "t1", asOfDate: "not-a-date" })).toThrow();
  });
});

describe("buildTenantInviteEmail", () => {
  const portalUrl = "https://example.com/forge/rental/portal";

  it("addresses the tenant and names their email for sign-in", () => {
    const { subject, bodyText } = buildTenantInviteEmail({
      tenantName: "Eric Carrillo", tenantEmail: "eric@example.com", leaseSummary: null, portalUrl,
    });
    expect(subject).toContain("portal");
    expect(bodyText).toContain("Hello Eric Carrillo");
    expect(bodyText).toContain("eric@example.com");
    expect(bodyText).toContain(portalUrl);
  });

  it("includes the lease summary when the invite follows lease creation", () => {
    const { bodyText } = buildTenantInviteEmail({
      tenantName: "Eric", tenantEmail: "e@example.com",
      leaseSummary: { unitLabel: "1214 Wagner", monthlyRentCents: 160000, startDate: "2026-08-29" },
      portalUrl,
    });
    expect(bodyText).toContain("1214 Wagner");
    expect(bodyText).toContain("$1600.00");
    expect(bodyText).toContain("2026-08-29");
  });

  it("works without a lease summary", () => {
    const { bodyText } = buildTenantInviteEmail({
      tenantName: "Eric", tenantEmail: "e@example.com", leaseSummary: null, portalUrl,
    });
    expect(bodyText).toContain("portal");
  });

  it("never puts tenant identity in the portal URL", () => {
    expect(portalUrl).not.toContain("?");
  });

  it("refuses collection language", () => {
    expect(() => buildTenantInviteEmail({
      tenantName: "Overdue Eric", tenantEmail: "e@example.com", leaseSummary: null, portalUrl,
    })).toThrow(/late-fee or collection language/);
  });
});
