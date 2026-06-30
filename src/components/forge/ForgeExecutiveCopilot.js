export default function ForgeExecutiveCopilot({
  executiveBriefing,
  riskAssessment,
}) {
  const recommendations = riskAssessment?.recommendations ?? [];

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6">
      <div className="text-sm uppercase tracking-wide text-slate-500">
        Executive Copilot
      </div>

      <div className="mt-4 rounded-2xl bg-slate-100 p-4">
        <div className="text-sm font-bold text-slate-950">Outlook</div>
        <div className="mt-2 text-sm text-slate-600">
          {executiveBriefing?.outlook ?? "No executive outlook available."}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {(recommendations.length ? recommendations : ["Continue routine monitoring."]).map(
          (recommendation) => (
            <div
              key={recommendation}
              className="rounded-2xl border border-slate-200 bg-slate-100 p-4 text-sm text-slate-700"
            >
              {recommendation}
            </div>
          ),
        )}
      </div>
    </section>
  );
}
