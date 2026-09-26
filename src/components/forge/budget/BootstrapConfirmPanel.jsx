"use client";
import { useCallback, useEffect, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import {
  ForgeEmptyState,
  ForgeErrorState,
  ForgeLoadingState,
} from "@/components/forge/ForgeStates";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const centsToMoney = (cents) => (typeof cents === "number" ? money.format(cents / 100) : "—");

const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600";

// First-run budget bootstrap: recurring bills detected from the user's own
// transaction history, presented PRE-CHECKED so confirming is one tap and
// deselecting a false positive is the only work. Detection is read-only
// analysis -- nothing is written until the user confirms, and only the kept
// items are sent to the confirm endpoint.
export default function BootstrapConfirmPanel({ scope, month, onConfirmed, onDismissed }) {
  const [status, setStatus] = useState("loading"); // loading | error | ready
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [checkedIds, setCheckedIds] = useState(null); // Set<string> once seeded
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");

  const load = useCallback(() => {
    setStatus("loading");
    setLoadError("");
    setCheckedIds(null);
    fetch(`/api/budgeting/bootstrap?scope=${scope}`)
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.error || "Unable to analyze your transaction history.");
        setData(payload);
        setStatus("ready");
      })
      .catch((error) => {
        setLoadError(error.message);
        setStatus("error");
      });
  }, [scope]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- subscribes to the bootstrap analysis (an external store) on mount and scope change; the synchronous reset just clears the previous scope's payload.
    load();
  }, [load]);

  // Every candidate starts checked -- the user only touches the ones that are
  // wrong. Seeded once per loaded payload (render-guarded, like the budget
  // panel's draft seeding).
  if (status === "ready" && checkedIds === null && data) {
    setCheckedIds(new Set((data.bills ?? []).map((bill) => bill.id)));
  }

  const toggleBill = useCallback((id) => {
    setCheckedIds((previous) => {
      const next = new Set(previous ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const confirm = useCallback(
    (event) => {
      event.preventDefault();
      const kept = (data?.bills ?? []).filter((bill) => checkedIds?.has(bill.id));
      if (kept.length === 0 || confirming) return;
      setConfirming(true);
      setConfirmError("");
      fetch("/api/budgeting/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          month,
          items: kept.map((bill) => ({
            normalizedCategory: bill.category,
            displayLabel: bill.displayLabel,
            plannedAmountCents: bill.monthlyAmountCents,
          })),
        }),
      })
        .then((response) => response.json().then((payload) => ({ response, payload })))
        .then(({ response, payload }) => {
          if (!response.ok) throw new Error(payload.error || "Unable to save your budget.");
          if (onConfirmed) onConfirmed(payload);
        })
        .catch((error) => setConfirmError(error.message))
        .finally(() => setConfirming(false));
    },
    [checkedIds, confirming, data, month, onConfirmed, scope],
  );

  if (status === "loading" || checkedIds === null) {
    return (
      <div className="mt-6">
        <ForgeLoadingState label="Looking through your transaction history for recurring bills…" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="mt-6">
        <ForgeErrorState
          title="We couldn't analyze your history."
          detail={loadError}
          onRetry={load}
        />
      </div>
    );
  }

  const bills = data.bills ?? [];
  const income = data.income ?? [];

  // Honest empty states: no fake pre-population, and the guidance says exactly
  // what happened -- no history at all vs. history with nothing on a rhythm.
  if (data.eventsAnalyzed === 0) {
    return (
      <div className="mt-6">
        <ForgeEmptyState
          headline="No transaction history to learn from yet."
          guidance="Connect a bank account or import transactions first -- then we'll spot your recurring bills here and you can confirm them with one tap instead of typing every budget line by hand."
          actionLabel="I'll add categories by hand"
          onAction={onDismissed}
        />
      </div>
    );
  }

  if (bills.length === 0 && income.length === 0) {
    return (
      <div className="mt-6">
        <ForgeEmptyState
          headline="No steady recurring bills found."
          guidance={`We looked through ${data.eventsAnalyzed} transactions from the last 12 months and nothing repeats on a regular rhythm with steady amounts. Add your budget categories by hand instead.`}
          actionLabel="Add categories by hand"
          onAction={onDismissed}
        />
      </div>
    );
  }

  const checkedCount = bills.filter((bill) => checkedIds.has(bill.id)).length;

  return (
    <div className="mt-6 rounded-2xl border border-sky-200 bg-sky-50/60 p-5 dark:border-sky-900/60 dark:bg-sky-950/20">
      <h3 className="text-base font-black text-slate-950 dark:text-white">
        Start from your actual bills, not a blank form
      </h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        We found these repeating in your last 12 months of transactions. Everything is checked — uncheck anything
        that isn&rsquo;t really a recurring bill, then confirm once.
      </p>

      <form onSubmit={confirm}>
        <fieldset className="mt-4">
          <legend className="sr-only">Recurring bills to add to your budget</legend>
          <ul className="space-y-2">
            {bills.map((bill) => {
              const checked = checkedIds.has(bill.id);
              return (
                <li
                  key={bill.id}
                  className={`rounded-xl border bg-white px-4 py-3 transition dark:bg-slate-950 ${
                    checked
                      ? "border-sky-300 dark:border-sky-700"
                      : "border-slate-200 opacity-60 dark:border-slate-700"
                  }`}
                >
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleBill(bill.id)}
                      className={`mt-1 h-5 w-5 shrink-0 accent-sky-600 ${FOCUS_RING}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold text-slate-900 dark:text-white">{bill.payeeLabel}</span>
                      <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                        {centsToMoney(bill.monthlyAmountCents)} / month · {bill.cadence} · {bill.occurrences} payments
                        {bill.nextExpectedDate ? ` · next ~${bill.nextExpectedDate}` : ""}
                      </span>
                      <span className="mt-0.5 block text-xs font-bold text-sky-700 dark:text-sky-400">
                        Budget category: {bill.displayLabel}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>

        {income.length > 0 ? (
          <div className="mt-5">
            <h4 className="text-sm font-black uppercase tracking-wide text-slate-700 dark:text-slate-300">
              Recurring income we spotted
            </h4>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Nothing to check here — this already flows into your budget&rsquo;s income automatically.
            </p>
            <ul className="mt-2 space-y-2">
              {income.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-950"
                >
                  <p className="truncate font-bold text-slate-900 dark:text-white">{entry.payeeLabel}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {centsToMoney(entry.monthlyAmountCents)} / month · {entry.cadence} · {entry.occurrences} deposits
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {confirmError ? (
          <p role="alert" className="mt-4 text-sm font-bold text-red-700 dark:text-red-400">
            {confirmError}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={confirming || checkedCount === 0}
            className={`rounded-xl px-5 py-2.5 text-sm font-bold transition disabled:opacity-50 ${goldControlClassName} ${FOCUS_RING}`}
          >
            {confirming ? "Adding…" : `Add ${checkedCount} to my budget`}
          </button>
          <button
            type="button"
            onClick={onDismissed}
            className={`rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 ${FOCUS_RING}`}
          >
            I&rsquo;ll build it myself
          </button>
        </div>
        {checkedCount === 0 ? (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Nothing checked — uncheck everything and choose “I&rsquo;ll build it myself” to start from a blank budget.
          </p>
        ) : null}
      </form>
    </div>
  );
}
