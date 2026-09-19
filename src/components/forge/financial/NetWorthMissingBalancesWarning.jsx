import { AlertTriangle } from "lucide-react";

// Disclosure for the Workspace net-worth tile: the aggregates silently exclude active
// accounts that have no balance row at all, so the headline figure is not complete
// household net worth. Renders nothing when every account has a recorded balance.
export default function NetWorthMissingBalancesWarning({
  missingBalances = [],
}) {
  const count = missingBalances.length;
  if (count === 0) return null;

  const noun = count === 1 ? "account" : "accounts";

  return (
    <div
      data-net-worth-missing-balances
      role="note"
      aria-label={`Net worth excludes ${count} ${noun} without recorded balances`}
      className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/40"
    >
      <p className="flex items-center gap-2 text-sm font-bold text-amber-900 dark:text-amber-200">
        <AlertTriangle
          size={16}
          aria-hidden="true"
          className="shrink-0"
        />
        Excludes {count} {noun} without recorded balances
      </p>
      <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-300">
        Net worth covers only accounts with a recorded balance.
      </p>
      <details className="mt-2 text-xs text-amber-800 dark:text-amber-300">
        <summary className="cursor-pointer font-semibold underline">
          View {noun}
        </summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {missingBalances.map((account) => (
            <li key={account.id}>{account.name}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
