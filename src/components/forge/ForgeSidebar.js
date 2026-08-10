import Link from "next/link";

const NAV_ITEMS = [
  { id: "dashboard", label: "▦ Dashboard" },
  { id: "networth", label: "◉ Net Worth" },
  { id: "audit", label: "◇ Audit" },
];

export default function ForgeSidebar({ view, setView }) {
  return (
    <aside className="hidden min-h-screen w-72 border-r border-slate-800 bg-[linear-gradient(90deg,#020617_0%,#111827_22%,#334155_44%,#0f172a_66%,#020617_100%)] p-6 text-white shadow-2xl lg:block">
      <div className="mb-8 rounded-3xl border border-white/10 bg-black/20 p-5 shadow-inner">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-400/40 bg-gradient-to-br from-slate-200 via-slate-500 to-slate-950 text-3xl shadow-lg">
          ⚒
        </div>

        <div className="text-center text-4xl font-black tracking-[0.18em] text-white drop-shadow">
          FORGE
        </div>

        <div className="mt-1 text-center text-xs font-black uppercase tracking-[0.32em] text-amber-400">
          Command Center
        </div>
      </div>

      <div className="mb-6">
        <Link
          href="/"
          className="flex items-center justify-center rounded-xl border border-white/20 bg-white/95 px-4 py-3 text-sm font-black text-slate-950 shadow transition hover:border-amber-400 hover:bg-amber-50"
        >
          ← Return to 409 Marketplace
        </Link>
      </div>

      <nav className="space-y-3">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            className={`w-full rounded-xl px-4 py-3 text-left text-sm font-black transition ${
              view === item.id
                ? "border border-amber-400 bg-amber-500 text-slate-950 shadow-lg shadow-amber-950/40"
                : "border border-white/10 bg-black/20 text-white hover:border-white/25 hover:bg-white/10"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="mt-10 border-t border-white/15 pt-6">
        <div className="text-xs font-bold uppercase tracking-[0.24em] text-slate-300">
          Powered by
        </div>
        <div className="mt-2 text-sm font-black uppercase tracking-[0.28em] text-amber-400">
          FORGE
        </div>
      </div>
    </aside>
  );
}
