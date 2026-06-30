export default function ForgeDashboardCard({ label, value, detail }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-3 text-3xl font-black text-white">{value}</div>
      {detail && <div className="mt-2 text-sm text-slate-400">{detail}</div>}
    </div>
  );
}
