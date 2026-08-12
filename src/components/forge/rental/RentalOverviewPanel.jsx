const LAUNCH_STEPS = [
  ["Property", "Use the existing 4800 Kent Avenue property record."],
  ["Unit", "Create the main residence and mark it preparing until remodeling is complete."],
  ["Tenant", "Invite the selected tenant after the lease terms are confirmed."],
  ["Lease", "Record the executed lease, rent, due day, and effective dates."],
  ["Rent schedule", "Activate the recurring obligation only after the lease is active."],
  ["First charge", "Generate one deterministic monthly charge before opening Stripe checkout."],
  ["Optional credit reporting", "Select a furnisher-of-record partner, then offer tenant opt-in reporting as a separately disclosed monthly service."],
];

export default function RentalOverviewPanel() {
  return (
    <section className="space-y-6" data-rental-overview>
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-800">First production rental</p>
        <h2 className="mt-2 text-2xl font-black text-slate-950">4800 Kent Avenue</h2>
        <p className="mt-2 max-w-3xl text-sm font-semibold text-slate-700">
          Remodel underway. Target readiness: late August to early September. This workspace tracks the minimum trusted path to the first FORGE tenant.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {LAUNCH_STEPS.map(([title, detail], index) => (
          <article key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-sm font-black text-amber-400">{index + 1}</span>
              <div><h3 className="font-black text-slate-950">{title}</h3><p className="mt-1 text-sm text-slate-600">{detail}</p></div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
