import { forgeTheme } from "@/components/forge/theme";

export default function ConnectionExecutionResultCard({
  execution,
}) {
  if (!execution) {
    return null;
  }

  const metrics =
    execution.metrics || {};

  const health =
    execution.health || {};

  const recommendation =
    execution.recommendation || {};

  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
      <div className="text-sm uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Connection Execution
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className={forgeTheme.cardCompact}>
          <div className={forgeTheme.labelSmall}>
            Status
          </div>
          <div className="mt-2 text-xl font-black text-slate-950 dark:text-white">
            {execution.status || "unknown"}
          </div>
        </div>

        <div className={forgeTheme.cardCompact}>
          <div className={forgeTheme.labelSmall}>
            Health
          </div>
          <div className="mt-2 text-xl font-black text-slate-950 dark:text-white">
            {health.state || "unknown"}
          </div>
        </div>

        <div className={forgeTheme.cardCompact}>
          <div className={forgeTheme.labelSmall}>
            Score
          </div>
          <div className="mt-2 text-xl font-black text-slate-950 dark:text-white">
            {health.score ?? 0}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className={forgeTheme.cardCompact}>
          <div className={forgeTheme.labelSmall}>
            Accounts
          </div>
          <div className="mt-2 text-xl font-black text-slate-950 dark:text-white">
            {metrics.financialAccountsImported ?? 0}
          </div>
        </div>

        <div className={forgeTheme.cardCompact}>
          <div className={forgeTheme.labelSmall}>
            Balances
          </div>
          <div className="mt-2 text-xl font-black text-slate-950 dark:text-white">
            {metrics.accountBalancesImported ?? 0}
          </div>
        </div>

        <div className={forgeTheme.cardCompact}>
          <div className={forgeTheme.labelSmall}>
            Transactions
          </div>
          <div className="mt-2 text-xl font-black text-slate-950 dark:text-white">
            {metrics.transactionsImported ?? 0}
          </div>
        </div>

        <div className={forgeTheme.cardCompact}>
          <div className={forgeTheme.labelSmall}>
            Failures
          </div>
          <div className="mt-2 text-xl font-black text-slate-950 dark:text-white">
            {metrics.failedRecordCount ?? 0}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-4">
        <div className={forgeTheme.labelSmall}>
          Recommendation
        </div>
        <div className="mt-2 font-bold text-slate-950 dark:text-white">
          {recommendation.action || "none"}
        </div>
      </div>
    </section>
  );
}
