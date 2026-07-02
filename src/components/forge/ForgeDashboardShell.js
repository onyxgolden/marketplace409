import ForgeAlerts from "@/components/forge/ForgeAlerts";
import ForgeAuditPanel from "@/components/forge/ForgeAuditPanel";
import ForgeExecutiveBriefing from "@/components/forge/ForgeExecutiveBriefing";
import ForgeExecutiveCopilot from "@/components/forge/ForgeExecutiveCopilot";
import ForgeExecutiveHero from "@/components/forge/ForgeExecutiveHero";
import ForgeInsights from "@/components/forge/ForgeInsights";
import ForgeKpiCards from "@/components/forge/ForgeKpiCards";
import ForgeNetWorthPanel from "@/components/forge/ForgeNetWorthPanel";
import PlaidConnectButton from "@/components/forge/PlaidConnectButton";
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

          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="text-2xl">🚧</div>
              <div>
                <div className="font-black text-amber-900">
                  FORGE Executive Workspace 2.0
                </div>
                <div className="mt-1 text-sm text-amber-800">
                  This workspace is under active development. Visual design,
                  executive intelligence, AI Copilot, charts, and reporting are
                  being enhanced while core financial services remain stable.
                </div>
              </div>
            </div>
          </div>

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
                <PlaidConnectButton />
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
