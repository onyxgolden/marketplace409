export default function ForgeSystemHealth({ healthItems = [] }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6">
      <div className="text-sm uppercase tracking-wide text-slate-500">System Health</div>
      <div className="mt-4 grid gap-3">
        {healthItems.map((item) => (
          <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-100 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="font-bold text-slate-950">{item.label}</div>
              <div className="text-xs font-black uppercase tracking-wide text-slate-500">{item.status}</div>
            </div>
            <div className="mt-2 text-sm text-slate-600">{item.detail}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
