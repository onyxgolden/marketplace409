"use client";
import { useCallback, useEffect, useRef, useState } from "react";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dollars = (amount) => money.format(Math.abs(amount));
const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600";

const CADENCE_STYLES = {
  weekly: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  biweekly: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  monthly: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  quarterly: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  yearly: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};
const cadenceStyle = (cadence) => CADENCE_STYLES[cadence] ?? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";

// Read-only: reports repeating income/expense patterns the detector finds (subscriptions,
// loan payments, paychecks). Detection runs on every load; there is nothing to apply and
// nothing is ever written. See detectRecurringPayments.js for the algorithm.
export default function RecurringPaymentsPanel() {
  const [status, setStatus] = useState("loading"); // "loading" | "available" | "error"
  const [errorMessage, setErrorMessage] = useState("");
  const [patterns, setPatterns] = useState([]);
  const requestInFlight = useRef(false);

  const load = useCallback(() => {
    if (requestInFlight.current) return undefined;
    requestInFlight.current = true;
    setStatus("loading");
    setErrorMessage("");
    return fetch("/api/financial/recurring")
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.error || "Unable to detect recurring payments.");
        setPatterns(payload.patterns ?? []);
        setStatus("available");
        return null;
      })
      .catch((loadError) => {
        setErrorMessage(loadError.message);
        setStatus("error");
      })
      .finally(() => {
        requestInFlight.current = false;
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (status === "loading") {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
          Looking for recurring payments…
        </p>
      </section>
    );
  }

  if (status === "error") {
    return (
      <section className="rounded-3xl border border-red-200 bg-red-50 p-6 dark:border-red-900/60 dark:bg-red-950/30">
        <p role="alert" className="text-sm font-bold text-red-800 dark:text-red-300">
          {errorMessage || "Something went wrong detecting recurring payments."}
        </p>
        <button
          type="button"
          onClick={load}
          className={`mt-4 rounded-xl border border-red-400 px-4 py-2 text-sm font-bold text-red-800 transition hover:bg-red-100 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/40 ${FOCUS_RING}`}
        >
          Retry
        </button>
      </section>
    );
  }

  return (
    <section
      aria-label="Recurring payments"
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900"
    >
      <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Books</p>
      <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Recurring payments</h2>
      <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
        Subscriptions, loan payments, and paychecks the detector recognizes from your history — same account,
        same direction, similar amounts, steady rhythm. Tolerates amount drift and an occasional missed payment.
      </p>

      {patterns.length === 0 ? (
        <p className="mt-6 text-sm font-bold text-slate-600 dark:text-slate-400">
          No recurring patterns found yet — they emerge as more history lands in the feed.
        </p>
      ) : (
        <div className="mt-6 space-y-3">
          {patterns.map((pattern) => (
            <article
              key={`${pattern.accountName}-${pattern.direction}-${pattern.category}-${pattern.cadence}`}
              className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${cadenceStyle(pattern.cadence)}`}>
                  {pattern.cadence}
                </span>
                <span className="text-sm font-bold text-slate-950 dark:text-white">
                  {dollars(pattern.medianAmount)}
                  <span className="ml-1 font-normal text-slate-500 dark:text-slate-400">
                    {pattern.direction === "inbound" ? "in" : "out"}
                  </span>
                </span>
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {pattern.accountName ?? "Unknown account"}
                  {pattern.category && pattern.category !== "other" ? ` · ${pattern.category.replace(/_/g, " ")}` : ""}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Occurrences</dt>
                  <dd className="font-bold text-slate-950 dark:text-white">{pattern.occurrences}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Rhythm</dt>
                  <dd className="font-bold text-slate-950 dark:text-white">~{pattern.medianIntervalDays} days</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Last seen</dt>
                  <dd className="font-bold text-slate-950 dark:text-white">{pattern.lastDate}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Next expected</dt>
                  <dd className="font-bold text-emerald-700 dark:text-emerald-400">{pattern.nextExpectedDate ?? "—"}</dd>
                </div>
              </dl>
              {pattern.irregularIntervals > 0 ? (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {pattern.irregularIntervals} irregular gap{pattern.irregularIntervals === 1 ? "" : "s"} in the history (late or missed payment).
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
