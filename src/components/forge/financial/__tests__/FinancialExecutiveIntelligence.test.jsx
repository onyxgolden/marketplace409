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
  "@/components/forge/ForgeExecutiveBriefing",
  () => ({
    default: function MockForgeExecutiveBriefing({
      executiveBriefing,
      riskAssessment,
      variant,
    }) {
      return (
        <section data-executive-briefing>
          <div>{variant}</div>
          <div>{executiveBriefing.headline}</div>
          <div>{executiveBriefing.overview}</div>
          <div>{executiveBriefing.outlook}</div>
          <div>
            {riskAssessment.recommendations.join(", ")}
          </div>
        </section>
      );
    },
  }),
);

vi.mock(
  "@/components/forge/ForgeRiskCenter",
  () => ({
    default: function MockForgeRiskCenter({
      riskSummary,
      riskAssessment,
    }) {
      return (
        <section data-risk-center>
          <div>{riskSummary.status}</div>
          <div>{riskSummary.score}</div>
          <div>{riskSummary.summary}</div>
          <div>
            {riskAssessment.primaryDrivers.length}
          </div>
        </section>
      );
    },
  }),
);

vi.mock(
  "@/components/forge/ForgeInsights",
  () => ({
    default: function MockForgeInsights({
      insights,
      variant,
    }) {
      return (
        <section data-forge-insights>
          <div>{variant}</div>
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
  "@/components/forge/ForgeExecutiveCopilot",
  () => ({
    default: function MockForgeExecutiveCopilot({
      executiveBriefing,
      riskAssessment,
    }) {
      return (
        <section data-executive-copilot>
          <div>{executiveBriefing.outlook}</div>
          <div>
            {riskAssessment.recommendations.join(", ")}
          </div>
        </section>
      );
    },
  }),
);

import FinancialExecutiveIntelligence from "../FinancialExecutiveIntelligence.jsx";

const executiveBriefing = {
  headline: "Cash remains resilient",
  overview: "Operating performance is stable.",
  outlook: "Continue monitoring receivables.",
};

const riskSummary = {
  status: "Monitor",
  score: 24,
  summary: "Risk remains controlled.",
};

const riskAssessment = {
  primaryDrivers: [
    {
      accountId: "receivables",
      sourceFindingType: "aging",
    },
  ],
  trendIndicators: ["Collections slowed"],
  recommendations: ["Review overdue balances"],
};

describe("FinancialExecutiveIntelligence", () => {
  it("composes presentation-ready executive intelligence", () => {
    const markup = renderToStaticMarkup(
      <FinancialExecutiveIntelligence
        executiveBriefing={executiveBriefing}
        riskSummary={riskSummary}
        riskAssessment={riskAssessment}
        insights={[
          {
            label: "Margin",
            detail: "Margin remains above plan.",
          },
        ]}
      />,
    );

    expect(markup).toContain(
      "data-financial-executive-intelligence",
    );
    expect(markup).toContain(
      'data-financial-intelligence-variant="workspace"',
    );
    expect(markup).toContain(
      "Cash remains resilient",
    );
    expect(markup).toContain("Monitor");
    expect(markup).toContain("24");
    expect(markup).toContain("Margin");
    expect(markup).toContain(
      "Margin remains above plan.",
    );
    expect(markup).toContain(
      "Review overdue balances",
    );
    expect(markup).toContain(
      "data-executive-copilot",
    );
  });

  it("supports embedded live-application composition", () => {
    const markup = renderToStaticMarkup(
      <FinancialExecutiveIntelligence
        variant="embedded"
        executiveBriefing={executiveBriefing}
        riskSummary={riskSummary}
        riskAssessment={riskAssessment}
      />,
    );

    expect(markup).toContain(
      'data-financial-intelligence-variant="embedded"',
    );
    expect(markup).toContain("space-y-4");

    const embeddedCount =
      markup.split("embedded").length - 1;

    expect(embeddedCount).toBeGreaterThanOrEqual(3);
  });

  it("falls back to workspace spacing for unknown variants", () => {
    const markup = renderToStaticMarkup(
      <FinancialExecutiveIntelligence
        variant="unknown"
        executiveBriefing={executiveBriefing}
        riskSummary={riskSummary}
        riskAssessment={riskAssessment}
      />,
    );

    expect(markup).toContain(
      'data-financial-intelligence-variant="unknown"',
    );
    expect(markup).toContain("space-y-6");
  });
});
