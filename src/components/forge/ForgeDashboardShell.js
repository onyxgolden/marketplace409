import ForgeAuditPanel from "@/components/forge/ForgeAuditPanel";
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

          <section className="mb-8 rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-6 shadow-2xl">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.3em] text-red-400">
                  Executive Dashboard
                </p>
                <h1 className="mt-3 text-4xl font-black lg:text-6xl">
                  FORGE
                </h1>
                <p className="mt-3 max-w-2xl text-slate-400">
                  Monitor money, audits, imports, and risk from one mobile-ready
                  command center.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Overall Risk
                </div>
                <div className="mt-1 text-3xl font-black uppercase text-red-400">
                  {riskSummary.severity}
                </div>
                <div className="text-sm text-slate-400">
                  Score {riskSummary.score} · {riskSummary.findingCount} findings
                </div>
              </div>
            </div>
          </section>

          <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <DashboardCard
              label="Net Worth"
              value={formatCurrency(netWorth.netWorth)}
              detail={`Assets ${formatCurrency(netWorth.totalAssets)}`}
            />
            <DashboardCard
              label="Debt Ratio"
              value={netWorth.debtToAssetRatio?.toFixed(2) ?? "0.00"}
              detail={`Liabilities ${formatCurrency(netWorth.totalLiabilities)}`}
            />
            <DashboardCard
              label="Risk Score"
              value={riskSummary.score}
              detail={`${riskSummary.severityCounts.high} high · ${riskSummary.severityCounts.critical} critical`}
            />
            <DashboardCard
              label="Audit Status"
              value={auditFindings?.anomalies?.length ? "Review" : "Clear"}
              detail={
                auditFindings?.anomalies?.length
                  ? `${auditFindings.anomalies.length} anomalies`
                  : "No anomalies detected"
              }
            />
          </section>

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
                <DashboardCard label="Total Assets" value={formatCurrency(netWorth.totalAssets)} />
                <DashboardCard label="Total Liabilities" value={formatCurrency(netWorth.totalLiabilities)} />
                <DashboardCard label="Net Worth" value={formatCurrency(netWorth.netWorth)} />
                <DashboardCard label="Debt Ratio" value={netWorth.debtToAssetRatio?.toFixed(2) ?? "0.00"} />
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

function DashboardCard({ label, value, detail }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-3 text-3xl font-black text-white">{value}</div>
      {detail && <div className="mt-2 text-sm text-slate-400">{detail}</div>}
    </div>
  );
}
