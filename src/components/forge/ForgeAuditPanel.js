export default function ForgeAuditPanel({
  auditFindings,
  riskAssessment,
}) {
  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
        <div className="text-sm uppercase tracking-wide text-slate-500">
          Live Audit Findings
        </div>

        {auditFindings?.error && (
          <div className="mt-4 rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
            Error: {auditFindings.error}
          </div>
        )}

        {!auditFindings?.anomalies?.length && (
          <div className="mt-4 rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
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
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
          <div className="text-sm uppercase tracking-wide text-slate-500">
            Trend Indicators
          </div>

          <ul className="mt-4 space-y-3 text-sm text-slate-300">
            {riskAssessment.trendIndicators.map((indicator) => (
              <li key={indicator} className="rounded-xl bg-slate-950 p-3">
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
    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
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
          <div className="rounded-xl bg-red-950/50 px-4 py-2 text-sm font-bold uppercase text-red-300">
            {scoredRisk.severity} / {scoredRisk.score}
          </div>
        )}
      </div>

      <div className="mt-4 text-sm text-slate-400">
        Anomaly: <span className="text-slate-200">{finding.type}</span>
      </div>

      <div className="mt-3 text-sm text-slate-300">
        {finding.explanation}
      </div>

      {scoredRisk && (
        <div className="mt-4 rounded-xl bg-slate-900 p-4 text-sm text-slate-300">
          <div className="font-bold text-slate-100">Recommended Action</div>
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
