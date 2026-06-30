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

          <ForgeExecutiveHero riskSummary={riskSummary} />

          <ForgeKpiCards
            netWorth={netWorth}
            riskSummary={riskSummary}
            auditFindings={auditFindings}
            formatCurrency={formatCurrency}
          />

          {view === "dashboard" && <ForgeQuickActions />}

          {(view === "dashboard" || view === "audit") && (
            <ForgeExecutiveBriefing
              executiveBriefing={executiveBriefing}
              riskAssessment={riskAssessment}
            />
          )}

          {view === "networth" && (
            <ForgeNetWorthPanel
              netWorth={netWorth}
              formatCurrency={formatCurrency}
            />
          )}

          {view === "audit" && (
            <ForgeAuditPanel
              auditFindings={auditFindings}
              riskAssessment={riskAssessment}
            />
          )}
        </main>
      </div>
    </div>
  );
}
