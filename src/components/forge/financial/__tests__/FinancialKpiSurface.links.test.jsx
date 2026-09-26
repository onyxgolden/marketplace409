import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import FinancialKpiSurface from "../FinancialKpiSurface.jsx";
import {
  FINANCIAL_KPI_DEEP_LINKS,
} from "../dashboardCardLayout.js";

// Proves the card-system path wires every KPI number to its deep link: the
// page builds kpi.href from FINANCIAL_KPI_DEEP_LINKS, and the surface must
// render each tile's number as a link to exactly that route.
describe("FinancialKpiSurface deep links", () => {
  const kpis = [
    { id: "equity", label: "Net Worth / Equity", value: "$725,000", detail: "Assets $900,000 · Liabilities $175,000", href: FINANCIAL_KPI_DEEP_LINKS.equity },
    { id: "cash", label: "Cash", value: "$125,000", detail: "Receivables $0", href: FINANCIAL_KPI_DEEP_LINKS.cash },
    { id: "profit", label: "Monthly Profit", value: "$18,500", detail: "Revenue retained after expenses", href: FINANCIAL_KPI_DEEP_LINKS.profit },
    { id: "margin", label: "Profit Margin", value: "24.5%", detail: "Revenue retained after expenses", href: FINANCIAL_KPI_DEEP_LINKS.margin },
  ];

  it("renders every KPI number as a link to its expected route (card system on)", () => {
    const markup = renderToStaticMarkup(
      <FinancialKpiSurface
        kpis={kpis}
        cardLayoutStorageKey="test-kpi-links"
      />,
    );

    for (const kpi of kpis) {
      expect(markup).toContain(`href="${kpi.href}"`);
    }
    const linkCount = markup.split("data-dashboard-card-link").length - 1;
    expect(linkCount).toBe(4);
  });

  it("renders every KPI number as a link to its expected route (static surface)", () => {
    const markup = renderToStaticMarkup(
      <FinancialKpiSurface kpis={kpis} />,
    );

    for (const kpi of kpis) {
      expect(markup).toContain(`href="${kpi.href}"`);
    }
    const linkCount = markup.split("data-dashboard-card-link").length - 1;
    expect(linkCount).toBe(4);
  });

  it("leaves tile numbers as static text when a KPI has no href", () => {
    const markup = renderToStaticMarkup(
      <FinancialKpiSurface
        kpis={[{ id: "equity", label: "Net Worth / Equity", value: "$725,000" }]}
      />,
    );

    expect(markup).toContain("$725,000");
    expect(markup).not.toContain("data-dashboard-card-link");
  });
});
