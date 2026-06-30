import ForgeAuditPanel from "@/components/forge/ForgeAuditPanel";
import ForgeExecutiveBriefing from "@/components/forge/ForgeExecutiveBriefing";
import ForgeExecutiveHero from "@/components/forge/ForgeExecutiveHero";
import ForgeKpiCards from "@/components/forge/ForgeKpiCards";
import ForgeNetWorthPanel from "@/components/forge/ForgeNetWorthPanel";
import ForgeQuickActions from "@/components/forge/ForgeQuickActions";
import ForgeSidebar from "@/components/forge/ForgeSidebar";
import ForgeTopBar from "@/components/forge/ForgeTopBar";

export default function ForgeDashboardShell({
  view,
  setView,
  netWorth,
  riskSummary,
  riskAssessment,
  executiveBriefing,
  auditFindings,
  formatCurrency,
}) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-7xl">
        <ForgeSidebar view={view} setView={setView} />

        <main className="w-full space-y-6 p-4 lg:p-8">
          <ForgeTopBar view={view} setView={setView} />

          {view === "dashboard" && (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]">
              <div className="space-y-6">
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
              </div>

              <div className="space-y-6">
                <ForgeQuickActions />
              </div>
            </div>
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
