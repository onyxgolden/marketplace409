import { forgeTheme } from "@/components/forge/theme";

export default function FinancialOperationsPanel({
  focus = "Operations Plan",
  summary = "Financial operations guidance is loading.",
  priority = "monitor",
  actions = [],
}) {
  return (
    <section
      data-financial-operations-panel
      className={forgeTheme.cardCompact}
    >
      <div className={forgeTheme.labelSmall}>
        Financial Operations
      </div>

      <h2 className="mt-2 text-xl font-black text-slate-950 dark:text-slate-50">
        {focus}
      </h2>

      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
        {summary}
      </p>

      <div className="mt-4 rounded-2xl bg-slate-100 p-4 dark:bg-slate-800/60">
        <div className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Priority
        </div>

        <div className="mt-1 text-lg font-black capitalize text-slate-950 dark:text-slate-50">
          {priority}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {actions.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            No financial operations actions are available yet.
          </div>
        ) : (
          actions.map((action) => (
            <div
              key={action.id}
              className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700"
            >
              <div className="font-black text-slate-900 dark:text-slate-50">
                {action.title}
              </div>

              <div className="mt-1 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {action.status} · {action.priority}
              </div>

              <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {action.rationale}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
