import ForgeExecutiveBriefing from "@/components/forge/ForgeExecutiveBriefing";
import ForgeExecutiveCopilot from "@/components/forge/ForgeExecutiveCopilot";
import ForgeInsights from "@/components/forge/ForgeInsights";
import ForgeRiskCenter from "@/components/forge/ForgeRiskCenter";

const intelligenceVariants = Object.freeze({
  workspace: "space-y-6",
  embedded: "space-y-4",
});

export default function FinancialExecutiveIntelligence({
  variant = "workspace",
  executiveBriefing,
  riskSummary,
  riskAssessment,
  insights = [],
}) {
  const spacing =
    intelligenceVariants[variant] ??
    intelligenceVariants.workspace;

  const normalizeCopy = (value) =>
    String(value ?? "")
      .toLowerCase()
      .replace(/\bis\b/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const recommendations =
    riskAssessment?.recommendations ?? [];

  const showBriefingOverview =
    normalizeCopy(executiveBriefing?.overview) !==
    normalizeCopy(executiveBriefing?.headline);

  const displayedDetails = new Set(
    [
      executiveBriefing?.headline,
      executiveBriefing?.overview,
      executiveBriefing?.outlook,
      riskSummary?.summary,
      ...recommendations,
    ].filter(Boolean),
  );

  const distinctInsights = insights.filter(
    (insight) =>
      !displayedDetails.has(insight.detail),
  );

  const showRiskSummary =
    Boolean(riskSummary?.summary) &&
    riskSummary.summary !== executiveBriefing?.overview &&
    riskSummary.summary !== executiveBriefing?.outlook;

  return (
    <section
      data-financial-executive-intelligence
      data-financial-intelligence-variant={variant}
      className={spacing}
    >
      <ForgeExecutiveBriefing
        executiveBriefing={executiveBriefing}
        riskAssessment={riskAssessment}
        variant={
          variant === "embedded"
            ? "embedded"
            : "default"
        }
        showOverview={showBriefingOverview}
        showOutlook={false}
        showRecommendations={false}
      />

      <ForgeRiskCenter
        riskSummary={riskSummary}
        riskAssessment={riskAssessment}
        showSummary={showRiskSummary}
        showRecommendations={false}
      />

      <ForgeInsights
        insights={distinctInsights}
        variant={
          variant === "embedded"
            ? "embedded"
            : "default"
        }
      />

      <ForgeExecutiveCopilot
        executiveBriefing={executiveBriefing}
        riskAssessment={riskAssessment}
      />
    </section>
  );
}
