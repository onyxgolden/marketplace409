"use client";
import { useMemo } from "react";
import { upcomingRecurringOccurrences } from "@/domains/financial-event/detectRecurringPayments";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import {
  ForgeErrorState,
  ForgeLoadingState,
} from "@/components/forge/ForgeStates";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dollars = (amount) => money.format(Math.abs(amount));
const CADENCE_STYLES = {
  weekly: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  biweekly: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  monthly: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  quarterly: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  yearly: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};
const cadenceStyle = (cadence) => CADENCE_STYLES[cadence] ?? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";

// Fetches the detected repeating income/expense patterns (subscriptions,
// loan payments, paychecks). Read-only: detection runs server-side on every
// load; there is nothing to apply and nothing is ever written. See
// detectRecurringPayments.js for the algorithm.
async function fetchRecurringPatterns() {
  const response = await fetch("/api/financial/recurring");
  const payload = await response.json().then((body) => body).catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Unable to detect recurring payments.");
  return payload.patterns ?? [];
}

export default function RecurringPaymentsPanel() {
  // Recurring patterns: stale-while-revalidate. The last detected list stays
  // on screen while a refresh is in flight; a failed refresh keeps it too.
  const { data, error: loadError, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    "financial:recurring-patterns",
    fetchRecurringPatterns,
    { ttlMs: 120_000 },
  );
  const patterns = data ?? null;

  const upcoming = useMemo(
    () => upcomingRecurringOccurrences(patterns, { daysAhead: 30 }),
    [patterns],
  );
  const upcomingOutCents = useMemo(
    () => upcoming.filter((o) => o.direction === "outbound").reduce((total, o) => total + Math.round(o.amount * 100), 0),
    [upcoming],
  );
  const upcomingInCents = useMemo(
    () => upcoming.filter((o) => o.direction === "inbound").reduce((total, o) => total + Math.round(o.amount * 100), 0),
    [upcoming],
  );

  if (!patterns && isLoading) {
    return <ForgeLoadingState label="Looking for recurring payments…" />;
  }

  if (!patterns && loadError) {
    return (
      <ForgeErrorState
        title={loadError || "Something went wrong detecting recurring payments."}
        onRetry={refresh}
      />
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
      {isRefreshing ? (
        <p className="mt-2 text-xs font-bold text-slate-400 dark:text-slate-500">Updating…</p>
      ) : null}
      {loadError ? (
        <p role="status" className="mt-2 text-xs font-bold text-slate-400 dark:text-slate-500">
          Could not refresh — showing the last saved patterns.
        </p>
      ) : null}

      {patterns.length === 0 ? (
        <p className="mt-6 text-sm font-bold text-slate-600 dark:text-slate-400">
          No recurring patterns found yet — they emerge as more history lands in the feed.
        </p>
      ) : (
        <>
          {upcoming.length > 0 ? (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-black uppercase tracking-wide text-slate-700 dark:text-slate-300">
                  Coming up · next 30 days
                </h3>
                <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                  <span className="text-red-700 dark:text-red-400">{dollars(upcomingOutCents / 100)} out</span>
                  {upcomingInCents > 0 ? (
                    <span className="ml-2 text-emerald-700 dark:text-emerald-400">{dollars(upcomingInCents / 100)} in</span>
                  ) : null}
                </p>
              </div>
              <ul className="mt-3 space-y-1.5">
                {upcoming.map((occurrence, index) => (
                  <li
                    key={`${occurrence.date}-${occurrence.accountName}-${occurrence.amount}-${index}`}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-slate-600 dark:text-slate-400">
                      <span className="font-bold text-slate-800 dark:text-slate-200">{occurrence.date}</span>
                      {" · "}
                      {occurrence.accountName ?? "Unknown account"}
                      {occurrence.category && occurrence.category !== "other"
                        ? ` · ${occurrence.category.replace(/_/g, " ")}`
                        : ""}
                    </span>
                    <span
                      className={`font-bold ${
                        occurrence.direction === "outbound"
                          ? "text-red-700 dark:text-red-400"
                          : "text-emerald-700 dark:text-emerald-400"
                      }`}
                    >
                      {occurrence.direction === "outbound" ? "−" : "+"}
                      {dollars(occurrence.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
        </>
      )}
    </section>
  );
}
