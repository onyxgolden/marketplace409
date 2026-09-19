"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { ACTION_GATE, resolveActionGate } from "@/domains/financial-event/actionGate";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const centsToMoney = (cents) => money.format(cents / 100);
const dollars = (amount) => money.format(Math.abs(amount));
const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600";

// Category vocabulary the Brain may suggest and the human may pick from -- the
// same normalized_category strings the reconcile apply flow writes.
const CATEGORY_OPTIONS = Object.freeze([
  "internal_transfer",
  "owner_distribution",
  "mortgage_payment",
  "heloc_payment",
  "loan_payment",
  "mortgage_interest",
  "rental_income",
  "cam_income",
  "property_repairs",
  "property_tax",
  "cleaning_supplies",
  "legal_fees",
  "professional_fees",
  "asset_purchase",
  "forge_rental_payment",
]);

function prettyCategory(category) {
  return String(category || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function categoryOptionsFor(suggestionCategory) {
  const options = new Set(CATEGORY_OPTIONS);
  if (suggestionCategory) options.add(suggestionCategory);
  return [...options].sort();
}

// Surfaces two related raw-bank-feed problems and lets the owner explicitly apply the fix -- never
// automatic. See correctRawBankFeedDirection.js and classifyTransferPairs.js for the logic:
//   1. Direction fixes: a real deposit landed as a negative "expense" (the unmapped-category
//      fallback path always guesses "expense" and never flips the sign).
//   2. Transfers/distributions: money moved between the owner's own accounts, misread as real
//      income or a real expense instead of an internal transfer -- or, when it crosses the
//      personal/business line, a real owner distribution that wasn't labeled as one.
export default function ReconcileTransfersPanel() {
  const [status, setStatus] = useState("loading"); // "loading" | "available" | "schema-unavailable" | "error"
  const [errorMessage, setErrorMessage] = useState("");
  const [preview, setPreview] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [applyStatus, setApplyStatus] = useState("idle"); // "idle" | "applying" | "done" | "error"
  const [applyMessage, setApplyMessage] = useState("");
  // Per-row human category picks for ambiguous entries. The "Use:" suggestion
  // chip fills the picker as a scratchpad; the per-row Apply button below
  // writes it through the conversational-actions API (single confirmation:
  // the human picked the exact row and category, and the write is reversible).
  const [rowCategoryChoices, setRowCategoryChoices] = useState({});
  const [rowApplyStatus, setRowApplyStatus] = useState({});
  const [rowApplyMessages, setRowApplyMessages] = useState({});
  const requestInFlight = useRef(false);

  const applyRowCategory = (eventId, category) => {
    setRowApplyStatus((prev) => ({ ...prev, [eventId]: "applying" }));
    setRowApplyMessages((prev) => ({ ...prev, [eventId]: "" }));
    return fetch("/api/financial/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planItems: [{ kind: "categorize", eventId, category }],
        confirmation: "SINGLE",
      }),
    })
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.error || "Unable to apply the category.");
        setRowApplyStatus((prev) => ({ ...prev, [eventId]: "done" }));
        setRowCategoryChoices((prev) => {
          const next = { ...prev };
          delete next[eventId];
          return next;
        });
        load();
        return null;
      })
      .catch((applyError) => {
        setRowApplyStatus((prev) => ({ ...prev, [eventId]: "error" }));
        setRowApplyMessages((prev) => ({
          ...prev,
          [eventId]: applyError instanceof Error ? applyError.message : "Unable to apply the category.",
        }));
      });
  };

  const load = useCallback(() => {
    if (requestInFlight.current) return undefined;
    requestInFlight.current = true;
    setStatus("loading");
    setErrorMessage("");
    setRowCategoryChoices({});
    return fetch("/api/financial/reconcile-transfers")
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (response.status === 503 && payload.code === "transfer_classification_schema_unavailable") {
          setStatus("schema-unavailable");
          return null;
        }
        if (!response.ok) throw new Error(payload.error || "Unable to check for transfer/distribution classification.");
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

  const totalItems =
    (preview?.directionFixes.length ?? 0) +
    (preview?.internalTransfers.length ?? 0) +
    (preview?.distributions.length ?? 0) +
    (preview?.debtPayments.length ?? 0);
  // Gate decision, one shared rule (see actionGate.js): this bulk apply covers
  // auto-paired transfers, distributions, and debt payments -- ambiguous
  // inference through debt/transfer pairing logic, the exact shape that
  // corrupted the books in the HELOC sign incident. The shared rule keeps the
  // typed-CONFIRM gate here. (The per-row suggestion path above is already
  // one-click: the human picks the exact row and category, and the write is
  // reversible through the conversational-actions API.)
  const bulkGate = resolveActionGate({ ambiguous: true, touchesDebtOrTransfer: true });
  const canApply =
    bulkGate === ACTION_GATE.TYPED
      ? acknowledged && confirmationText.trim().toUpperCase() === "CONFIRM" && totalItems > 0
      : totalItems > 0;

  const applyReconciliation = () => {
    setApplyStatus("applying");
    setApplyMessage("");
    fetch("/api/financial/reconcile-transfers", { method: "POST" })
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.error || "Unable to apply the reclassification.");
        setApplyStatus("done");
        setApplyMessage(
          payload.failedCount > 0
            ? `Reclassified ${payload.appliedCount} event(s); ${payload.failedCount} could not be applied.`
            : `Reclassified ${payload.appliedCount} event(s). Nothing was deleted -- amounts and dates are unchanged, only how they're counted.`,
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
          Checking for misclassified transfers…
        </p>
      </section>
    );
  }

  if (status === "schema-unavailable") {
    return null;
  }

  if (status === "error") {
    return (
      <section className="rounded-3xl border border-red-200 bg-red-50 p-6 dark:border-red-900/60 dark:bg-red-950/30">
        <p role="alert" className="text-sm font-bold text-red-800 dark:text-red-300">
          {errorMessage || "Something went wrong checking for transfer/distribution classification."}
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

  const directionFixes = preview?.directionFixes ?? [];
  const internalTransfers = preview?.internalTransfers ?? [];
  const distributions = preview?.distributions ?? [];
  const debtPayments = preview?.debtPayments ?? [];
  const ambiguousTransfers = preview?.ambiguousTransfers ?? [];

  return (
    <section
      data-guided-workflow-panel
      aria-label="Transfer and distribution classification"
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900"
    >
      <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Books</p>
      <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Transfers &amp; distributions</h2>
      <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
        The raw bank feed can mis-sign a real deposit as a negative expense, and can&rsquo;t tell a transfer between
        your own accounts from real income or a real expense. This finds both by matching amount, date, and
        which account each side belongs to — only ever flags exact, unambiguous matches.
      </p>

      {totalItems === 0 && ambiguousTransfers.length === 0 ? (
        <p className="mt-6 text-sm font-bold text-emerald-700 dark:text-emerald-400">Nothing to reclassify right now.</p>
      ) : (
        <>
          <dl className="mt-6 grid grid-cols-2 gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:grid-cols-3 lg:grid-cols-5 dark:border-slate-700 dark:bg-slate-950/40">
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Direction fixes</dt>
              <dd className="mt-1 text-xl font-black text-slate-950 dark:text-white">{directionFixes.length}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Internal transfers</dt>
              <dd className="mt-1 text-xl font-black text-slate-950 dark:text-white">{internalTransfers.length}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Debt payments</dt>
              <dd className="mt-1 text-xl font-black text-slate-950 dark:text-white">
                {debtPayments.length}
                <span className="ml-1 text-sm font-bold text-slate-500 dark:text-slate-400">({centsToMoney(preview.totalDebtPaymentAmountCents)})</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Owner distributions</dt>
              <dd className="mt-1 text-xl font-black text-slate-950 dark:text-white">
                {distributions.length}
                <span className="ml-1 text-sm font-bold text-slate-500 dark:text-slate-400">({centsToMoney(preview.totalDistributionAmountCents)})</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Needs manual review</dt>
              <dd className="mt-1 text-xl font-black text-amber-700 dark:text-amber-400">{ambiguousTransfers.length}</dd>
            </div>
          </dl>

          {directionFixes.length > 0 ? (
            <div className="mt-6">
              <h3 className="text-sm font-black uppercase tracking-wide text-slate-700 dark:text-slate-300">
                Direction fixes ({centsToMoney(preview.totalDirectionFixAmountCents)})
              </h3>
              <div className="mt-2 max-h-72 overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700">
                <table className="w-full min-w-[520px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-700 dark:bg-slate-950/40">
                      <th scope="col" className="px-3 py-2 font-bold text-slate-600 dark:text-slate-300">Date</th>
                      <th scope="col" className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-300">Amount</th>
                      <th scope="col" className="px-3 py-2 font-bold text-slate-600 dark:text-slate-300">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {directionFixes.map((entry) => (
                      <tr key={entry.eventId}>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{entry.eventDate}</td>
                        <td className="px-3 py-2 text-right font-bold text-slate-950 dark:text-white">{dollars(entry.amount)}</td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{entry.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {debtPayments.length > 0 ? (
            <div className="mt-6">
              <h3 className="text-sm font-black uppercase tracking-wide text-slate-700 dark:text-slate-300">
                Debt payments ({centsToMoney(preview.totalDebtPaymentAmountCents)})
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                A transfer into one of your loan/credit accounts is real debt service, not a no-op shuffle — this
                becomes a real expense category (e.g. a HELOC or mortgage payment) instead of being excluded.
              </p>
              <div className="mt-2 max-h-72 overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-700 dark:bg-slate-950/40">
                      <th scope="col" className="px-3 py-2 font-bold text-slate-600 dark:text-slate-300">Date</th>
                      <th scope="col" className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-300">Amount</th>
                      <th scope="col" className="px-3 py-2 font-bold text-slate-600 dark:text-slate-300">Paid from</th>
                      <th scope="col" className="px-3 py-2 font-bold text-slate-600 dark:text-slate-300">Paid into</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {debtPayments.map((pair) => (
                      <tr key={pair.inbound.eventId}>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{pair.outbound.eventDate}</td>
                        <td className="px-3 py-2 text-right font-bold text-slate-950 dark:text-white">{dollars(pair.outbound.amount)}</td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{pair.outbound.description}</td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{pair.loanAccountName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {distributions.length > 0 ? (
            <div className="mt-6">
              <h3 className="text-sm font-black uppercase tracking-wide text-slate-700 dark:text-slate-300">Owner distributions</h3>
              <div className="mt-2 max-h-72 overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-700 dark:bg-slate-950/40">
                      <th scope="col" className="px-3 py-2 font-bold text-slate-600 dark:text-slate-300">Date</th>
                      <th scope="col" className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-300">Amount</th>
                      <th scope="col" className="px-3 py-2 font-bold text-slate-600 dark:text-slate-300">Sent from</th>
                      <th scope="col" className="px-3 py-2 font-bold text-slate-600 dark:text-slate-300">Received into</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {distributions.map((pair) => (
                      <tr key={pair.inbound.eventId}>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{pair.inbound.eventDate}</td>
                        <td className="px-3 py-2 text-right font-bold text-slate-950 dark:text-white">{dollars(pair.inbound.amount)}</td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{pair.outbound.description}</td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{pair.inbound.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {internalTransfers.length > 0 ? (
            <div className="mt-6">
              <h3 className="text-sm font-black uppercase tracking-wide text-slate-700 dark:text-slate-300">Internal transfers (excluded from totals)</h3>
              <div className="mt-2 max-h-72 overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700">
                <table className="w-full min-w-[520px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-700 dark:bg-slate-950/40">
                      <th scope="col" className="px-3 py-2 font-bold text-slate-600 dark:text-slate-300">Date</th>
                      <th scope="col" className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-300">Amount</th>
                      <th scope="col" className="px-3 py-2 font-bold text-slate-600 dark:text-slate-300">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {internalTransfers.map((pair) => (
                      <tr key={pair.inbound.eventId}>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{pair.inbound.eventDate}</td>
                        <td className="px-3 py-2 text-right font-bold text-slate-950 dark:text-white">{dollars(pair.inbound.amount)}</td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{pair.inbound.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {ambiguousTransfers.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {ambiguousTransfers.length} transfer-looking transaction(s) had zero, more than one, or a contended
                match on the other side and were left alone — not enough certainty to reclassify automatically.
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                The Brain suggests a category per row from your own history — advisory only, never auto-applied.
                Tap a suggestion to fill the row&apos;s category picker, then Apply to write it (single click —
                you picked the exact row, and the write is reversible).
              </p>
              <ul className="mt-3 space-y-3">
                {ambiguousTransfers.map((entry) => {
                  const suggestion = entry.suggestion ?? null;
                  const highConfidence = (suggestion?.confidence ?? 0) >= 0.5;
                  const choice = rowCategoryChoices[entry.eventId] ?? "";
                  return (
                    <li
                      key={entry.eventId}
                      className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-800/60 dark:bg-amber-950/20"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{entry.eventDate}</span>
                        <span className="text-sm font-black text-slate-950 dark:text-white">{entry.description}</span>
                        <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{money.format(entry.amount)}</span>
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {entry.side}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Left alone because: {prettyCategory(entry.reason) || "uncertain match"}.
                      </p>
                      {suggestion ? (
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={() =>
                              setRowCategoryChoices((prev) => ({ ...prev, [entry.eventId]: suggestion.category }))
                            }
                            title={suggestion.reasons.join(" · ") || "Brain suggestion"}
                            className={`rounded-xl px-3 py-1.5 text-xs font-black transition ${FOCUS_RING} ${
                              highConfidence
                                ? "bg-amber-500 text-white hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500"
                                : "border border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40"
                            }`}
                          >
                            Use: {prettyCategory(suggestion.category)} ({Math.round(suggestion.confidence * 100)}%)
                          </button>
                          {suggestion.reasons.length > 0 ? (
                            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                              {suggestion.reasons.join(" · ")}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <p className="mt-2 text-[11px] italic text-slate-500 dark:text-slate-400">
                          No suggestion — not enough history for this one yet.
                        </p>
                      )}
                      <label className="mt-2 block max-w-xs text-xs font-bold text-slate-600 dark:text-slate-300">
                        Category (your call)
                        <select
                          value={choice}
                          onChange={(event) =>
                            setRowCategoryChoices((prev) => ({ ...prev, [entry.eventId]: event.target.value }))
                          }
                          className={`mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-950 dark:border-slate-600 dark:bg-slate-950 dark:text-white ${FOCUS_RING}`}
                        >
                          <option value="">Select category…</option>
                          {categoryOptionsFor(suggestion?.category).map((option) => (
                            <option key={option} value={option}>
                              {prettyCategory(option)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {choice ? (
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            disabled={rowApplyStatus[entry.eventId] === "applying"}
                            onClick={() => applyRowCategory(entry.eventId, choice)}
                            className={`rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-black text-white hover:bg-amber-600 disabled:opacity-50 dark:bg-amber-600 dark:hover:bg-amber-500 ${FOCUS_RING}`}
                          >
                            {rowApplyStatus[entry.eventId] === "applying"
                              ? "Applying…"
                              : `Apply: ${prettyCategory(choice)}`}
                          </button>
                          {rowApplyStatus[entry.eventId] === "error" ? (
                            <span className="text-xs text-red-600 dark:text-red-400">
                              {rowApplyMessages[entry.eventId]}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {totalItems > 0 ? (
            bulkGate === ACTION_GATE.TYPED ? (
              <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/30">
                <label className="flex gap-3 text-sm font-bold text-amber-950 dark:text-amber-200">
                  <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className={FOCUS_RING} />
                  I reviewed this list and understand it reclassifies these {totalItems} event(s) — direction fixes,
                  distributions, and loan/HELOC payments still count as income/expense (just correctly), internal
                  transfers are excluded entirely. Amounts and dates never change, nothing is deleted, and this is
                  fully reversible.
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
                  {applyStatus === "applying" ? "Applying…" : `Reclassify ${totalItems} event(s)`}
                </button>
              </div>
            ) : (
              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Reclassify these {totalItems} event(s). Amounts and dates never change, nothing is deleted, and
                  every change is reversible.
                </p>
                <button
                  type="button"
                  disabled={!canApply || applyStatus === "applying"}
                  onClick={applyReconciliation}
                  className={`mt-4 min-h-11 rounded-xl px-5 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40 ${goldControlClassName} ${FOCUS_RING}`}
                >
                  {applyStatus === "applying" ? "Applying…" : `Reclassify ${totalItems} event(s)`}
                </button>
              </div>
            )
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
