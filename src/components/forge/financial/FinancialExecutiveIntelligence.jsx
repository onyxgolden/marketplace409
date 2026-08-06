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
      />

      <ForgeRiskCenter
        riskSummary={riskSummary}
        riskAssessment={riskAssessment}
      />

      <ForgeInsights
        insights={insights}
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
