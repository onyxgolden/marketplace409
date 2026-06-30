import ForgeAuditPanel from "@/components/forge/ForgeAuditPanel";
import ForgeDashboardCard from "@/components/forge/ForgeDashboardCard";
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
            <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
              <div className="xl:col-span-2 rounded-3xl border border-slate-800 bg-slate-900 p-6">
                <div className="text-sm uppercase tracking-wide text-slate-500">
                  Executive Briefing
                </div>
                <h2 className="mt-2 text-2xl font-black">
                  {executiveBriefing.headline}
                </h2>
                <p className="mt-4 text-slate-300">{executiveBriefing.overview}</p>
                <p className="mt-3 text-slate-400">{executiveBriefing.outlook}</p>
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
                <div className="text-sm uppercase tracking-wide text-slate-500">
                  Recommended Actions
                </div>
                <ul className="mt-4 space-y-3 text-sm text-slate-300">
                  {(riskAssessment.recommendations.length
                    ? riskAssessment.recommendations
                    : ["Continue routine monitoring."]
                  ).map((item) => (
                    <li key={item} className="rounded-xl bg-slate-950 p-3">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
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
