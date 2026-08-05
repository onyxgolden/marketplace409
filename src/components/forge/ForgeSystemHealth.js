export default function ForgeSystemHealth({
  healthItems = [],
  variant = "default",
}) {
  const embedded = variant === "embedded";

  return (
    <section
      className={
        embedded ? "" : "rounded-3xl border border-slate-200 bg-white p-6"
      }
    >
      <div className="text-xs font-black uppercase tracking-wide text-slate-500">
        System Health
      </div>

      <div className="mt-4 grid gap-3">
        {healthItems.map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="font-bold text-slate-950">{item.label}</div>
              <div className="text-xs font-black uppercase tracking-wide text-slate-500">
                {item.status}
              </div>
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-600">
              {item.detail}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
