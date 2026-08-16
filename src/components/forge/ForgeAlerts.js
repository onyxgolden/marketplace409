export default function ForgeAlerts({ alerts = [], variant = "default" }) {
  const embedded = variant === "embedded";

  return (
    <section
      className={
        embedded
          ? ""
          : "rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm"
      }
    >
      <div className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Alerts
      </div>

      <div className="mt-4 space-y-3">
        {alerts.map((alert, index) => (
          <div
            key={`${alert.label ?? "alert"}-${index}`}
            className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4"
          >
            <div className="font-black text-slate-950 dark:text-white">{alert.label}</div>
            <div className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
              {alert.detail}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
