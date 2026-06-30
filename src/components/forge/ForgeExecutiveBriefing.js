export default function ForgeExecutiveBriefing({
  executiveBriefing,
  riskAssessment,
}) {
  return (
    <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 xl:col-span-2">
        <div className="text-sm uppercase tracking-wide text-slate-500">
          Executive Briefing
        </div>
        <h2 className="mt-2 text-2xl font-black">
          {executiveBriefing.headline}
        </h2>
        <p className="mt-4 text-slate-700">{executiveBriefing.overview}</p>
        <p className="mt-3 text-slate-600">{executiveBriefing.outlook}</p>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6">
        <div className="text-sm uppercase tracking-wide text-slate-500">
          Recommended Actions
        </div>
        <ul className="mt-4 space-y-3 text-sm text-slate-700">
          {(riskAssessment.recommendations.length
            ? riskAssessment.recommendations
            : ["Continue routine monitoring."]
          ).map((item) => (
            <li key={item} className="rounded-xl bg-slate-100 p-3">
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
