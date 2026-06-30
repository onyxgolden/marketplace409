const quickActions = [
  {
    label: "Run Audit",
    detail: "Review ledger anomalies and risk signals.",
  },
  {
    label: "Import Data",
    detail: "Prepare bank, accounting, or property data imports.",
  },
  {
    label: "Review Portfolio",
    detail: "Open property and net worth operating views.",
  },
];

export default function ForgeQuickActions() {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
      <div className="text-sm uppercase tracking-wide text-slate-500">
        Quick Actions
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {quickActions.map((action) => (
          <button
            key={action.label}
            type="button"
            className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-left transition hover:border-slate-600"
          >
            <div className="font-black text-white">{action.label}</div>
            <div className="mt-2 text-sm text-slate-400">{action.detail}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
