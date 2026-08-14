function Counts({ title, counts }) {
  const rows = [["Create", counts.create], ["Link", counts.link], ["Skip", counts.skip], ["Review", counts.review]];
  return <div className="rounded-xl border p-4">
    <h4 className="font-black">{title}</h4>
    <div className="mt-3 grid grid-cols-2 gap-2">{rows.map(([label, value]) => <div key={label} className="rounded-lg bg-slate-100 p-3"><p className="text-xs font-bold uppercase text-slate-500">{label}</p><p className="text-lg font-black">{value}</p></div>)}</div>
  </div>;
}

export default function RentecOperationalMigrationPlan({ plan }) {
  if (!plan) return null;
  return <div className="rounded-xl border p-4">
    <h3 className="font-black">Operational migration plan</h3>
    <p className="mt-2 text-sm text-slate-600">Read-only classification of Rentec records against existing Rental Manager data.</p>
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <Counts title="Properties and units" counts={plan.properties}/>
      <Counts title="Renters" counts={plan.tenants}/>
      <Counts title="Leases" counts={plan.leases}/>
    </div>
    {plan.reviewReasons?.length ? <details className="mt-4 rounded-xl bg-amber-50 p-4">
      <summary className="cursor-pointer font-black text-amber-900">Why records are skipped or require review</summary>
      <div className="mt-3 space-y-2">{plan.reviewReasons.map((reason) => <div key={reason.label} className="flex justify-between gap-4 text-sm"><span>{reason.label}</span><strong>{reason.count}</strong></div>)}</div>
    </details> : null}
    <p className="mt-4 text-sm font-bold text-amber-800">Plan only: no property, renter, lease, or membership record was written.</p>
  </div>;
}
