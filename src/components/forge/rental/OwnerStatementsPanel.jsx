"use client";

import { useCallback, useEffect, useState } from "react";

// Owner statements, disbursements, and contributions (Rentec-parity R9).
//
// R8 integration: R8's RentalOwnersHomePanel reserves a
// [data-owner-statements-mount] mount point for exactly this panel — once both
// slices land, that panel renders <OwnerStatementsPanel /> inside the mount
// div. Until then, this panel also stands on its own behind the "Owner
// Statements" nav entry in the Reports section, so the slice is fully usable
// and testable without R8.
//
// No owner portal login in this slice: the statement is for the owner-operator
// to view, print, or email.

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const cents = (value) => money.format((Number(value) || 0) / 100);
const balanceClass = (value) =>
  Number(value) < 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400";

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const currentMonth = () => todayIso().slice(0, 7);
const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
};
const methodLabel = (method) => String(method || "check").replaceAll("_", " ");

const METHODS = ["check", "ach", "wire", "cash", "other"];

async function fetchMovements() {
  const response = await fetch("/api/rental/owner-movements");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load owner movements.");
  return body;
}

async function fetchStatement(month, propertyId) {
  const query = new URLSearchParams({ month });
  if (propertyId) query.set("propertyId", propertyId);
  const response = await fetch(`/api/rental/owner-statement?${query.toString()}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to build the owner statement.");
  return body.statement;
}

async function recordMovement(payload) {
  const response = await fetch("/api/rental/owner-movements", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to record the movement.");
  return body.movement;
}

async function voidMovement(id) {
  const response = await fetch("/api/rental/owner-movements", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to void the movement.");
  return body.movement;
}

// Statement mailto: no server-side email in this slice (real outbound email
// needs Jason's word), so the email action opens the owner's mail client with
// a pre-filled statement summary.
function statementEmailBody(statement) {
  const lines = [
    `Owner statement — ${statement.periodStart} to ${statement.periodEnd}`,
    "",
    `Beginning balance due: ${cents(statement.beginningBalanceCents)}`,
    `Income collected: ${cents(statement.periodIncomeCents)}`,
    `Expenses paid: ${cents(statement.periodExpenseCents)}`,
    `Disbursements to owner: ${cents(statement.periodDisbursementCents)}`,
    `Owner contributions: ${cents(statement.periodContributionCents)}`,
    `Ending balance due to owner: ${cents(statement.endingBalanceCents)}`,
    "",
    "Full detail is on the printed statement.",
  ];
  return lines.join("\n");
}

function MovementForm({ kind, balanceCents, onSaved, onCancel }) {
  const [amount, setAmount] = useState("");
  const [movementDate, setMovementDate] = useState(todayIso());
  const [method, setMethod] = useState("check");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const isDisbursement = kind === "disbursement";

  const submit = async (event) => {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await recordMovement({
        kind,
        amount: Number(amount),
        movementDate,
        method,
        memo: memo.trim(),
      });
      onSaved();
    } catch (error) {
      setFormError(error.message);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60 print:hidden">
      <h4 className="text-sm font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
        Record {isDisbursement ? "disbursement" : "contribution"}
      </h4>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Amount (USD)</span>
          <input
            type="number" min="0.01" step="0.01" required value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-950 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            placeholder="0.00"
          />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Date</span>
          <input
            type="date" required value={movementDate}
            onChange={(event) => setMovementDate(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-950 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Method</span>
          <select
            value={method} onChange={(event) => setMethod(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-950 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          >
            {METHODS.map((option) => (
              <option key={option} value={option}>{methodLabel(option)}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Memo</span>
          <input
            type="text" value={memo} maxLength={500}
            onChange={(event) => setMemo(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-950 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            placeholder={isDisbursement ? "Owner draw — September" : "Covering repairs"}
          />
        </label>
      </div>
      {isDisbursement && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Available: <span className={balanceClass(balanceCents)}>{cents(balanceCents)}</span> — a disbursement cannot exceed it.
        </p>
      )}
      {!isDisbursement && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          A contribution is an equity movement, never income — it will not appear on income reports.
        </p>
      )}
      {formError && <p role="alert" className="mt-2 text-sm font-bold text-red-700 dark:text-red-400">{formError}</p>}
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={saving} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {saving ? "Saving…" : `Save ${isDisbursement ? "disbursement" : "contribution"}`}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 dark:border-slate-600 dark:text-slate-200">
          Cancel
        </button>
      </div>
    </form>
  );
}

function MovementHistory({ movements, kind, onVoided }) {
  const rows = movements.filter((row) => row.kind === kind);
  const [voidingId, setVoidingId] = useState(null);
  const [voidError, setVoidError] = useState(null);

  const confirmVoid = async (row) => {
    setVoidError(null);
    setVoidingId(row.id);
    try {
      await voidMovement(row.id);
      onVoided();
    } catch (error) {
      setVoidError(error.message);
    } finally {
      setVoidingId(null);
    }
  };

  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">No {kind === "disbursement" ? "disbursements" : "contributions"} recorded yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-widest text-slate-500 dark:text-slate-400">
            <th className="px-2 py-2">Date</th>
            <th className="px-2 py-2">Memo</th>
            <th className="px-2 py-2">Method</th>
            <th className="px-2 py-2 text-right">Amount</th>
            <th className="px-2 py-2">Status</th>
            <th className="px-2 py-2 print:hidden"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-slate-200 dark:border-slate-700">
              <td className="px-2 py-2 whitespace-nowrap">{formatDate(row.movementDate)}</td>
              <td className="px-2 py-2">{row.memo || "—"}</td>
              <td className="px-2 py-2 capitalize">{methodLabel(row.method)}</td>
              <td className="px-2 py-2 text-right font-bold">{cents(row.amount * 100)}</td>
              <td className="px-2 py-2">
                <span className={row.status === "voided" ? "font-bold text-slate-400 line-through" : "font-bold text-emerald-700 dark:text-emerald-400"}>
                  {row.status === "voided" ? "Voided" : "Active"}
                </span>
              </td>
              <td className="px-2 py-2 print:hidden">
                {row.status === "active" && (
                  <button
                    type="button"
                    disabled={voidingId === row.id}
                    onClick={() => confirmVoid(row)}
                    className="rounded-lg border border-red-300 px-3 py-1 text-xs font-bold text-red-700 disabled:opacity-50 dark:border-red-800 dark:text-red-400"
                  >
                    {voidingId === row.id ? "Voiding…" : "Void"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {voidError && <p role="alert" className="mt-2 text-sm font-bold text-red-700 dark:text-red-400">{voidError}</p>}
    </div>
  );
}

function StatementSection({ title, lines, totalCents, negative = false }) {
  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">{title}</h3>
        <p className={`text-base font-black ${negative ? "text-red-700 dark:text-red-400" : ""}`}>
          {negative ? "−" : ""}{cents(totalCents)}
        </p>
      </div>
      {lines.length === 0 ? (
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">None this period.</p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-t border-slate-200 dark:border-slate-700 print:border-slate-300">
                <td className="py-1.5 pr-2 whitespace-nowrap">{formatDate(line.date)}</td>
                <td className="py-1.5 pr-2">{line.description}</td>
                <td className="py-1.5 pr-2 text-slate-500 dark:text-slate-400">{line.category || methodLabel(line.method)}</td>
                <td className="py-1.5 text-right font-bold">{cents(line.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function OwnerStatementsPanel() {
  const [month, setMonth] = useState(currentMonth());
  const [tab, setTab] = useState("statement");
  const [movements, setMovements] = useState([]);
  const [balance, setBalance] = useState(null);
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [movementData, statementData] = await Promise.all([
        fetchMovements(),
        fetchStatement(month, ""),
      ]);
      setMovements(movementData.movements || []);
      setBalance(movementData.balance || null);
      setStatement(statementData);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load this owner's movements and statement when the panel opens or the month changes.
    reload();
  }, [reload]);

  const mailto = statement
    ? `mailto:?subject=${encodeURIComponent(`Owner statement — ${statement.periodStart} to ${statement.periodEnd}`)}&body=${encodeURIComponent(statementEmailBody(statement))}`
    : null;

  return (
    <section data-owner-statements-panel className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h2 className="text-xl font-black text-slate-950 dark:text-white">Owner statements</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Running balance due to the owner, disbursements, and owner contributions.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
          Statement month
          <input
            type="month" value={month} onChange={(event) => setMonth(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white p-2 text-slate-950 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {/* Balance due card */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h3 className="text-sm font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Balance due to owner</h3>
        {loading && !balance ? (
          <p className="mt-2 text-sm text-slate-500">Loading…</p>
        ) : balance ? (
          <>
            <p className={`mt-1 text-4xl font-black ${balanceClass(balance.balanceCents)}`}>{cents(balance.balanceCents)}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-slate-500 dark:text-slate-400">Income collected</dt><dd className="font-bold">{cents(balance.incomeCents)}</dd></div>
              <div><dt className="text-xs text-slate-500 dark:text-slate-400">Expenses paid</dt><dd className="font-bold">{cents(balance.expenseCents)}</dd></div>
              <div><dt className="text-xs text-slate-500 dark:text-slate-400">Disbursements</dt><dd className="font-bold">{cents(balance.disbursementCents)}</dd></div>
              <div><dt className="text-xs text-slate-500 dark:text-slate-400">Contributions</dt><dd className="font-bold">{cents(balance.contributionCents)}</dd></div>
            </dl>
          </>
        ) : null}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 print:hidden" role="tablist" aria-label="Owner statement views">
        {[
          ["statement", "Statement"],
          ["disbursements", "Disbursements"],
          ["contributions", "Contributions"],
        ].map(([id, label]) => (
          <button
            key={id} type="button" role="tab" aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`rounded-xl px-4 py-2 text-sm font-black ${tab === id ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950" : "border border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-200"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "statement" && statement && (
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900 print:border-0 print:shadow-none print:p-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold uppercase tracking-widest text-amber-700">FORGE owner statement</p>
              <h3 className="mt-1 text-2xl font-black text-slate-950 dark:text-white">
                {formatDate(statement.periodStart)} – {formatDate(statement.periodEnd)}
              </h3>
            </div>
            <div className="flex gap-2 print:hidden">
              <button type="button" onClick={() => window.print()} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white dark:bg-white dark:text-slate-950">
                Print or save as PDF
              </button>
              <a href={mailto} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 dark:border-slate-600 dark:text-slate-200">
                Email
              </a>
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4 text-sm dark:bg-slate-800/60 print:bg-transparent print:p-0">
            <div><dt className="text-xs text-slate-500 dark:text-slate-400">Beginning balance due</dt><dd className={`font-black ${balanceClass(statement.beginningBalanceCents)}`}>{cents(statement.beginningBalanceCents)}</dd></div>
            <div><dt className="text-xs text-slate-500 dark:text-slate-400">Ending balance due</dt><dd className={`font-black ${balanceClass(statement.endingBalanceCents)}`}>{cents(statement.endingBalanceCents)}</dd></div>
          </dl>

          <StatementSection title="Income collected" lines={statement.incomeLines} totalCents={statement.periodIncomeCents} />
          <StatementSection title="Expenses paid" lines={statement.expenseLines} totalCents={statement.periodExpenseCents} negative />
          <StatementSection title="Disbursements to owner" lines={statement.disbursementLines} totalCents={statement.periodDisbursementCents} negative />
          <section className="mt-6">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Owner contributions (not income)</h3>
              <p className="text-base font-black">{cents(statement.periodContributionCents)}</p>
            </div>
            {statement.contributionLines.length === 0 ? (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">None this period.</p>
            ) : (
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {statement.contributionLines.map((line) => (
                    <tr key={line.id} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="py-1.5 pr-2 whitespace-nowrap">{formatDate(line.date)}</td>
                      <td className="py-1.5 pr-2">{line.description}</td>
                      <td className="py-1.5 pr-2 text-slate-500 dark:text-slate-400">{methodLabel(line.method)}</td>
                      <td className="py-1.5 text-right font-bold">{cents(line.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {statement.runningBalance.length > 0 && (
            <section className="mt-6">
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Running balance through the period</h3>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {statement.runningBalance.map((row, index) => (
                    <tr key={`${row.date}-${index}`} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="py-1.5 pr-2 whitespace-nowrap">{formatDate(row.date)}</td>
                      <td className="py-1.5 pr-2">{row.description}</td>
                      <td className={`py-1.5 pr-2 text-right font-bold ${row.amountCents < 0 ? "text-red-700 dark:text-red-400" : ""}`}>
                        {row.amountCents < 0 ? "−" : "+"}{cents(Math.abs(row.amountCents))}
                      </td>
                      <td className={`py-1.5 text-right font-black ${balanceClass(row.balanceCents)}`}>{cents(row.balanceCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </article>
      )}

      {tab !== "statement" && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-4 flex items-center justify-between print:hidden">
            <h3 className="text-lg font-black text-slate-950 dark:text-white">
              {tab === "disbursements" ? "Disbursements" : "Contributions"}
            </h3>
            {!showForm && (
              <button
                type="button"
                onClick={() => setShowForm(tab)}
                className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white dark:bg-white dark:text-slate-950"
              >
                Record {tab === "disbursements" ? "disbursement" : "contribution"}
              </button>
            )}
          </div>
          {showForm === tab && (
            <div className="mb-4">
              <MovementForm
                kind={tab === "disbursements" ? "disbursement" : "contribution"}
                balanceCents={balance?.balanceCents ?? 0}
                onSaved={() => { setShowForm(null); reload(); }}
                onCancel={() => setShowForm(null)}
              />
            </div>
          )}
          <MovementHistory
            movements={movements}
            kind={tab === "disbursements" ? "disbursement" : "contribution"}
            onVoided={reload}
          />
        </div>
      )}
    </section>
  );
}
