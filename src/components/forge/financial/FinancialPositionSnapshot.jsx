import { forgeTheme } from "@/components/forge/theme";

export default function FinancialPositionSnapshot({
  lines = [],
}) {
  return (
    <section
      data-financial-position-snapshot
      className={forgeTheme.card}
    >
      <div className={forgeTheme.labelSmall}>
        Financial Statement
      </div>

      <h2 className="mt-2 text-2xl font-black text-slate-950 dark:text-slate-50">
        Balance Sheet Snapshot
      </h2>

      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
        Current account balances supplied by the financial
        position read model.
      </p>

      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
        <table className="w-full border-collapse text-left">
          <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
            <tr>
              <th className="p-4">Account</th>
              <th className="p-4 text-right">Amount</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {lines.length === 0 ? (
              <tr>
                <td
                  colSpan={2}
                  className="p-5 text-sm text-slate-500 dark:text-slate-400"
                >
                  No balance-sheet accounts are available yet.
                </td>
              </tr>
            ) : (
              lines.map((line) => (
                <tr key={line.accountId}>
                  <td className="p-4 font-bold text-slate-800 dark:text-slate-200">
                    {line.accountName}
                  </td>

                  <td
                    className={`p-4 text-right font-black ${
                      line.isNegative
                        ? "text-rose-700 dark:text-rose-400"
                        : "text-slate-950 dark:text-slate-50"
                    }`}
                  >
                    {line.amount}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
