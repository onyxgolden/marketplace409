export default function ForgeSystemHealth({
  healthItems = [],
  variant = "default",
}) {
  const embedded = variant === "embedded";

  return (
    <section
      className={
        embedded ? "" : "rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6"
      }
    >
      <div className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
        System Health
      </div>

      <div className="mt-4 grid gap-3">
        {healthItems.map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="font-bold text-slate-950 dark:text-white">{item.label}</div>
              <div className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {item.status}
              </div>
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
              {item.detail}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
