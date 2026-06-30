import { forgeTheme } from "@/components/forge/theme";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "networth", label: "Net Worth" },
  { id: "audit", label: "Audit" },
];

export default function ForgeSidebar({ view, setView }) {
  return (
    <aside className={forgeTheme.sidebar}>
      <div className="mb-10">
        <div className={`text-xs font-bold uppercase tracking-[0.35em] ${forgeTheme.accent}`}>
          FORGE
        </div>
        <div className="mt-2 text-2xl font-black">Command Center</div>
        <p className={`mt-2 ${forgeTheme.textSmall}`}>
          Financial operating system for 409 Marketplace.
        </p>
      </div>

      <nav className="space-y-2">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            className={`w-full rounded-xl px-4 py-3 text-left text-sm font-semibold ${
              view === item.id
                ? forgeTheme.accentBg
                : "text-slate-300 hover:bg-slate-900"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
