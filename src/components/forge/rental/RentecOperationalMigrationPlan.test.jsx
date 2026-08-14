import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentecOperationalMigrationPlan from "./RentecOperationalMigrationPlan.jsx";

describe("RentecOperationalMigrationPlan", () => {
  it("shows grouped actions without private record details or write controls", () => {
    const html = renderToStaticMarkup(<RentecOperationalMigrationPlan plan={{
      properties: { create: 2, link: 20, skip: 1, review: 2 },
      tenants: { create: 10, link: 5, skip: 56, review: 21 },
      leases: { create: 3, link: 1, skip: 20, review: 2 },
      reviewReasons: [{ label: "Lease depends on an unresolved property or tenant", count: 2 }],
    }}/>);
    expect(html).toContain("Operational migration plan");
    expect(html).toContain("Properties and units");
    expect(html).toContain("Why records are skipped or require review");
    expect(html).toContain("no property, renter, lease, or membership record was written");
    expect(html).not.toContain("Import now");
  });
});
