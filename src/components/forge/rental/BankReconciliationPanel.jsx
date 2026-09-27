"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildClearedSnapshot,
  parseStatementAmountToCents,
  reconcileStatement,
} from "@/domains/rental/bankReconciliation";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmt = (cents) => money.format((cents || 0) / 100);
const fmtDate = (value) => {
  if (!value) return "—";
  const d = new Date(String(value).length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
};
const amountOf = (e) => (e.creditCents ? e.creditCents : -e.debitCents);

// Default network layer; tests and previews inject their own.
export const defaultReconciliationApi = {
  async list(bankAccountId) {
    const res = await fetch(`/api/rental/bank-reconciliations?bankAccountId=${encodeURIComponent(bankAccountId)}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Unable to load reconciliations.");
    return { available: body.available !== false, reconciliations: body.reconciliations || [] };
  },
  async setCleared(eventId, cleared) {
    // Reuses the register's existing cleared-flag endpoint.
    const res = await fetch("/api/rental/financial-event", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: eventId, cleared }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Unable to update the transaction.");
  },
  async post(payload) {
    const res = await fetch("/api/rental/bank-reconciliations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Unable to save.");
    return body;
  },
};

/**
 * Human gate for any write to cleared states: a checkbox acknowledging what
 * is about to happen AND the word CONFIRM typed exactly.
 */
function ConfirmGate({ acknowledgement, actionLabel, busy, onConfirm, onCancel, danger = false, children }) {
  const [ack, setAck] = useState(false);
  const [typed, setTyped] = useState("");
  const ready = ack && typed === "CONFIRM" && !busy;
  return (
    <div role="group" aria-label={`${actionLabel} confirmation`} className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30">
      {children}
      <label className="flex items-start gap-2 text-sm text-slate-800 dark:text-slate-200">
        <input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} aria-label="Acknowledge" />
        <span>{acknowledgement}</span>
      </label>
      <label className="mt-2 block text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
        Type CONFIRM
        <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type CONFIRM" autoComplete="off"
          className="mt-1 block w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={!ready} onClick={onConfirm}
          className={`rounded-lg px-4 py-2 text-sm font-black text-white disabled:opacity-40 ${danger ? "bg-red-700 hover:bg-red-600" : "bg-emerald-700 hover:bg-emerald-600"}`}>
          {busy ? "Working…" : actionLabel}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-bold text-slate-800 dark:bg-slate-800 dark:text-slate-200">Cancel</button>
      </div>
    </div>
  );
}

function Figure({ label, value, tone }) {
  return (
    <div className="rounded-lg bg-white p-2 dark:bg-slate-900">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={`text-base font-black ${tone || "text-slate-900 dark:text-white"}`}>{value}</dd>
    </div>
  );
}

/** Per-period report for a saved reconciliation. */
export function ReconciliationReport({ rec, entries }) {
  const byId = new Map(entries.map((e) => [e.sourceId, e]));
  const list = (ids) => (ids || []).map((id) => byId.get(id)).filter(Boolean);
  const cleared = list(rec.cleared_event_ids);
  const outstanding = list(rec.outstanding_event_ids);
  const rows = (items) => (
    <ul className="mt-1 divide-y divide-slate-200 text-sm dark:divide-slate-700">
      {items.map((e) => (
        <li key={e.sourceId} className="flex justify-between gap-3 py-1">
          <span className="min-w-0 truncate">{fmtDate(e.date)} · {e.description}{e.checkNumber ? ` · #${e.checkNumber}` : ""}</span>
          <span className="shrink-0 font-bold">{fmt(amountOf(e))}</span>
        </li>
      ))}
      {items.length === 0 && <li className="py-1 text-slate-500">None</li>}
    </ul>
  );
  return (
    <article data-reconciliation-report className="mt-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <h5 className="text-base font-black text-slate-950 dark:text-white">
        Statement {fmtDate(rec.period_start)} – {fmtDate(rec.period_end)}
        {rec.status === "undone" && <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 text-xs dark:bg-slate-700">Undone</span>}
      </h5>
      <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Figure label="Statement balance" value={fmt(rec.statement_ending_balance_cents)} />
        <Figure label="Cleared balance" value={fmt(rec.cleared_balance_cents)} />
        <Figure label="Difference" value={fmt(rec.difference_cents)} tone={rec.difference_cents === 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"} />
        <Figure label="Book balance" value={fmt(rec.book_balance_cents)} />
      </dl>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Reconciled {fmtDate(rec.created_at)}{rec.status === "undone" ? ` · undone ${fmtDate(rec.undone_at)}${rec.undo_reason ? ` (${rec.undo_reason})` : ""}` : ""}
      </p>
      <h6 className="mt-3 text-sm font-black text-slate-800 dark:text-slate-200">Cleared on this statement ({cleared.length})</h6>
      {rows(cleared)}
      <h6 className="mt-3 text-sm font-black text-slate-800 dark:text-slate-200">
        Outstanding at statement end ({rec.outstanding_count}) — deposits {fmt(rec.outstanding_deposits_cents)}, payments {fmt(rec.outstanding_payments_cents)}
      </h6>
      {rows(outstanding)}
    </article>
  );
}

/**
 * Full bank reconciliation for one account: statement entry → mark items →
 * gated save; saved reconciliations with per-period reports and gated undo.
 * Math: src/domains/rental/bankReconciliation.js (pure). Writes: the
 * existing cleared-flag PATCH, then the reconciliation record (server
 * re-verifies and recomputes everything).
 */
export default function BankReconciliationPanel({ bankAccountId, entries = [], onChanged, api = defaultReconciliationApi }) {
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [balanceText, setBalanceText] = useState("");
  const [marks, setMarks] = useState({});
  const [gate, setGate] = useState(null); // null | "save" | { undo: rec }
  const [undoReason, setUndoReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [saved, setSaved] = useState({ loading: true, available: true, reconciliations: [] });
  const [openReport, setOpenReport] = useState(null);

  const reload = useCallback(async () => {
    try {
      const next = await api.list(bankAccountId);
      setSaved({ loading: false, ...next });
    } catch (e) {
      setSaved({ loading: false, available: true, reconciliations: [], error: e.message });
    }
  }, [api, bankAccountId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load this account's saved reconciliations when the panel opens or the account changes.
    reload();
  }, [reload]);

  const statementCents = parseStatementAmountToCents(balanceText);
  const result = useMemo(
    () => reconcileStatement({ entries, periodStart, periodEnd, statementEndingBalanceCents: statementCents, clearedOverrides: marks }),
    [entries, periodStart, periodEnd, statementCents, marks],
  );
  const latestActive = saved.reconciliations.find((r) => r.status === "active");

  const toggle = (e) => setMarks((m) => ({ ...m, [e.sourceId]: !(Object.prototype.hasOwnProperty.call(m, e.sourceId) ? m[e.sourceId] : e.cleared) }));

  const save = async () => {
    setBusy(true);
    setMessage(null);
    const snapshot = buildClearedSnapshot(entries, result.changes); // captured BEFORE any write
    const applied = [];
    try {
      for (const c of result.changes) {
        await api.setCleared(c.sourceId, c.to);
        applied.push(c);
      }
    } catch (e) {
      // Put back whatever already changed, then stop — nothing is recorded.
      for (const c of applied.reverse()) {
        try { await api.setCleared(c.sourceId, c.from); } catch { /* reported below */ }
      }
      setBusy(false);
      setMessage({ kind: "error", text: `Couldn't update every transaction (${e.message}). Changes were put back; nothing was saved.` });
      return;
    }
    try {
      const body = await api.post({ action: "save", confirm: "CONFIRM", bankAccountId, periodStart, periodEnd, statementEndingBalanceCents: statementCents, snapshot });
      setMessage({ kind: "ok", text: `Reconciled ${fmtDate(periodStart)} – ${fmtDate(periodEnd)}.` });
      setGate(null);
      setMarks({});
      setOpenReport(body.reconciliation?.id || null);
      await onChanged?.();
      await reload();
    } catch (e) {
      setMessage({ kind: "error", text: `${e.message} The cleared changes were applied; you can save again or undo them on the register.` });
    } finally {
      setBusy(false);
    }
  };

  const undo = async (rec) => {
    setBusy(true);
    setMessage(null);
    try {
      const body = await api.post({ action: "undo", confirm: "CONFIRM", id: rec.id, reason: undoReason });
      setMessage({ kind: "ok", text: `Undone. ${body.restored} transaction${body.restored === 1 ? "" : "s"} restored to how they were before.` });
      setGate(null);
      setUndoReason("");
      await onChanged?.();
      await reload();
    } catch (e) {
      setMessage({ kind: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const inputClass = "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white";

  return (
    <div data-bank-reconciliation className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5 dark:border-slate-700 dark:bg-slate-950/40">
      <h4 className="text-lg font-black text-slate-950 dark:text-white">Reconcile against a statement</h4>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Enter the statement period and ending balance, then check off the items that appear on the statement.</p>

      {!saved.available && (
        <p role="status" className="mt-3 rounded-lg bg-amber-100 p-3 text-sm font-bold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Saving reconciliations needs a database update that hasn&apos;t been applied yet. You can still work the numbers here.
        </p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="block text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          Statement start
          <input type="date" aria-label="Statement start" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          Statement end
          <input type="date" aria-label="Statement end" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          Ending balance (from statement)
          <input inputMode="decimal" aria-label="Statement ending balance" placeholder="e.g. 4,210.55" value={balanceText} onChange={(e) => setBalanceText(e.target.value)} className={inputClass} />
        </label>
      </div>

      {!result.ok && (periodStart || periodEnd || balanceText) && (
        <ul className="mt-2 text-sm text-amber-800 dark:text-amber-300">{result.problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}

      {result.ok && (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Reconciliation figures">
            <Figure label="Statement balance" value={fmt(result.statementEndingBalanceCents)} />
            <Figure label="Cleared balance" value={fmt(result.clearedBalanceCents)} />
            <Figure label="Difference" value={fmt(result.differenceCents)} tone={result.balanced ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"} />
            <Figure label="Book balance" value={fmt(result.bookBalanceCents)} />
          </dl>
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-400" data-proof>
            Outstanding: {result.outstandingCount} item{result.outstandingCount === 1 ? "" : "s"} — deposits in transit {fmt(result.outstandingDepositsCents)}, uncleared payments {fmt(result.outstandingPaymentsCents)}.
            {" "}Statement + deposits in transit − uncleared payments = <strong>{fmt(result.adjustedBankBalanceCents)}</strong>
            {result.balanced ? " (matches the book balance)" : ""}.
            {result.undatedCount > 0 && ` ${result.undatedCount} undated transaction(s) can't be placed in a period and aren't counted.`}
          </p>

          <h5 className="mt-4 text-sm font-black text-slate-800 dark:text-slate-200">Items to reconcile ({result.candidates.length})</h5>
          {/* Phone: stacked cards. */}
          <ul className="mt-2 space-y-2 sm:hidden" aria-label="Items to reconcile">
            {result.candidates.map((e) => (
              <li key={e.sourceId}>
                <label className="flex items-center gap-3 rounded-lg bg-white p-3 dark:bg-slate-900">
                  <input type="checkbox" checked={e.proposedCleared} onChange={() => toggle(e)} aria-label={`Cleared: ${e.description}`} className="h-5 w-5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-900 dark:text-white">{e.description}</span>
                    <span className="block text-xs text-slate-500">{fmtDate(e.date)}{e.checkNumber ? ` · #${e.checkNumber}` : ""}</span>
                  </span>
                  <span className={`shrink-0 text-sm font-black ${e.creditCents ? "text-emerald-700 dark:text-emerald-400" : "text-slate-900 dark:text-white"}`}>{fmt(amountOf(e))}</span>
                </label>
              </li>
            ))}
          </ul>
          {/* Wider screens: table. */}
          <div className="mt-2 hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700">
                  <th className="py-2">Cleared</th><th>Date</th><th>Description</th><th>Check #</th><th className="text-right">Payment</th><th className="text-right">Deposit</th>
                </tr>
              </thead>
              <tbody>
                {result.candidates.map((e) => (
                  <tr key={e.sourceId} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2"><input type="checkbox" checked={e.proposedCleared} onChange={() => toggle(e)} aria-label={`Cleared: ${e.description}`} /></td>
                    <td>{fmtDate(e.date)}</td><td>{e.description}</td><td>{e.checkNumber || "—"}</td>
                    <td className="text-right">{e.debitCents ? fmt(e.debitCents) : ""}</td>
                    <td className="text-right">{e.creditCents ? fmt(e.creditCents) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {gate !== "save" && (
            <button type="button" onClick={() => setGate("save")} disabled={!saved.available}
              className="mt-4 w-full rounded-lg bg-emerald-700 px-4 py-2 text-sm font-black text-white hover:bg-emerald-600 disabled:opacity-40 sm:w-auto">
              Save reconciliation{result.changes.length ? ` (${result.changes.length} change${result.changes.length === 1 ? "" : "s"})` : ""}
            </button>
          )}
          {gate === "save" && (
            <ConfirmGate
              actionLabel="Apply and save"
              busy={busy}
              onConfirm={save}
              onCancel={() => setGate(null)}
              acknowledgement={`I compared these items to my bank statement for ${fmtDate(periodStart)} – ${fmtDate(periodEnd)}. Mark ${result.changes.filter((c) => c.to).length} item(s) cleared and ${result.changes.filter((c) => !c.to).length} uncleared, and record this reconciliation${result.balanced ? "" : ` with a difference of ${fmt(result.differenceCents)}`}.`}
            >
              {!result.balanced && <p className="mb-2 text-sm font-bold text-red-700 dark:text-red-400">The statement doesn&apos;t balance yet (difference {fmt(result.differenceCents)}). Saving records that difference.</p>}
            </ConfirmGate>
          )}
        </>
      )}

      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`mt-3 text-sm font-bold ${message.kind === "error" ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>{message.text}</p>
      )}

      <h5 className="mt-6 text-sm font-black text-slate-800 dark:text-slate-200">Saved reconciliations</h5>
      {saved.error && <p role="alert" className="text-sm text-red-700">{saved.error}</p>}
      {!saved.loading && saved.reconciliations.length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
      <ul className="mt-2 space-y-2" aria-label="Saved reconciliations">
        {saved.reconciliations.map((rec) => (
          <li key={rec.id} className="rounded-lg bg-white p-3 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold text-slate-900 dark:text-white">
                {fmtDate(rec.period_start)} – {fmtDate(rec.period_end)} · {fmt(rec.statement_ending_balance_cents)}
                {rec.status === "undone" ? " · undone" : rec.difference_cents === 0 ? " · balanced" : ` · difference ${fmt(rec.difference_cents)}`}
              </span>
              <span className="flex gap-2">
                <button type="button" className="text-sm font-bold text-emerald-700 underline dark:text-emerald-400" onClick={() => setOpenReport(openReport === rec.id ? null : rec.id)}>
                  {openReport === rec.id ? "Hide report" : "View report"}
                </button>
                {latestActive?.id === rec.id && (
                  <button type="button" className="text-sm font-bold text-red-700 underline dark:text-red-400" onClick={() => setGate({ undo: rec })}>Undo</button>
                )}
              </span>
            </div>
            {openReport === rec.id && <ReconciliationReport rec={rec} entries={entries} />}
            {gate?.undo?.id === rec.id && (
              <ConfirmGate
                danger
                actionLabel="Undo reconciliation"
                busy={busy}
                onConfirm={() => undo(rec)}
                onCancel={() => setGate(null)}
                acknowledgement={`Undo this reconciliation and put ${(rec.cleared_snapshot || []).length} transaction(s) back to their cleared state from before it. The record is kept, marked undone.`}
              >
                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                  Reason (optional)
                  <input value={undoReason} onChange={(e) => setUndoReason(e.target.value)} aria-label="Undo reason" className={inputClass} />
                </label>
              </ConfirmGate>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
