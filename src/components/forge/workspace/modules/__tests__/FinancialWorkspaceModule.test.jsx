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
  "@/components/forge/workspace/ForgeWorkspaceTile",
  () => ({
    default: function MockForgeWorkspaceTile({
      title,
      status,
      children,
      expandedChildren,
      expandLabel,
      collapseLabel,
    }) {
      return (
        <section data-workspace-tile>
          <div>{title}</div>
          <div>{status}</div>
          <div>{expandLabel}</div>
          <div>{collapseLabel}</div>
          {children}
          <div data-expanded-children>
            {expandedChildren}
          </div>
        </section>
      );
    },
  }),
);

vi.mock(
  "@/components/forge/financial/FinancialKpiSurface",
  () => ({
    default: function MockFinancialKpiSurface({
      kpis,
      variant,
    }) {
      return (
        <section
          data-financial-kpi-surface
          data-variant={variant}
        >
          {kpis.map((kpi) => (
            <div key={kpi.id}>
              {kpi.label} · {kpi.value} ·{" "}
              {kpi.detail}
            </div>
          ))}
        </section>
      );
    },
  }),
);

vi.mock(
  "@/components/forge/financial/FinancialExecutiveIntelligence",
  () => ({
    default: function MockFinancialExecutiveIntelligence({
      variant,
      riskSummary = {
        status: "Loading",
      },
      insights = [],
    }) {
      return (
        <section
          data-financial-executive-intelligence
          data-variant={variant}
        >
          <div>{riskSummary.status}</div>
          {insights.map((insight) => (
            <div key={insight.label}>
              {insight.label} · {insight.detail}
            </div>
          ))}
        </section>
      );
    },
  }),
);

vi.mock(
  "@/components/forge/ForgeExecutiveBriefing",
  () => ({
    default: function MockForgeExecutiveBriefing({
      executiveBriefing,
      variant,
    }) {
      return (
        <section
          data-executive-briefing
          data-variant={variant}
        >
          {executiveBriefing.headline}
        </section>
      );
    },
  }),
);

import {
  FinancialWorkspaceModule,
} from "../FinancialWorkspaceModule.jsx";

describe("FinancialWorkspaceModule", () => {
  it("renders canonical financial read models through the embedded KPI surface", () => {
    const markup = renderToStaticMarkup(
      FinancialWorkspaceModule.renderTile({
        financialKpiModel: {
          type: "kpi-model",
          kpis: {
            equity: 22500000,
            assets: 42500000,
            liabilities: 20000000,
            cash: 12500000,
            receivables: 2500000,
            profit: 1850000,
            revenue: 7500000,
            expenses: 5650000,
            margin: 0.2467,
          },
        },
        financialExecutiveSummary: {
          type: "executive-summary",
          health: {
            label: "Healthy",
            detail:
              "Financial performance is positive.",
          },
        },
        executiveBriefing: {
          headline: "Cash remains resilient",
          overview: "Performance is stable.",
          outlook: "Monitor receivables.",
        },
        riskSummary: {
          status: "Monitor",
          score: 24,
          summary: "Risk remains controlled.",
        },
        riskAssessment: {
          primaryDrivers: [],
          trendIndicators: [],
          recommendations: [],
        },
        insightItems: [
          {
            label: "Receivables",
            detail: "Collections require monitoring.",
          },
        ],
      }),
    );

    expect(markup).toContain(
      "data-workspace-tile",
    );
    expect(markup).toContain(
      "Financial Position",
    );
    expect(markup).toContain("Healthy");
    expect(markup).toContain(
      "data-financial-kpi-surface",
    );
    expect(markup).toContain(
      'data-variant="embedded"',
    );
    expect(markup).toContain(
      "Net Worth / Equity",
    );
    expect(markup).toContain("$225,000");
    expect(markup).toContain("Cash");
    expect(markup).toContain("$125,000");
    expect(markup).toContain(
      "Monthly Profit",
    );
    expect(markup).toContain("$18,500");
    expect(markup).toContain(
      "Profit Margin",
    );
    expect(markup).toContain("24.7%");
    expect(markup).toContain(
      "Cash remains resilient",
    );
    expect(markup).not.toContain(
      "data-financial-expanded-tile",
    );

    expect(markup).not.toContain(
      "Expand financial view",
    );
  });

  it("renders stable tile values while canonical read models are absent", () => {
    const markup = renderToStaticMarkup(
      FinancialWorkspaceModule.renderTile({
        executiveBriefing: {
          headline: "Loading executive briefing",
        },
        riskAssessment: {
          recommendations: [],
        },
      }),
    );

    expect(markup).toContain("Loading");
    expect(markup).toContain("$0");
    expect(markup).toContain("0.0%");
  });
});
