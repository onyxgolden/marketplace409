export default function ForgeRiskHeatMap({ riskAssessment }) {
  const drivers = riskAssessment?.primaryDrivers ?? [];

  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
      <div className="text-sm uppercase tracking-wide text-slate-500">
        Risk Heat Map
      </div>

      <div className="mt-5 grid gap-3">
        {drivers.length ? (
          drivers.map((driver) => (
            <div
              key={`${driver.accountId}-${driver.sourceFindingType}`}
              className="rounded-2xl border border-slate-800 bg-slate-950 p-4"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-bold text-slate-100">
                    {driver.accountId ?? "Unknown Account"}
                  </div>
                  <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">
                    {driver.sourceFindingType ?? "Risk Driver"}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    {driver.severity}
                  </div>
                  <div className="mt-1 text-xl font-black text-white">
                    {driver.score}
                  </div>
                </div>
              </div>

              <div className="mt-3 h-2 rounded-full bg-slate-800">
                <div
                  className="h-2 rounded-full bg-slate-500"
                  style={{ width: `${Math.min(driver.score ?? 0, 100)}%` }}
                />
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-2xl bg-slate-950 p-4 text-sm text-slate-500">
            No active risk heat detected.
          </div>
        )}
      </div>
    </section>
  );
}
