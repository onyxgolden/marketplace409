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
      showOverview,
      showOutlook,
      showRecommendations,
    }) {
      return (
        <section data-executive-briefing>
          <div>{variant}</div>
          <div>show-overview:{String(showOverview)}</div>
          <div>show-outlook:{String(showOutlook)}</div>
          <div>show-recommendations:{String(showRecommendations)}</div>
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
      showSummary,
      showRecommendations,
    }) {
      return (
        <section data-risk-center>
          <div>show-summary:{String(showSummary)}</div>
          <div>show-risk-recommendations:{String(showRecommendations)}</div>
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
      showOutlook,
    }) {
      return (
        <section data-executive-copilot>
          <div>show-copilot-outlook:{String(showOutlook)}</div>
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

  it("suppresses repeated intelligence while preserving distinct content", () => {
    const repeatedCopy = "Dashboard intelligence is ready.";

    const markup = renderToStaticMarkup(
      <FinancialExecutiveIntelligence
        executiveBriefing={{
          headline: "Dashboard intelligence ready.",
          overview: repeatedCopy,
          outlook: repeatedCopy,
        }}
        riskSummary={{
          status: "Ready",
          score: 0,
          summary: repeatedCopy,
        }}
        riskAssessment={{
          primaryDrivers: [],
          trendIndicators: [],
          recommendations: ["Continue routine monitoring."],
        }}
        insights={[
          {
            label: "Executive Outlook",
            detail: repeatedCopy,
          },
          {
            label: "Distinct Insight",
            detail: "Cash flow remains positive.",
          },
        ]}
      />,
    );

    expect(markup).toContain("show-overview:false");
    expect(markup).toContain("show-outlook:false");
    expect(markup).toContain("show-recommendations:false");
    expect(markup).toContain("show-summary:false");
    expect(markup).toContain("show-risk-recommendations:false");
    expect(markup).not.toContain("Executive Outlook");
    expect(markup).toContain("show-copilot-outlook:false");
    expect(markup).toContain("Distinct Insight");
    expect(markup).toContain("Cash flow remains positive.");
    expect(markup).toContain("data-executive-copilot");
  });

  it("suppresses a risk summary equivalent to the briefing headline", () => {
    const markup = renderToStaticMarkup(
      <FinancialExecutiveIntelligence
        executiveBriefing={{
          headline: "Dashboard intelligence ready.",
          overview: "Operating performance is stable.",
          outlook: "Continue monitoring cash flow.",
        }}
        riskSummary={{
          status: "Ready",
          score: 0,
          summary: "Dashboard intelligence is ready.",
        }}
        riskAssessment={{
          primaryDrivers: [],
          trendIndicators: [],
          recommendations: ["Continue routine monitoring."],
        }}
      />,
    );

    expect(markup).toContain("show-summary:false");
    expect(markup).toContain("Operating performance is stable.");
    expect(markup).toContain("show-copilot-outlook:true");
  });

  it("omits the insights surface when every insight is repeated", () => {
    const repeatedCopy = "Dashboard intelligence is ready.";

    const markup = renderToStaticMarkup(
      <FinancialExecutiveIntelligence
        executiveBriefing={{
          headline: "Dashboard intelligence ready.",
          overview: repeatedCopy,
          outlook: repeatedCopy,
        }}
        riskSummary={{
          status: "Ready",
          score: 0,
          summary: repeatedCopy,
        }}
        riskAssessment={{
          primaryDrivers: [],
          trendIndicators: [],
          recommendations: ["Continue routine monitoring."],
        }}
        insights={[
          {
            label: "Executive Outlook",
            detail: repeatedCopy,
          },
          {
            label: "Recommended Focus",
            detail: "Continue routine monitoring.",
          },
        ]}
      />,
    );

    expect(markup).not.toContain("data-forge-insights");
    expect(markup).toContain("show-copilot-outlook:false");
    expect(markup).toContain("Continue routine monitoring.");
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

    expect(embeddedCount).toBeGreaterThanOrEqual(2);
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
