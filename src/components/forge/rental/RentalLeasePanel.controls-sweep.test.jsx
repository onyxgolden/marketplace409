import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalLeasePanel from "./RentalLeasePanel";

const baseSetup = {
  units: [{ id: "unit_1", label: "1218 Wagner", property_id: "1218-wagner" }],
  tenants: [{ id: "tenant_1", display_name: "Anthony Babino", email: "a@example.com" }],
  schedules: [{ id: "schedule_1", lease_id: "lease_1", status: "active" }],
  leaseMemberships: [],
};

describe("RentalLeasePanel controls sweep — B1 end lease", () => {
  it("shows an End this lease action for an active lease", () => {
    const setup = { ...baseSetup, leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "1218-wagner", status: "active", monthly_rent_cents: 130000, rent_due_day: 1, start_date: "2026-08-01" }] };
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={setup} loadOnMount={false} />);
    expect(markup).toContain("End this lease");
  });

  it("shows no End this lease action for draft or ended leases", () => {
    for (const status of ["draft", "ended", "cancelled"]) {
      const setup = { ...baseSetup, leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "1218-wagner", status, monthly_rent_cents: 130000, rent_due_day: 1, start_date: "2026-08-01" }] };
      const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={setup} loadOnMount={false} />);
      expect(markup).not.toContain("End this lease");
    }
  });
});
