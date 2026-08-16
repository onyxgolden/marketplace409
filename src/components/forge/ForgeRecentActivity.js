export default function ForgeRecentActivity({
  activities = [],
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
        Recent Activity
      </div>

      <div className="mt-4 space-y-3">
        {activities.length ? (
          activities.map((activity) => (
            <div
              key={activity.id}
              className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-black text-slate-950 dark:text-white">
                    {activity.label}
                  </div>
                  <div className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">
                    {activity.detail}
                  </div>
                </div>

                <div className="shrink-0 rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {activity.type}
                </div>
              </div>

              {activity.timestamp && (
                <div className="mt-3 text-xs uppercase tracking-wide text-slate-600 dark:text-slate-400">
                  {activity.timestamp}
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-800 p-4 text-sm text-slate-500 dark:text-slate-400">
            No recent activity.
          </div>
        )}
      </div>
    </section>
  );
}
