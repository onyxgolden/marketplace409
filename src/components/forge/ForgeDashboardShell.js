import ForgeAlerts from "@/components/forge/ForgeAlerts";
import ForgeAuditPanel from "@/components/forge/ForgeAuditPanel";
import ForgeExecutiveBriefing from "@/components/forge/ForgeExecutiveBriefing";
import ForgeExecutiveCopilot from "@/components/forge/ForgeExecutiveCopilot";
import ForgeExecutiveHero from "@/components/forge/ForgeExecutiveHero";
import ForgeInsights from "@/components/forge/ForgeInsights";
import ForgeKpiCards from "@/components/forge/ForgeKpiCards";
import ForgeNetWorthPanel from "@/components/forge/ForgeNetWorthPanel";
import ForgePortfolioSummary from "@/components/forge/ForgePortfolioSummary";
import ForgeQuickActions from "@/components/forge/ForgeQuickActions";
import ForgeRecentActivity from "@/components/forge/ForgeRecentActivity";
import ForgeRiskCenter from "@/components/forge/ForgeRiskCenter";
import ForgeRiskHeatMap from "@/components/forge/ForgeRiskHeatMap";
import ForgeRiskTimeline from "@/components/forge/ForgeRiskTimeline";
import ForgeSidebar from "@/components/forge/ForgeSidebar";
import ForgeSystemHealth from "@/components/forge/ForgeSystemHealth";
import ForgeSystemStatus from "@/components/forge/ForgeSystemStatus";
import ForgeTopBar from "@/components/forge/ForgeTopBar";
import ForgeTrendChart from "@/components/forge/ForgeTrendChart";
import { forgeTheme } from "@/components/forge/theme";

export default function ForgeDashboardShell({
  view,
  setView,
  netWorth,
  riskSummary,
  riskAssessment,
  executiveBriefing,
  auditFindings,
  alertItems,
  insightItems,
  portfolioSummaryItems,
  systemHealthItems,
  systemStatusItems,
  recentActivities,
  formatCurrency,
}) {
  return (
    <div className={forgeTheme.page}>
      <div className={forgeTheme.shell}>
        <ForgeSidebar view={view} setView={setView} />

        <main className={forgeTheme.main}>
          <ForgeTopBar view={view} setView={setView} />

          {view === "dashboard" && (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]">
              <div className="space-y-6">
                <ForgeExecutiveHero riskSummary={riskSummary} />
                <ForgeKpiCards netWorth={netWorth} riskSummary={riskSummary} auditFindings={auditFindings} formatCurrency={formatCurrency} />
                <ForgeExecutiveBriefing executiveBriefing={executiveBriefing} riskAssessment={riskAssessment} />
                <ForgePortfolioSummary summaryItems={portfolioSummaryItems} />
                <ForgeInsights insights={insightItems} />
                <ForgeTrendChart riskSummary={riskSummary} riskAssessment={riskAssessment} />
                <ForgeRiskTimeline activities={recentActivities} />
              </div>

              <div className="space-y-6">
                <ForgeRiskCenter riskSummary={riskSummary} riskAssessment={riskAssessment} />
                <ForgeRiskHeatMap riskAssessment={riskAssessment} />
                <ForgeExecutiveCopilot executiveBriefing={executiveBriefing} riskAssessment={riskAssessment} />
                <ForgeSystemStatus statusItems={systemStatusItems} />
                <ForgeSystemHealth healthItems={systemHealthItems} />
                <ForgeAlerts alerts={alertItems} />
                <ForgeRecentActivity activities={recentActivities} />
                <ForgeQuickActions />
              </div>
            </div>
          )}

          {view === "audit" && (
            <>
              <ForgeExecutiveHero riskSummary={riskSummary} />
              <ForgeKpiCards netWorth={netWorth} riskSummary={riskSummary} auditFindings={auditFindings} formatCurrency={formatCurrency} />
              <ForgeExecutiveBriefing executiveBriefing={executiveBriefing} riskAssessment={riskAssessment} />
              <ForgeAuditPanel auditFindings={auditFindings} riskAssessment={riskAssessment} />
            </>
          )}

          {view === "networth" && (
            <>
              <ForgeExecutiveHero riskSummary={riskSummary} />
              <ForgeKpiCards netWorth={netWorth} riskSummary={riskSummary} auditFindings={auditFindings} formatCurrency={formatCurrency} />
              <ForgeNetWorthPanel netWorth={netWorth} formatCurrency={formatCurrency} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
