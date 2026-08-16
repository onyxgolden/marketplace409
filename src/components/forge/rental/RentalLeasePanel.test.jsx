import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalLeasePanel from "./RentalLeasePanel";

const draftSetup = {
  units: [{ id: "unit_1", label: "1218 Wagner", property_id: "1218-wagner" }],
  tenants: [{ id: "tenant_1", display_name: "Anthony Babino", email: "a@example.com" }],
  leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "1218-wagner", status: "draft", monthly_rent_cents: 130000, rent_due_day: 1, start_date: "2026-08-01", end_date: "2027-08-01" }],
  schedules: [{ id: "schedule_1", lease_id: "lease_1", status: "draft" }],
};

describe("RentalLeasePanel", () => {
  it("shows an Activate lease button for a draft lease", () => {
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={draftSetup} loadOnMount={false} />);
    expect(markup).toContain("Activate lease");
    expect(markup).toContain("draft");
  });
  it("does not show an Activate lease button once the lease is active", () => {
    const activeSetup = { ...draftSetup, leases: [{ ...draftSetup.leases[0], status: "active" }] };
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={activeSetup} loadOnMount={false} />);
    expect(markup).not.toContain("Activate lease");
  });
});
