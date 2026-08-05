export default function ForgeSystemStatus({
  statusItems = [],
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
        System Status
      </div>

      <div className="mt-4 grid gap-3">
        {statusItems.map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4"
          >
            <div>
              <div className="text-sm font-bold text-slate-950">
                {item.label}
              </div>
              <div className="mt-1 text-xs leading-5 text-slate-500">
                {item.detail}
              </div>
            </div>

            <div className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-black uppercase tracking-wide text-slate-600">
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
