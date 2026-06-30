import ForgeAuditPanel from "@/components/forge/ForgeAuditPanel";
import ForgeDashboardCard from "@/components/forge/ForgeDashboardCard";
import ForgeExecutiveBriefing from "@/components/forge/ForgeExecutiveBriefing";
import ForgeExecutiveHero from "@/components/forge/ForgeExecutiveHero";
import ForgeKpiCards from "@/components/forge/ForgeKpiCards";
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

        <main className="w-full p-4 lg:p-8">
          <ForgeTopBar view={view} setView={setView} />

          <ForgeExecutiveHero riskSummary={riskSummary} />

          <ForgeKpiCards
            netWorth={netWorth}
            riskSummary={riskSummary}
            auditFindings={auditFindings}
            formatCurrency={formatCurrency}
          />

          {(view === "dashboard" || view === "audit") && (
            <ForgeExecutiveBriefing
              executiveBriefing={executiveBriefing}
              riskAssessment={riskAssessment}
            />
          )}

          {view === "networth" && (
            <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <h2 className="text-2xl font-black">Net Worth Snapshot</h2>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <ForgeDashboardCard label="Total Assets" value={formatCurrency(netWorth.totalAssets)} />
                <ForgeDashboardCard label="Total Liabilities" value={formatCurrency(netWorth.totalLiabilities)} />
                <ForgeDashboardCard label="Net Worth" value={formatCurrency(netWorth.netWorth)} />
                <ForgeDashboardCard label="Debt Ratio" value={netWorth.debtToAssetRatio?.toFixed(2) ?? "0.00"} />
              </div>
            </section>
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
