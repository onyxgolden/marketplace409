export default function ForgeRiskCenter({ riskSummary, riskAssessment }) {
  const primaryDrivers = riskAssessment.primaryDrivers ?? [];
  const trendIndicators = riskAssessment.trendIndicators ?? [];
  const recommendations = riskAssessment.recommendations ?? [];

  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm uppercase tracking-wide text-slate-500">
            Risk Center
          </div>
          <h2 className="mt-2 text-2xl font-black text-white">
            {riskSummary.status}
          </h2>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-right">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Score
          </div>
          <div className="mt-1 text-2xl font-black text-white">
            {riskSummary.score}
          </div>
        </div>
      </div>

      <p className="mt-4 text-sm text-slate-400">
        {riskSummary.summary}
      </p>

      <div className="mt-6 space-y-4">
        <RiskSection
          title="Primary Drivers"
          emptyText="No active risk drivers."
          items={primaryDrivers.map((driver) => (
            <div key={`${driver.accountId}-${driver.sourceFindingType}`}>
              <div className="font-bold text-slate-100">
                {driver.accountId ?? "Unknown Account"}
              </div>
              <div className="mt-1 text-xs uppercase tracking-wide text-red-300">
                {driver.severity} / {driver.score}
              </div>
              <div className="mt-2 text-sm text-slate-400">
                {driver.explanation}
              </div>
            </div>
          ))}
        />

        <RiskSection
          title="Trend Indicators"
          emptyText="No trend indicators detected."
          items={trendIndicators.map((indicator) => (
            <div key={indicator}>{indicator}</div>
          ))}
        />

        <RiskSection
          title="Recommended Actions"
          emptyText="Continue routine monitoring."
          items={recommendations.map((recommendation) => (
            <div key={recommendation}>{recommendation}</div>
          ))}
        />
      </div>
    </section>
  );
}

function RiskSection({ title, emptyText, items }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
        {title}
      </div>

      <div className="mt-3 space-y-3">
        {items.length ? (
          items.map((item, index) => (
            <div
              key={index}
              className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-sm text-slate-300"
            >
              {item}
            </div>
          ))
        ) : (
          <div className="rounded-2xl bg-slate-950 p-4 text-sm text-slate-500">
            {emptyText}
          </div>
        )}
      </div>
    </div>
  );
}
