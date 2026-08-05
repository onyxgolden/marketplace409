export default function ForgeAlerts({ alerts = [], variant = "default" }) {
  const embedded = variant === "embedded";

  return (
    <section
      className={
        embedded
          ? ""
          : "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      }
    >
      <div className="text-xs font-black uppercase tracking-wide text-slate-500">
        Alerts
      </div>

      <div className="mt-4 space-y-3">
        {alerts.map((alert, index) => (
          <div
            key={`${alert.label ?? "alert"}-${index}`}
            className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
          >
            <div className="font-black text-slate-950">{alert.label}</div>
            <div className="mt-2 text-sm leading-6 text-slate-600">
              {alert.detail}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
