import Link from "next/link";

const quickActions = [
  {
    label: "Run Audit",
    detail: "Review ledger anomalies and risk signals.",
    href: "/forge/import",
  },
  {
    label: "Import Data",
    detail: "Prepare bank, accounting, or property data imports.",
    href: "/forge/import",
  },
  {
    label: "Review Portfolio",
    detail: "Open property and net worth operating views.",
    href: "/forge/financial",
  },
];

export default function ForgeQuickActions({ setView, variant = "default" }) {
  const embedded = variant === "embedded";

  return (
    <section
      className={
        embedded ? "" : "rounded-3xl border border-slate-200 bg-white p-6"
      }
    >
      <div className="text-xs font-black uppercase tracking-wide text-slate-500">
        Quick Actions
      </div>

      <div className="mt-4 grid gap-3">
        {quickActions.map((action) =>
          action.label === "Run Audit" ? (
            <button
              key={action.label}
              type="button"
              onClick={() => setView("audit")}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-slate-400 hover:bg-white"
            >
              <div className="font-black text-slate-950">{action.label}</div>
              <div className="mt-1 text-sm leading-6 text-slate-600">
                {action.detail}
              </div>
            </button>
          ) : (
            <Link
              key={action.label}
              href={action.href}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-slate-400 hover:bg-white"
            >
              <div className="font-black text-slate-950">{action.label}</div>
              <div className="mt-1 text-sm leading-6 text-slate-600">
                {action.detail}
              </div>
            </Link>
          ),
        )}
      </div>
    </section>
  );
}
