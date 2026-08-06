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

import FinancialWorkspaceHeader from "../FinancialWorkspaceHeader.jsx";

describe("FinancialWorkspaceHeader", () => {
  it("renders presentation-ready health and KPI values", () => {
    const markup = renderToStaticMarkup(
      <FinancialWorkspaceHeader
        health={{
          label: "Healthy",
          detail: "All financial services are available.",
        }}
        kpis={[
          {
            id: "equity",
            label: "Net Worth / Equity",
            value: "$725,000",
            detail: "Assets $900,000 · Liabilities $175,000",
          },
          {
            id: "margin",
            label: "Profit Margin",
            value: "24.5%",
            detail: "Revenue retained after expenses",
          },
        ]}
      />,
    );

    expect(markup).toContain(
      "data-financial-workspace-header",
    );
    expect(markup).toContain(
      'data-financial-header-variant="workspace"',
    );
    expect(markup).toContain(
      "FORGE Financial Command",
    );
    expect(markup).toContain(
      "Executive KPI Dashboard",
    );
    expect(markup).toContain("Health Status");
    expect(markup).toContain("Healthy");
    expect(markup).toContain(
      "All financial services are available.",
    );
    expect(markup).toContain(
      "data-financial-kpi-surface",
    );
    expect(markup).toContain("Net Worth / Equity");
    expect(markup).toContain("$725,000");
    expect(markup).toContain("Profit Margin");
    expect(markup).toContain("24.5%");
  });

  it("renders stable loading defaults", () => {
    const markup = renderToStaticMarkup(
      <FinancialWorkspaceHeader />,
    );

    expect(markup).toContain(
      "FORGE Financial Command",
    );
    expect(markup).toContain(
      "Executive KPI Dashboard",
    );
    expect(markup).toContain("Loading");
    expect(markup).toContain(
      "Financial health is being prepared.",
    );
    expect(markup).toContain(
      "data-financial-kpi-surface",
    );
  });

  it("supports an embedded live-application presentation", () => {
    const markup = renderToStaticMarkup(
      <FinancialWorkspaceHeader
        variant="embedded"
        eyebrow="Financial"
        title="Cash and Margin"
        description="Current financial position."
      />,
    );

    expect(markup).toContain(
      'data-financial-header-variant="embedded"',
    );
    expect(markup).toContain("space-y-4");
    expect(markup).toContain("text-2xl");
    expect(markup).toContain("Cash and Margin");
  });

  it("falls back to workspace styling for unknown variants", () => {
    const markup = renderToStaticMarkup(
      <FinancialWorkspaceHeader
        variant="unknown"
      />,
    );

    expect(markup).toContain(
      'data-financial-header-variant="unknown"',
    );
    expect(markup).toContain("space-y-6");
    expect(markup).toContain("text-4xl");
  });
});
