// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RentalOverviewPanel from "./RentalOverviewPanel";

const baseData = { units: [{ id: "u1" }], leases: [{ id: "l1", unit_id: "u1", status: "active" }] };

// Rendered-component regression guard for the rental billing cutover containment correction: the
// dashboard must never render an externally-managed obligation as FORGE "Overdue rent" — it must
// remain visible, but only under the separate "Externally managed — reconciliation required" tile.
describe("RentalOverviewPanel (rendered markup)", () => {
  it("does not render the $14,270 externally-managed balance as Overdue rent, and renders it under Externally managed — reconciliation required", () => {
    const report = { summary: { overdueBalanceCents: 0, externallyManagedCents: 1427000, externallyManagedChargeCount: 9, monthlyScheduledCents: 200000, collectedCents: 0 } };
    const markup = renderToStaticMarkup(<RentalOverviewPanel initialData={baseData} initialReport={report} />);
    expect(markup).toContain("Externally managed — reconciliation required");
    expect(markup).toContain("$14,270.00");
    expect(markup).toContain("Overdue rent (FORGE)");
    expect(markup).not.toMatch(/Overdue rent \(FORGE\)<\/span><strong[^>]*>\$14,270\.00/);
  });

  it("renders FORGE overdue as zero and does not confuse it with the externally-managed figure", () => {
    const report = { summary: { overdueBalanceCents: 0, externallyManagedCents: 1427000, externallyManagedChargeCount: 9, monthlyScheduledCents: 200000, collectedCents: 0 } };
    const markup = renderToStaticMarkup(<RentalOverviewPanel initialData={baseData} initialReport={report} />);
    expect(markup).toContain("$0.00");
  });

  it("renders a nonzero FORGE overdue figure once a lease is actually cut over and collectible", () => {
    const report = { summary: { overdueBalanceCents: 20000, externallyManagedCents: 0, externallyManagedChargeCount: 0, monthlyScheduledCents: 200000, collectedCents: 0 } };
    const markup = renderToStaticMarkup(<RentalOverviewPanel initialData={baseData} initialReport={report} />);
    expect(markup).toContain("$200.00");
  });
});
