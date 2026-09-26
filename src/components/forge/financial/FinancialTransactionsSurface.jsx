import { useState } from "react";

// "manual" is accurate but reads as an internal implementation string, not something written for
// an owner to read -- shown wherever a transaction's source is surfaced, filtered view or not, so
// there's one consistent label rather than a rough edge that only shows up sometimes.
function sourceLabel(transaction) {
  if (transaction.sourceSystem === "manual") return "Manual entry";
  return transaction.sourceSystem || "Unknown";
}

const DEFAULT_PAGE_SIZE = 25;

export default function FinancialTransactionsSurface({
  transactions = [],
  loadState = "ready",
  accountName = null,
  onBack = null,
  pageSize = DEFAULT_PAGE_SIZE,
}) {
  const [visibleCount, setVisibleCount] = useState(pageSize);

  // The list can change (new import, account switch) -- never show fewer than
  // the page size when the list grows back, and never show more rows than exist.
  const safeVisibleCount = Math.min(Math.max(visibleCount, pageSize), Math.max(transactions.length, 1));
  const visibleTransactions = transactions.slice(0, safeVisibleCount);
  const hasMore = safeVisibleCount < transactions.length;

  function showMore() {
    setVisibleCount((current) => current + pageSize);
  }

  return (
    <section
      data-financial-transactions-surface
      className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <header className="border-b border-slate-200 p-5 lg:p-6 dark:border-slate-800">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mb-3 text-xs font-black text-sky-700 hover:underline dark:text-sky-400"
          >
            ← Back to overview
          </button>
        )}

        <div className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">
          Financial Activity
        </div>

        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h3 data-financial-activity-heading className="text-2xl font-black tracking-tight text-slate-950 dark:text-slate-50">
              {accountName ? accountName : "All transactions"}
            </h3>

            <p className="mt-2 max-w-3xl text-sm font-semibold text-slate-600 dark:text-slate-400">
              {accountName
                ? "Every transaction that makes up this account's balance, newest first."
                : "Every transaction across properties, categories, and connected sources, newest first."}
            </p>
          </div>

          <div className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {transactions.length === 0
              ? "0 shown"
              : safeVisibleCount >= transactions.length
                ? `${transactions.length.toLocaleString()} shown`
                : `${safeVisibleCount.toLocaleString()} of ${transactions.length.toLocaleString()} shown`}
          </div>
        </div>
      </header>

      {loadState === "loading" ? (
        <p className="p-6 text-sm font-semibold text-slate-500 dark:text-slate-400">
          Loading transactions...
        </p>
      ) : transactions.length === 0 ? (
        <p className="p-6 text-sm font-semibold text-slate-500 dark:text-slate-400">
          No transactions are available.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full border-collapse text-left">
            <thead className="bg-slate-50 text-xs font-black uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="px-5 py-3">
                  Date
                </th>
                <th className="px-5 py-3">
                  Description
                </th>
                <th className="px-5 py-3">
                  Property
                </th>
                <th className="px-5 py-3">
                  Category
                </th>
                <th className="px-5 py-3">
                  Source
                </th>
                <th className="px-5 py-3 text-right">
                  Amount
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visibleTransactions.map(
                (transaction) => (
                  <tr
                    key={transaction.id}
                    className="text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60"
                  >
                    <td className="whitespace-nowrap px-5 py-4">
                      {transaction.eventDate ||
                        "Date unavailable"}
                    </td>

                    <td className="px-5 py-4 font-black text-slate-950 dark:text-slate-50">
                      {transaction.description ||
                        "Transaction"}
                    </td>

                    <td className="px-5 py-4">
                      {transaction.propertyName}
                    </td>

                    <td className="px-5 py-4">
                      {transaction.categoryLabel}
                    </td>

                    <td className="px-5 py-4">
                      {sourceLabel(transaction)}
                    </td>

                    <td
                      className={
                        transaction.isIncome
                          ? "whitespace-nowrap px-5 py-4 text-right font-black text-emerald-700 dark:text-emerald-400"
                          : "whitespace-nowrap px-5 py-4 text-right font-black text-slate-950 dark:text-slate-50"
                      }
                    >
                      {transaction.isIncome
                        ? "+"
                        : "-"}
                      {transaction.amount}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && loadState !== "loading" && (
        <div className="flex justify-center border-t border-slate-200 p-4 dark:border-slate-800">
          <button
            type="button"
            onClick={showMore}
            className="rounded-xl border border-slate-300 px-5 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Show more ({(transactions.length - safeVisibleCount).toLocaleString()} remaining)
          </button>
        </div>
      )}
    </section>
  );
}
