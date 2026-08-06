import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

vi.mock(
  "@/components/forge/ForgeDashboardCard",
  () => ({
    default: function MockForgeDashboardCard({
      label,
      value,
      detail,
    }) {
      return (
        <article data-forge-dashboard-card>
          <div>{label}</div>
          <div>{value}</div>
          <div>{detail}</div>
        </article>
      );
    },
  }),
);

import FinancialKpiSurface from "../FinancialKpiSurface.jsx";

describe("FinancialKpiSurface", () => {
  it("renders presentation-ready financial KPIs", () => {
    const markup = renderToStaticMarkup(
      <FinancialKpiSurface
        kpis={[
          {
            id: "equity",
            label: "Net Worth / Equity",
            value: "$225,000",
            detail: "Assets $425,000 · Liabilities $200,000",
          },
          {
            id: "cash",
            label: "Cash",
            value: "$125,000",
            detail: "Receivables $0",
          },
        ]}
      />,
    );

    expect(markup).toContain(
      "data-financial-kpi-surface",
    );
    expect(markup).toContain(
      'data-financial-kpi-variant="workspace"',
    );
    expect(markup).toContain("Net Worth / Equity");
    expect(markup).toContain("$225,000");
    expect(markup).toContain("Cash");
    expect(markup).toContain("$125,000");

    const cardCount =
      markup.split("data-forge-dashboard-card")
        .length - 1;

    expect(cardCount).toBe(2);
  });

  it("supports embedded live-tile presentation", () => {
    const markup = renderToStaticMarkup(
      <FinancialKpiSurface
        variant="embedded"
        kpis={[
          {
            id: "profit",
            label: "Monthly Profit",
            value: "$18,500",
            detail: "Revenue retained after expenses",
          },
        ]}
      />,
    );

    expect(markup).toContain(
      'data-financial-kpi-variant="embedded"',
    );
    expect(markup).toContain("gap-3");
    expect(markup).toContain("sm:grid-cols-2");
    expect(markup).toContain("Monthly Profit");
  });

  it("renders an empty surface without inventing KPI values", () => {
    const markup = renderToStaticMarkup(
      <FinancialKpiSurface />,
    );

    expect(markup).toContain(
      "data-financial-kpi-surface",
    );
    expect(markup).not.toContain(
      "data-forge-dashboard-card",
    );
  });

  it("falls back to workspace layout for unknown variants", () => {
    const markup = renderToStaticMarkup(
      <FinancialKpiSurface
        variant="unknown"
      />,
    );

    expect(markup).toContain(
      'data-financial-kpi-variant="unknown"',
    );
    expect(markup).toContain("xl:grid-cols-4");
  });
});
