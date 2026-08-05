export default function ForgeExecutiveBriefing({
  executiveBriefing,
  riskAssessment,
  variant = "default",
}) {
  const embedded = variant === "embedded";
  const panelClass = embedded
    ? "rounded-2xl border border-slate-200 bg-slate-50 p-5"
    : "rounded-3xl border border-slate-200 bg-white p-6";

  return (
    <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className={`${panelClass} xl:col-span-2`}>
        <div className="text-xs font-black uppercase tracking-wide text-slate-500">
          Executive Briefing
        </div>
        <h2 className="mt-2 text-xl font-black text-slate-950">
          {executiveBriefing.headline}
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-700">
          {executiveBriefing.overview}
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {executiveBriefing.outlook}
        </p>
      </div>

      <div className={panelClass}>
        <div className="text-xs font-black uppercase tracking-wide text-slate-500">
          Recommended Actions
        </div>
        <ul className="mt-3 space-y-3 text-sm text-slate-700">
          {(riskAssessment.recommendations.length
            ? riskAssessment.recommendations
            : ["Continue routine monitoring."]
          ).map((item) => (
            <li key={item} className="rounded-xl bg-white p-3">
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
