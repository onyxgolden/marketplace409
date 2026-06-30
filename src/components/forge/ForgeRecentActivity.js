export default function ForgeRecentActivity({ activities = [] }) {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
      <div className="text-sm uppercase tracking-wide text-slate-500">
        Recent Activity
      </div>

      <div className="mt-4 space-y-3">
        {activities.length ? (
          activities.map((activity) => (
            <div
              key={activity.id}
              className="rounded-2xl border border-slate-800 bg-slate-950 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-black text-white">{activity.label}</div>
                  <div className="mt-1 text-sm text-slate-400">
                    {activity.detail}
                  </div>
                </div>

                <div className="shrink-0 rounded-full border border-slate-800 px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                  {activity.type}
                </div>
              </div>

              {activity.timestamp && (
                <div className="mt-3 text-xs uppercase tracking-wide text-slate-600">
                  {activity.timestamp}
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="rounded-2xl bg-slate-950 p-4 text-sm text-slate-500">
            No recent activity.
          </div>
        )}
      </div>
    </section>
  );
}
