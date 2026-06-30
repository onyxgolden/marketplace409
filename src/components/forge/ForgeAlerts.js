export default function ForgeAlerts({ alerts = [] }) {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
      <div className="text-sm uppercase tracking-wide text-slate-500">Alerts</div>
      <div className="mt-4 space-y-3">
        {alerts.map((alert) => (
          <div key={alert.label} className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <div className="font-black text-white">{alert.label}</div>
            <div className="mt-2 text-sm text-slate-400">{alert.detail}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
