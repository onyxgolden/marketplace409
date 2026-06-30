export default function ForgeSystemStatus({ statusItems = [] }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6">
      <div className="text-sm uppercase tracking-wide text-slate-500">
        System Status
      </div>

      <div className="mt-4 grid gap-3">
        {statusItems.map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-100 p-4"
          >
            <div>
              <div className="text-sm font-bold text-slate-950">
                {item.label}
              </div>
              <div className="mt-1 text-xs text-slate-500">{item.detail}</div>
            </div>

            <div className="rounded-full border border-slate-200 px-3 py-1 text-xs font-black uppercase tracking-wide text-slate-600">
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
