import Link from "next/link";

export default function ForgeAuditPanel({
  auditFindings,
  riskAssessment,
}) {
  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="text-sm uppercase tracking-wide text-slate-500">
            Live Audit Findings
          </div>

          <Link
            href="/import"
            className="rounded-xl border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-black text-slate-900 transition hover:border-amber-400 hover:bg-amber-50"
          >
            Open Transaction Review
          </Link>
        </div>

        {auditFindings?.error && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700">
            Error: {auditFindings.error}
          </div>
        )}

        {!auditFindings?.anomalies?.length && (
          <div className="mt-4 rounded-xl bg-slate-100 p-4 text-sm text-slate-600">
            No anomalies detected in current ledger snapshot.
          </div>
        )}

        {!!auditFindings?.anomalies?.length && (
          <div className="mt-6 space-y-4">
            {auditFindings.anomalies.map((finding, index) => (
              <ForgeAuditFindingCard
                key={`${finding.accountId ?? "unknown"}-${finding.type}-${index}`}
                finding={finding}
                scoredRisk={riskAssessment.primaryDrivers.find(
                  (risk) =>
                    risk.accountId === finding.accountId &&
                    risk.sourceFindingType === finding.type
                )}
              />
            ))}
          </div>
        )}
      </div>

      {!!riskAssessment.trendIndicators.length && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6">
          <div className="text-sm uppercase tracking-wide text-slate-500">
            Trend Indicators
          </div>

          <ul className="mt-4 space-y-3 text-sm text-slate-700">
            {riskAssessment.trendIndicators.map((indicator) => (
              <li key={indicator} className="rounded-xl bg-slate-100 p-3">
                {indicator}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ForgeAuditFindingCard({ finding, scoredRisk }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-100 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Account
          </div>
          <div className="mt-1 text-lg font-black">
            {finding.accountId ?? "unknown"}
          </div>
        </div>

        {scoredRisk && (
          <div className="rounded-xl bg-amber-100 px-4 py-2 text-sm font-bold uppercase text-amber-700">
            {scoredRisk.severity} / {scoredRisk.score}
          </div>
        )}
      </div>

      <div className="mt-4 text-sm text-slate-600">
        Anomaly: <span className="text-slate-800">{finding.type}</span>
      </div>

      <div className="mt-3 text-sm text-slate-700">
        {finding.explanation}
      </div>

      {scoredRisk && (
        <div className="mt-4 rounded-xl bg-white p-4 text-sm text-slate-700">
          <div className="font-bold text-slate-950">Recommended Action</div>
          <div className="mt-1">{scoredRisk.recommendedAction}</div>
        </div>
      )}

      {finding.traceSummary && (
        <div className="mt-3 text-xs text-slate-500">
          Trace: {finding.traceSummary}
        </div>
      )}
    </div>
  );
}
