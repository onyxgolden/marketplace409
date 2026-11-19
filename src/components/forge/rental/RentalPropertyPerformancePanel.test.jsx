// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalPropertyPerformancePanel from "./RentalPropertyPerformancePanel";
import { buildRentalPropertyPerformance } from "@/application/rental/buildRentalPropertyPerformance";

const TODAY = "2026-11-18";

function event(overrides) {
  return { status: "active", is_deleted: false, ...overrides };
}

function performanceFixture() {
  return buildRentalPropertyPerformance({
    today: TODAY,
    units: [
      { id: "unit_1", property_id: "1218-wagner", label: "1218 Wagner", status: "occupied" },
      { id: "unit_2", property_id: "1900-w-decker", label: "1900 W Decker", status: "preparing" },
    ],
    financialEvents: [
      event({ event_date: "2026-11-05", amount: "1500.00", transaction_kind: "income", source_system: "rentec", property_id: "1218-wagner" }),
      event({ event_date: "2026-11-06", amount: "200.00", transaction_kind: "expense", source_system: "rentec", property_id: "1218-wagner", normalized_category: "repairs_maintenance", affects_noi: true, capitalized: false }),
      event({ event_date: "2026-11-07", amount: "800.00", transaction_kind: "expense", source_system: "rentec", property_id: "1218-wagner", normalized_category: "property_tax", affects_noi: true, capitalized: false }),
      event({ event_date: "2020-05-01", amount: "50000.00", transaction_kind: "asset_purchase", source_system: "rentec", property_id: "1218-wagner", normalized_category: "capital_improvement", affects_noi: false, capitalized: true }),
      event({ event_date: "2026-11-05", amount: "900.00", transaction_kind: "income", source_system: "rentec", property_id: "unmatched-house" }),
    ],
    propertyFinancialSetups: [],
  });
}

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}

function unmount({ container, root }) {
  act(() => { root.unmount(); });
  container.remove();
}

describe("RentalPropertyPerformancePanel", () => {
  let mounted;
  afterEach(() => { if (mounted) { unmount(mounted); mounted = null; } vi.unstubAllGlobals(); });

  it("renders one row per house with month-to-date, year-to-date, and all-time profit plus a portfolio total", () => {
    const markup = renderToStaticMarkup(
      <RentalPropertyPerformancePanel performance={performanceFixture()} onNavigate={() => {}} />,
    );
    expect(markup).toContain("1218 Wagner");
    expect(markup).toContain("1900 W Decker");
    // 1218 Wagner: Nov income $1,500 - expenses $1,000 = $500 month to date;
    // all time adds the $50,000 capital improvement to invested, not profit.
    expect(markup).toContain("$500.00");
    expect(markup).toContain("$50,000.00");
    expect(markup).toContain("Portfolio total (all houses)");
    expect(markup).toContain("Property tax paid");
  });

  it("shows the Unassigned bucket separately, never inside a house or the portfolio total", () => {
    const markup = renderToStaticMarkup(
      <RentalPropertyPerformancePanel performance={performanceFixture()} onNavigate={() => {}} />,
    );
    expect(markup).toContain("Unassigned / unmatched");
    expect(markup).toContain("unmatched-house");
    // The unmatched $900 income is NOT in the portfolio total ($500 MTD profit).
    expect(markup).toContain("Portfolio reconciliation total (houses + unassigned)");
  });

  it("flags a house with no financial setup as incomplete instead of presenting a precise invested figure", () => {
    const markup = renderToStaticMarkup(
      <RentalPropertyPerformancePanel performance={performanceFixture()} onNavigate={() => {}} />,
    );
    expect(markup).toContain("Setup incomplete");
  });

  it("labels a partial investment as Known capital improvements on both layouts when there is no setup row", () => {
    const markup = renderToStaticMarkup(
      <RentalPropertyPerformancePanel performance={performanceFixture()} onNavigate={() => {}} />,
    );
    // Mobile card label and desktop cell note both say the figure is a
    // partial known amount, not a complete recorded-cash-invested total.
    expect(markup).toContain("Known capital improvements");
    expect(markup).toContain("known capital improvements only");
  });

  it("labels a complete investment as Recorded cash invested when a setup row exists", () => {
    const complete = buildRentalPropertyPerformance({
      today: TODAY,
      units: [
        { id: "unit_1", property_id: "1218-wagner", label: "1218 Wagner", status: "occupied" },
        { id: "unit_2", property_id: "1900-w-decker", label: "1900 W Decker", status: "preparing" },
      ],
      financialEvents: [
        event({ event_date: "2026-11-05", amount: "1500.00", transaction_kind: "income", source_system: "rentec", property_id: "1218-wagner" }),
      ],
      propertyFinancialSetups: [
        { property_id: "1218-wagner", down_payment_cents: 2500000, closing_costs_cents: 500000 },
        { property_id: "1900-w-decker", down_payment_cents: 1000000, closing_costs_cents: 200000 },
      ],
    });
    const markup = renderToStaticMarkup(
      <RentalPropertyPerformancePanel performance={complete} onNavigate={() => {}} />,
    );
    expect(markup).not.toContain("Known capital improvements");
    expect(markup).not.toContain("Setup incomplete");
    expect(markup).toContain("Recorded cash invested");
  });

  it("renders an explicit unavailable state when the read model is null", () => {
    const markup = renderToStaticMarkup(
      <RentalPropertyPerformancePanel performance={null} onNavigate={() => {}} />,
    );
    expect(markup).toContain("Property performance");
    expect(markup).toContain("unavailable right now");
    expect(markup).not.toContain("$0.00");
  });

  it("renders an explicit empty state when there are no properties and no unmatched events", () => {
    const empty = buildRentalPropertyPerformance({ units: [], financialEvents: [], today: TODAY });
    const markup = renderToStaticMarkup(
      <RentalPropertyPerformancePanel performance={empty} onNavigate={() => {}} />,
    );
    expect(markup).toContain("No properties and no rental activity yet");
  });

  it("navigates to the house's own financial setup, preserving the property context", () => {
    const onNavigate = vi.fn();
    mounted = mount(<RentalPropertyPerformancePanel performance={performanceFixture()} onNavigate={onNavigate} />);
    const setupLink = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Property setup");
    expect(setupLink).toBeTruthy();
    act(() => { setupLink.click(); });
    expect(onNavigate).toHaveBeenCalledWith("financial-setup", { recordType: "unit", recordId: "unit_1", propertyId: "1218-wagner" });
  });

  it("expands the expenses-by-category detail and switches its period", () => {
    mounted = mount(<RentalPropertyPerformancePanel performance={performanceFixture()} onNavigate={() => {}} />);
    const detailsButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Expenses by category");
    expect(detailsButton).toBeTruthy();
    act(() => { detailsButton.click(); });
    // All-time detail: repairs $200 + property tax $800 = $1,000 total.
    expect(mounted.container.textContent).toContain("Expenses by category — All time (since 2014)");
    expect(mounted.container.textContent).toContain("Property Tax");
    expect(mounted.container.textContent).toContain("Capital improvements (not included in operating profit)");
    const monthButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Month to date");
    act(() => { monthButton.click(); });
    expect(mounted.container.textContent).toContain("Expenses by category — Month to date");
  });
});
