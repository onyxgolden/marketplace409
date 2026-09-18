"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const centsToMoney = (cents) => money.format(cents / 100);
const dollars = (amount) => money.format(Math.abs(amount));
const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600";

// Surfaces the Rentec/raw-bank-feed duplicate problem (a 'transaction'-sourced row from the Stripe
// Financial Connections bank feed describing the same real rent/expense as an already-correct
// rentec/rentec_api row) and lets the owner explicitly apply the fix -- never automatic. See
// reconcileTransactionDuplicates.js for the matching policy.
export default function ReconcileDuplicatesPanel() {
  const [status, setStatus] = useState("loading"); // "loading" | "available" | "schema-unavailable" | "error"
  const [errorMessage, setErrorMessage] = useState("");
  const [preview, setPreview] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [applyStatus, setApplyStatus] = useState("idle"); // "idle" | "applying" | "done" | "error"
  const [applyMessage, setApplyMessage] = useState("");
  const requestInFlight = useRef(false);

  const load = useCallback(() => {
    if (requestInFlight.current) return undefined;
    requestInFlight.current = true;
    setStatus("loading");
    setErrorMessage("");
    return fetch("/api/financial/reconcile-duplicates")
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (response.status === 503 && payload.code === "reconcile_duplicates_schema_unavailable") {
          setStatus("schema-unavailable");
          return null;
        }
        if (!response.ok) throw new Error(payload.error || "Unable to check for duplicate transactions.");
        setPreview(payload);
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

  const canApply = acknowledged && confirmationText.trim().toUpperCase() === "CONFIRM" && (preview?.confirmedDuplicates.length ?? 0) > 0;

  const applyReconciliation = () => {
    setApplyStatus("applying");
    setApplyMessage("");
    fetch("/api/financial/reconcile-duplicates", { method: "POST" })
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.error || "Unable to apply the reconciliation.");
        setApplyStatus("done");
        setApplyMessage(
          payload.failedCount > 0
            ? `Excluded ${payload.appliedCount} duplicate transaction(s); ${payload.failedCount} could not be applied.`
            : `Excluded ${payload.appliedCount} duplicate transaction(s) from your books. They stay in the record, just no longer counted.`,
        );
        setAcknowledged(false);
        setConfirmationText("");
        return load();
      })
      .catch((applyError) => {
        setApplyStatus("error");
        setApplyMessage(applyError.message);
      });
  };

  if (status === "loading") {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
          Checking for duplicate transactions…
        </p>
      </section>
    );
  }

  if (status === "schema-unavailable") {
    return null; // Feature not yet activated in this environment -- nothing to show, no error either.
  }

  if (status === "error") {
    return (
      <section className="rounded-3xl border border-red-200 bg-red-50 p-6 dark:border-red-900/60 dark:bg-red-950/30">
        <p role="alert" className="text-sm font-bold text-red-800 dark:text-red-300">
          {errorMessage || "Something went wrong checking for duplicate transactions."}
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

  const confirmedDuplicates = preview?.confirmedDuplicates ?? [];
  const ambiguous = preview?.ambiguous ?? [];

  return (
    <section
      data-guided-workflow-panel
      aria-label="Duplicate transaction reconciliation"
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900"
    >
      <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Books</p>
      <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Duplicate transactions</h2>
      <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
        A raw bank-feed transaction and a Rentec-tracked record can both describe the same real rent payment or
        expense. This finds those overlaps by matching date and amount, and only ever flags an exact,
        unambiguous match — anything uncertain is left for you to review separately, never guessed at.
      </p>

      {confirmedDuplicates.length === 0 && ambiguous.length === 0 ? (
        <p className="mt-6 text-sm font-bold text-emerald-700 dark:text-emerald-400">
          No duplicate transactions found right now.
        </p>
      ) : (
        <>
          <dl className="mt-6 grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:grid-cols-3 dark:border-slate-700 dark:bg-slate-950/40">
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Confirmed duplicates</dt>
              <dd className="mt-1 text-xl font-black text-slate-950 dark:text-white">{confirmedDuplicates.length}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Double-counted amount</dt>
              <dd className="mt-1 text-xl font-black text-slate-950 dark:text-white">{centsToMoney(preview.totalConfirmedAmountCents)}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Needs manual review</dt>
              <dd className="mt-1 text-xl font-black text-amber-700 dark:text-amber-400">{ambiguous.length}</dd>
            </div>
          </dl>

          {confirmedDuplicates.length > 0 ? (
            <div className="mt-6 max-h-96 overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-700 dark:bg-slate-950/40">
                    <th scope="col" className="px-3 py-2 font-bold text-slate-600 dark:text-slate-300">Date</th>
                    <th scope="col" className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-300">Amount</th>
                    <th scope="col" className="px-3 py-2 font-bold text-slate-600 dark:text-slate-300">Bank feed says</th>
                    <th scope="col" className="px-3 py-2 font-bold text-slate-600 dark:text-slate-300">Rentec says</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {confirmedDuplicates.map((entry) => (
                    <tr key={entry.transactionId}>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{entry.transactionDate}</td>
                      <td className="px-3 py-2 text-right font-bold text-slate-950 dark:text-white">{dollars(entry.transactionAmount)}</td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{entry.transactionDescription}</td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{entry.rentecDescription}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {ambiguous.length > 0 ? (
            <p className="mt-4 text-xs text-amber-700 dark:text-amber-400">
              {ambiguous.length} transaction(s) matched more than one possible Rentec record (or contended for the
              same one) and were left alone — not enough certainty to exclude automatically.
            </p>
          ) : null}

          {confirmedDuplicates.length > 0 ? (
            <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/30">
              <label className="flex gap-3 text-sm font-bold text-amber-950 dark:text-amber-200">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  className={FOCUS_RING}
                />
                I reviewed this list and understand it excludes these {confirmedDuplicates.length} bank-feed rows
                from reports (they stay in the record, marked as a duplicate — this is fully reversible).
              </label>
              <label className="mt-4 block text-sm font-bold text-amber-950 dark:text-amber-200">
                Type CONFIRM to apply
                <input
                  value={confirmationText}
                  onChange={(event) => setConfirmationText(event.target.value)}
                  autoComplete="off"
                  className={`mt-2 block w-full max-w-xs rounded-lg border border-amber-400 bg-white px-3 py-2 text-slate-950 dark:bg-slate-950 dark:text-white ${FOCUS_RING}`}
                />
              </label>
              <button
                type="button"
                disabled={!canApply || applyStatus === "applying"}
                onClick={applyReconciliation}
                className={`mt-5 rounded-xl px-5 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40 ${goldControlClassName} ${FOCUS_RING}`}
              >
                {applyStatus === "applying" ? "Applying…" : `Exclude ${confirmedDuplicates.length} confirmed duplicate(s)`}
              </button>
            </div>
          ) : null}
        </>
      )}

      {applyMessage ? (
        <p
          role={applyStatus === "error" ? "alert" : "status"}
          className={`mt-4 text-sm font-bold ${applyStatus === "error" ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}
        >
          {applyMessage}
        </p>
      ) : null}
    </section>
  );
}
