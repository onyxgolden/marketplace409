import ForgeAuditPanel from "@/components/forge/ForgeAuditPanel";
import ForgeExecutiveBriefing from "@/components/forge/ForgeExecutiveBriefing";
import ForgeExecutiveHero from "@/components/forge/ForgeExecutiveHero";
import ForgeKpiCards from "@/components/forge/ForgeKpiCards";
import ForgeNetWorthPanel from "@/components/forge/ForgeNetWorthPanel";
import ForgeSidebar from "@/components/forge/ForgeSidebar";
import ForgeTopBar from "@/components/forge/ForgeTopBar";
import ForgeWorkspaceDesktop from "@/components/forge/workspace/ForgeWorkspaceDesktop";
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
            <ForgeWorkspaceDesktop
              netWorth={netWorth}
              riskSummary={riskSummary}
              riskAssessment={riskAssessment}
              executiveBriefing={executiveBriefing}
              auditFindings={auditFindings}
              alertItems={alertItems}
              insightItems={insightItems}
              portfolioSummaryItems={portfolioSummaryItems}
              systemHealthItems={systemHealthItems}
              systemStatusItems={systemStatusItems}
              recentActivities={recentActivities}
              formatCurrency={formatCurrency}
              setView={setView}
            />
          )}

          {view === "audit" && (
            <>
              <ForgeExecutiveHero riskSummary={riskSummary} />
              <ForgeKpiCards
                netWorth={netWorth}
                riskSummary={riskSummary}
                auditFindings={auditFindings}
                formatCurrency={formatCurrency}
              />
              <ForgeExecutiveBriefing
                executiveBriefing={executiveBriefing}
                riskAssessment={riskAssessment}
              />
              <ForgeAuditPanel
                auditFindings={auditFindings}
                riskAssessment={riskAssessment}
              />
            </>
          )}

          {view === "networth" && (
            <>
              <ForgeExecutiveHero riskSummary={riskSummary} />
              <ForgeKpiCards
                netWorth={netWorth}
                riskSummary={riskSummary}
                auditFindings={auditFindings}
                formatCurrency={formatCurrency}
              />
              <ForgeNetWorthPanel
                netWorth={netWorth}
                formatCurrency={formatCurrency}
              />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
