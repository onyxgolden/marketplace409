export default function ForgeSystemStatus({
  statusItems = [],
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
        System Status
      </div>

      <div className="mt-4 grid gap-3">
        {statusItems.map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4"
          >
            <div>
              <div className="text-sm font-bold text-slate-950 dark:text-white">
                {item.label}
              </div>
              <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                {item.detail}
              </div>
            </div>

            <div className="shrink-0 rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1 text-xs font-black uppercase tracking-wide text-slate-600 dark:text-slate-300">
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
