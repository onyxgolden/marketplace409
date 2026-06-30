const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "networth", label: "Net Worth" },
  { id: "audit", label: "Audit" },
];

export default function ForgeTopBar({ view, setView }) {
  return (
    <>
      <div className="mb-6 flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:hidden">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.3em] text-red-400">
            FORGE
          </div>
          <div className="text-xl font-black">Command Center</div>
        </div>
      </div>

      <div className="mb-6 flex gap-2 overflow-x-auto lg:hidden">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              view === item.id
                ? "bg-red-600 text-white"
                : "bg-slate-900 text-slate-300"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
