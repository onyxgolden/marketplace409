import RentecOwnerInputResolution from "./RentecOwnerInputResolution.jsx";

function Readiness({ title, value }) {
  return <div className="rounded-xl border p-4"><h4 className="font-black">{title}</h4><p className="mt-2 text-sm">Ready: <strong>{value.ready}</strong></p><p className="mt-2 text-sm">Blocked: <strong>{value.blocked}</strong></p></div>;
}

function Mapping({ title, rows }) {
  return <details className="rounded-xl border p-4"><summary className="cursor-pointer font-black">{title}</summary><div className="mt-3 space-y-3">{rows.map((row) => <div key={row.target} className="text-sm"><strong>{row.source}</strong><span> → </span><strong>{row.target}</strong><p className="text-slate-500">{row.rule}</p></div>)}</div></details>;
}

export default function RentecImportManifestPreview({ manifest, busy = false, onResolve }) {
  if (!manifest) return null;
  return <div className="rounded-xl border p-4">
    <h3 className="font-black">Controlled import manifest</h3>
    <p className="mt-2 text-sm text-slate-600">Deterministic IDs and exact field mappings for a future owner-approved import.</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-3">
      <Readiness title="Properties and units" value={manifest.readiness.units}/>
      <Readiness title="Renters" value={manifest.readiness.tenants}/>
      <Readiness title="Leases" value={manifest.readiness.leases}/>
    </div>
    <p className="mt-4 break-all rounded-lg bg-slate-100 p-3 font-mono text-xs"><strong>Approval checksum:</strong> {manifest.checksum}</p>
    <p className="mt-3 text-sm"><strong>Dependency order:</strong> {manifest.dependencyOrder.join(" → ")}</p>
    {manifest.ownerExclusions?.tenants ? <p className="mt-3 rounded-lg bg-sky-50 p-3 text-sm font-bold text-sky-900">Owner-excluded non-renter records: {manifest.ownerExclusions.tenants} contact and {manifest.ownerExclusions.leases} dependent lease.</p> : null}
    {manifest.blockers?.length ? <div className="mt-4 rounded-xl bg-amber-50 p-4"><h4 className="font-black text-amber-900">Blocking owner inputs</h4><div className="mt-3 space-y-2">{manifest.blockers.map((row) => <div key={row.label} className="flex justify-between gap-4 text-sm"><span>{row.label}</span><strong>{row.count}</strong></div>)}</div></div> : null}
    <RentecOwnerInputResolution resolution={manifest.ownerInputResolution} busy={busy} onResolve={onResolve}/>
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <Mapping title="Unit field mappings" rows={manifest.fieldMappings.units}/>
      <Mapping title="Renter field mappings" rows={manifest.fieldMappings.tenants}/>
      <Mapping title="Lease field mappings" rows={manifest.fieldMappings.leases}/>
    </div>
    <p className="mt-4 text-sm font-bold text-amber-800">Manifest preview only: candidate records remain private, leases remain draft, and nothing was persisted or written.</p>
  </div>;
}
