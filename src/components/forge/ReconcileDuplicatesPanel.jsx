"use client";
import { useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import {
  ForgeErrorState,
  ForgeLoadingState,
} from "@/components/forge/ForgeStates";
import { ForgeActionButton } from "@/components/forge/ForgeActions";
import { ACTION_GATE, resolveActionGate } from "@/domains/financial-event/actionGate";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const centsToMoney = (cents) => money.format(cents / 100);
const dollars = (amount) => money.format(Math.abs(amount));
const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600";

// Loads the duplicate-transaction preview. The 503 schema-unavailable case
// is not an error -- the feature simply isn't active in this environment --
// so it resolves as a payload with a flag instead of throwing; the panel
// renders nothing for it, same as before.
async function fetchDuplicatesPreview() {
  const response = await fetch("/api/financial/reconcile-duplicates");
  const payload = await response.json();
  if (response.status === 503 && payload.code === "reconcile_duplicates_schema_unavailable") {
    return { schemaUnavailable: true };
  }
  if (!response.ok) throw new Error(payload.error || "Unable to check for duplicate transactions.");
  return payload;
}

// Surfaces the Rentec/raw-bank-feed duplicate problem (a 'transaction'-sourced row from the Stripe
// Financial Connections bank feed describing the same real rent/expense as an already-correct
// rentec/rentec_api row) and lets the owner explicitly apply the fix -- never automatic. See
// reconcileTransactionDuplicates.js for the matching policy.
export default function ReconcileDuplicatesPanel() {
  // Duplicate preview: stale-while-revalidate. The last preview stays on
  // screen while a refresh is in flight; a failed refresh keeps it too.
  const {
    data: preview,
    error: loadError,
    isLoading,
    isRefreshing,
    refresh,
  } = useStaleWhileRevalidate("financial:reconcile-duplicates", fetchDuplicatesPreview, { ttlMs: 60_000 });
  const schemaUnavailable = preview?.schemaUnavailable === true;
  const [applyStatus, setApplyStatus] = useState("idle"); // "idle" | "applying" | "done" | "error"
  const [applyMessage, setApplyMessage] = useState("");
  const [applyingIds, setApplyingIds] = useState([]); // ids in flight right now
  const [lastAppliedIds, setLastAppliedIds] = useState([]); // ids applied by the last successful apply, for Undo
  const [undoStatus, setUndoStatus] = useState("idle"); // "idle" | "undoing" | "error"

  // Gate decision, one shared rule (see actionGate.js): these are exact,
  // unambiguous bidirectional matches the human reviews in the table below,
  // and every exclusion is undoable -- so this is a single click, not the
  // typed-CONFIRM gate. Anything ambiguous is listed separately and can never
  // be applied from here. If the inputs above ever change such that the
  // shared rule demands the heavy gate, the one-click UI below does not
  // render -- it fails safe instead of silently demoting.
  const gate = resolveActionGate({ ambiguous: false, reversible: true });
  const [typedAcknowledged, setTypedAcknowledged] = useState(false);
  const [typedConfirmationText, setTypedConfirmationText] = useState("");

  const applyExclusions = (transactionIds) => {
    const ids = Array.isArray(transactionIds) ? transactionIds : [];
    setApplyStatus("applying");
    setApplyingIds(ids);
    setApplyMessage("");
    setLastAppliedIds([]);
    setUndoStatus("idle");
    fetch("/api/financial/reconcile-duplicates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids.length > 0 ? { transactionIds: ids } : {}),
    })
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.error || "Unable to apply the reconciliation.");
        const appliedIds = (payload.applied ?? []).map((entry) => entry.transactionId);
        setApplyStatus("done");
        setLastAppliedIds(appliedIds);
        setApplyMessage(
          payload.failedCount > 0
            ? `Excluded ${payload.appliedCount} duplicate transaction(s); ${payload.failedCount} could not be applied.`
            : `Excluded ${payload.appliedCount} duplicate transaction(s) from your books. They stay in the record, marked as duplicates -- and you can restore them with Undo below.`,
        );
        refresh();
      })
      .catch((applyError) => {
        setApplyStatus("error");
        setApplyMessage(applyError.message);
      })
      .finally(() => setApplyingIds([]));
  };

  const undoExclusions = () => {
    if (lastAppliedIds.length === 0) return;
    setUndoStatus("undoing");
    setApplyMessage("");
    fetch("/api/financial/reconcile-duplicates", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionIds: lastAppliedIds }),
    })
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.error || "Unable to restore the excluded rows.");
        setUndoStatus("idle");
        setLastAppliedIds([]);
        setApplyStatus("done");
        setApplyMessage(
          payload.failedCount > 0
            ? `Restored ${payload.restoredCount} row(s); ${payload.failedCount} could not be restored.`
            : `Restored ${payload.restoredCount} row(s) -- they're back in your books.`,
        );
        refresh();
      })
      .catch((undoError) => {
        setUndoStatus("error");
        setApplyMessage(undoError.message);
      });
  };

  if (!preview && isLoading) {
    return <ForgeLoadingState label="Checking for duplicate transactions…" />;
  }

  if (schemaUnavailable) {
    return null; // Feature not yet activated in this environment -- nothing to show, no error either.
  }

  if (!preview && loadError) {
    return (
      <ForgeErrorState
        title={
          loadError ||
          "Something went wrong checking for duplicate transactions."
        }
        onRetry={refresh}
      />
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
      {isRefreshing ? (
        <p className="mt-2 text-xs font-bold text-slate-400 dark:text-slate-500">Updating…</p>
      ) : null}
      {loadError ? (
        <p role="status" className="mt-2 text-xs font-bold text-slate-400 dark:text-slate-500">
          Could not refresh — showing the last saved duplicates.
        </p>
      ) : null}

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
                    <th scope="col" className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-300">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {confirmedDuplicates.map((entry) => {
                    const busy = applyingIds.includes(entry.transactionId);
                    return (
                      <tr key={entry.transactionId}>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{entry.transactionDate}</td>
                        <td className="px-3 py-2 text-right font-bold text-slate-950 dark:text-white">{dollars(entry.transactionAmount)}</td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{entry.transactionDescription}</td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{entry.rentecDescription}</td>
                        <td className="px-3 py-2 text-right">
                          {gate === ACTION_GATE.SINGLE ? (
                            <ForgeActionButton
                              variant="warn"
                              disabled={busy || applyStatus === "applying"}
                              onClick={() => applyExclusions([entry.transactionId])}
                            >
                              {busy ? "Excluding…" : "Exclude"}
                            </ForgeActionButton>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
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
            gate === ACTION_GATE.TYPED ? (
              <div className="sticky bottom-4 z-10 mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-lg dark:border-amber-800 dark:bg-amber-950/30">
                <label className="flex gap-3 text-sm font-bold text-amber-950 dark:text-amber-200">
                  <input
                    type="checkbox"
                    checked={typedAcknowledged}
                    onChange={(event) => setTypedAcknowledged(event.target.checked)}
                    className={`mt-1 h-5 w-5 shrink-0 ${FOCUS_RING}`}
                  />
                  I reviewed this list and understand it excludes these {confirmedDuplicates.length} bank-feed row(s)
                  from reports. They stay in the record, marked as duplicates.
                </label>
                <label className="mt-4 block text-sm font-bold text-amber-950 dark:text-amber-200">
                  Type CONFIRM to apply
                  <input
                    value={typedConfirmationText}
                    onChange={(event) => setTypedConfirmationText(event.target.value)}
                    autoComplete="off"
                    className={`mt-2 block min-h-11 w-full max-w-xs rounded-lg border border-amber-400 bg-white px-3 py-2 text-slate-950 dark:bg-slate-950 dark:text-white ${FOCUS_RING}`}
                  />
                </label>
                <ForgeActionButton
                  variant="gold"
                  disabled={
                    !typedAcknowledged ||
                    typedConfirmationText.trim().toUpperCase() !== "CONFIRM" ||
                    applyStatus === "applying"
                  }
                  onClick={() => applyExclusions(confirmedDuplicates.map((entry) => entry.transactionId))}
                  className="mt-5"
                >
                  {applyStatus === "applying" ? "Excluding…" : `Exclude ${confirmedDuplicates.length} confirmed duplicate(s)`}
                </ForgeActionButton>
              </div>
            ) : (
              <div className="sticky bottom-4 z-10 mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-lg dark:border-slate-700 dark:bg-slate-950/40">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Excluding removes these {confirmedDuplicates.length} bank-feed row(s) from reports. They stay in the
                  record, marked as duplicates -- and every exclusion can be undone.
                </p>
                <ForgeActionButton
                  variant="gold"
                  disabled={applyStatus === "applying"}
                  onClick={() => applyExclusions(confirmedDuplicates.map((entry) => entry.transactionId))}
                  className="mt-4"
                >
                  {applyStatus === "applying" ? "Excluding…" : `Exclude ${confirmedDuplicates.length} confirmed duplicate(s)`}
                </ForgeActionButton>
              </div>
            )
          ) : null}
        </>
      )}

      {applyMessage ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p
            role={applyStatus === "error" || undoStatus === "error" ? "alert" : "status"}
            className={`text-sm font-bold ${applyStatus === "error" || undoStatus === "error" ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}
          >
            {applyMessage}
          </p>
          {applyStatus === "done" && lastAppliedIds.length > 0 ? (
            <ForgeActionButton
              variant="secondary"
              disabled={undoStatus === "undoing"}
              onClick={undoExclusions}
            >
              {undoStatus === "undoing" ? "Restoring…" : `Undo (restore ${lastAppliedIds.length})`}
            </ForgeActionButton>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
