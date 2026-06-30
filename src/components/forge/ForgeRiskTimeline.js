export default function ForgeRiskTimeline({ activities = [] }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6">
      <div className="text-sm uppercase tracking-wide text-slate-500">
        Risk Timeline
      </div>

      <div className="mt-5 space-y-4">
        {activities.map((activity) => (
          <div key={activity.id} className="flex gap-4">
            <div className="mt-1 h-3 w-3 rounded-full bg-slate-600" />
            <div className="flex-1 rounded-2xl bg-slate-100 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="font-bold text-slate-950">{activity.label}</div>
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  {activity.timestamp}
                </div>
              </div>
              <div className="mt-2 text-sm text-slate-600">{activity.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
