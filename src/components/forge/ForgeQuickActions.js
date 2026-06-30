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
    <section className="rounded-3xl border border-slate-200 bg-white p-6">
      <div className="text-sm uppercase tracking-wide text-slate-500">
        Quick Actions
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {quickActions.map((action) => (
          <button
            key={action.label}
            type="button"
            className="rounded-2xl border border-slate-200 bg-slate-100 p-4 text-left transition hover:border-slate-400"
          >
            <div className="font-black text-slate-950">{action.label}</div>
            <div className="mt-2 text-sm text-slate-600">{action.detail}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
