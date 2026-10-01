"use client";
import { useCallback, useEffect, useState } from "react";
import CheckPrintView from "./CheckPrintView";
import DepositSlipPrintView from "./DepositSlipPrintView";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const formatCents = (cents) => money.format(Number(cents || 0) / 100);
const formatDate = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${m}/${d}/${y}` : String(iso);
};

const TENDERS = [
  { id: "cash", label: "Cash" },
  { id: "check", label: "Check" },
  { id: "money_order", label: "Money order" },
  { id: "other", label: "Other" },
];

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The request failed.");
  return body;
}

function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-6 print:static print:bg-white print:p-0" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 shadow-xl sm:rounded-3xl print:max-h-none print:overflow-visible print:rounded-none print:p-0 print:shadow-none ${wide ? "sm:max-w-4xl" : "sm:max-w-xl"}`}>
        <div className="mb-4 flex items-start justify-between gap-3 print:hidden">
          <h3 className="text-xl font-black text-slate-950">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-black text-slate-600 hover:bg-slate-100">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ErrorBanner({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
      <p>{message}</p>
      <button type="button" onClick={onDismiss} className="font-black" aria-label="Dismiss">✕</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Print checks — batch recorded check payments into one print run.
// ---------------------------------------------------------------------------
function PrintChecksTab({ accounts, accountName }) {
  const [payments, setPayments] = useState([]);
  const [paymentsAvailable, setPaymentsAvailable] = useState(true);
  const [accountId, setAccountId] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [runs, setRuns] = useState([]);
  const [printRun, setPrintRun] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const paymentsRes = await fetch("/api/rental/vendor-payments?status=active");
      if (paymentsRes.status === 404) {
        setPaymentsAvailable(false);
      } else {
        const body = await readJson(paymentsRes);
        setPayments((body.payments || []).filter((p) => p.paymentMethod === "check"));
        setPaymentsAvailable(true);
      }
    } catch (err) {
      setPaymentsAvailable(false);
    }
    try {
      const runsBody = await readJson(await fetch("/api/rental/check-runs"));
      setRuns(runsBody.runs || []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  const eligible = payments.filter((p) => !accountId || p.bankAccountId === accountId);
  const selectedTotal = eligible.filter((p) => selected.has(p.id)).reduce((s, p) => s + p.amountCents, 0);

  async function createRun() {
    if (selected.size === 0 || !accountId) return;
    setBusy(true);
    setError("");
    try {
      const body = await readJson(await fetch("/api/rental/check-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runDate: new Date().toISOString().slice(0, 10), bankAccountId: accountId, paymentIds: [...selected] }),
      }));
      setSelected(new Set());
      await load();
      openPrint(body.run.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function openPrint(runId) {
    setError("");
    try {
      const body = await readJson(await fetch(`/api/rental/check-runs/${encodeURIComponent(runId)}`));
      setPrintRun(body.run);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <ErrorBanner message={error} onDismiss={() => setError("")} />
      {!paymentsAvailable ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">
          Check printing needs recorded check payments first. Record a vendor payment with method “check” (Pay bills), then come back to print it.
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-bold text-slate-600">Drawn on account</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="rounded-lg border px-3 py-2">
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.official_name || a.name}</option>)}
              </select>
            </label>
            <button
              type="button" disabled={busy || selected.size === 0}
              onClick={createRun}
              className="rounded-lg bg-slate-950 px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? "Creating…" : `Print ${selected.size} check${selected.size === 1 ? "" : "s"} (${formatCents(selectedTotal)})`}
            </button>
          </div>

          {eligible.length === 0 ? (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">
              No unprinted check payments on this account.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-2"><span className="sr-only">Select</span></th>
                  <th className="py-2 pr-2">Check #</th>
                  <th className="py-2 pr-2">Payee</th>
                  <th className="py-2 pr-2">Date</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {eligible.map((p) => (
                  <tr key={p.id} className="border-t border-slate-200">
                    <td className="py-2 pr-2">
                      <input
                        type="checkbox" aria-label={`Select check ${p.checkNumber}`}
                        checked={selected.has(p.id)}
                        onChange={(e) => setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(p.id); else next.delete(p.id);
                          return next;
                        })}
                      />
                    </td>
                    <td className="py-2 pr-2 font-mono">{p.checkNumber}</td>
                    <td className="py-2 pr-2 font-bold">{p.vendorName || "—"}</td>
                    <td className="py-2 pr-2">{formatDate(p.paymentDate)}</td>
                    <td className="py-2 text-right font-mono">{formatCents(p.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <h4 className="mb-2 mt-8 text-sm font-black uppercase tracking-widest text-slate-500">Check run history</h4>
      {runs.length === 0 ? (
        <p className="text-sm text-slate-500">No check runs yet.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-t border-slate-200">
                <td className="py-2 pr-2">{formatDate(run.runDate)}</td>
                <td className="py-2 pr-2">{run.checkCount} check{run.checkCount === 1 ? "" : "s"}</td>
                <td className="py-2 pr-2 text-right font-mono">{formatCents(run.totalAmountCents)}</td>
                <td className="py-2 text-right">
                  <button type="button" onClick={() => openPrint(run.id)} className="rounded-lg border px-3 py-1 text-xs font-bold">
                    Reprint
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {printRun && (
        <Modal title="Print checks" wide onClose={() => setPrintRun(null)}>
          <CheckPrintView run={printRun} bankAccountName={accountName(printRun.bankAccountId)} onClose={() => setPrintRun(null)} />
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bank deposits — batch received payments into one deposit slip.
// ---------------------------------------------------------------------------
function BankDepositsTab({ accounts, accountName, onChanged }) {
  const [receipts, setReceipts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [selected, setSelected] = useState({}); // eventId -> { tender, checkNumber, receivedFrom }
  const [deposits, setDeposits] = useState([]);
  const [printDeposit, setPrintDeposit] = useState(null);
  const [voidTarget, setVoidTarget] = useState(null);
  const [voidReason, setVoidReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const [receiptsBody, depositsBody] = await Promise.all([
        readJson(await fetch("/api/rental/bank-deposits?undeposited=true")),
        readJson(await fetch("/api/rental/bank-deposits")),
      ]);
      setReceipts(receiptsBody.receipts || []);
      setDeposits(depositsBody.deposits || []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  const selectedIds = Object.keys(selected);
  const selectedTotal = selectedIds.reduce((sum, id) => {
    const receipt = receipts.find((r) => r.eventId === id);
    return sum + (receipt ? receipt.amountCents : 0);
  }, 0);

  function toggleReceipt(receipt, checked) {
    setSelected((prev) => {
      const next = { ...prev };
      if (checked) {
        next[receipt.eventId] = {
          tender: receipt.checkNumber ? "check" : "cash",
          checkNumber: receipt.checkNumber || "",
          receivedFrom: receipt.payee || "",
        };
      } else {
        delete next[receipt.eventId];
      }
      return next;
    });
  }

  async function createDeposit() {
    if (selectedIds.length === 0 || !accountId) return;
    setBusy(true);
    setError("");
    try {
      const body = await readJson(await fetch("/api/rental/bank-deposits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          depositDate: new Date().toISOString().slice(0, 10),
          bankAccountId: accountId,
          items: selectedIds.map((eventId) => ({ eventId, ...selected[eventId] })),
        }),
      }));
      setSelected({});
      await load();
      onChanged?.();
      openSlip(body.deposit.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function openSlip(depositId) {
    setError("");
    try {
      const body = await readJson(await fetch(`/api/rental/bank-deposits/${encodeURIComponent(depositId)}`));
      setPrintDeposit(body.deposit);
    } catch (err) {
      setError(err.message);
    }
  }

  async function voidDeposit() {
    if (!voidTarget || !voidReason.trim()) return;
    setBusy(true);
    setError("");
    try {
      await readJson(await fetch(`/api/rental/bank-deposits/${encodeURIComponent(voidTarget.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "void", reason: voidReason.trim() }),
      }));
      setVoidTarget(null);
      setVoidReason("");
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <ErrorBanner message={error} onDismiss={() => setError("")} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-bold text-slate-600">Deposit to account</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="rounded-lg border px-3 py-2">
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.official_name || a.name}</option>)}
          </select>
        </label>
        <button
          type="button" disabled={busy || selectedIds.length === 0}
          onClick={createDeposit}
          className="rounded-lg bg-slate-950 px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? "Recording…" : `Record deposit (${formatCents(selectedTotal)})`}
        </button>
      </div>

      {receipts.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">
          Nothing to deposit — every received payment is already banked or on a deposit.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-2"><span className="sr-only">Select</span></th>
              <th className="py-2 pr-2">Date</th>
              <th className="py-2 pr-2">Received from</th>
              <th className="py-2 pr-2">Tender</th>
              <th className="py-2 pr-2">Check #</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((receipt) => {
              const line = selected[receipt.eventId];
              return (
                <tr key={receipt.eventId} className="border-t border-slate-200">
                  <td className="py-2 pr-2">
                    <input type="checkbox" aria-label={`Select receipt ${receipt.description}`}
                      checked={!!line} onChange={(e) => toggleReceipt(receipt, e.target.checked)} />
                  </td>
                  <td className="py-2 pr-2">{formatDate(receipt.eventDate)}</td>
                  <td className="py-2 pr-2">
                    {line ? (
                      <input value={line.receivedFrom} onChange={(e) => setSelected((prev) => ({ ...prev, [receipt.eventId]: { ...prev[receipt.eventId], receivedFrom: e.target.value } }))}
                        className="w-36 rounded border px-2 py-1" placeholder="Received from" />
                    ) : (
                      <span className="font-bold">{receipt.payee || receipt.description}</span>
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    {line ? (
                      <select value={line.tender}
                        onChange={(e) => setSelected((prev) => ({ ...prev, [receipt.eventId]: { ...prev[receipt.eventId], tender: e.target.value } }))}
                        className="rounded border px-2 py-1">
                        {TENDERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    {line?.tender === "check" ? (
                      <input value={line.checkNumber}
                        onChange={(e) => setSelected((prev) => ({ ...prev, [receipt.eventId]: { ...prev[receipt.eventId], checkNumber: e.target.value } }))}
                        className="w-24 rounded border px-2 py-1 font-mono" placeholder="#" />
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="py-2 text-right font-mono">{formatCents(receipt.amountCents)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h4 className="mb-2 mt-8 text-sm font-black uppercase tracking-widest text-slate-500">Deposit history</h4>
      {deposits.length === 0 ? (
        <p className="text-sm text-slate-500">No deposits yet.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {deposits.map((deposit) => (
              <tr key={deposit.id} className="border-t border-slate-200">
                <td className="py-2 pr-2">{formatDate(deposit.depositDate)}</td>
                <td className="py-2 pr-2">{deposit.itemCount} receipt{deposit.itemCount === 1 ? "" : "s"}</td>
                <td className="py-2 pr-2 text-right font-mono">{formatCents(deposit.totalAmountCents)}</td>
                <td className="py-2 pr-2">
                  {deposit.status === "voided"
                    ? <span className="font-bold uppercase text-red-700">Voided</span>
                    : <span className="text-slate-500">Active</span>}
                </td>
                <td className="py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => openSlip(deposit.id)} className="rounded-lg border px-3 py-1 text-xs font-bold">
                      Print slip
                    </button>
                    {deposit.status === "active" && (
                      <button type="button" onClick={() => setVoidTarget(deposit)} className="rounded-lg border border-red-300 px-3 py-1 text-xs font-bold text-red-700">
                        Void
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {printDeposit && (
        <Modal title="Bank deposit slip" wide onClose={() => setPrintDeposit(null)}>
          <DepositSlipPrintView deposit={printDeposit} bankAccountName={accountName(printDeposit.bankAccountId)} onClose={() => setPrintDeposit(null)} />
        </Modal>
      )}

      {voidTarget && (
        <Modal title="Void deposit" onClose={() => { setVoidTarget(null); setVoidReason(""); }}>
          <p className="text-sm text-slate-600">
            Voiding reverses the deposit of {formatCents(voidTarget.totalAmountCents)} on {formatDate(voidTarget.depositDate)}.
            The receipts return to undeposited. This cannot be undone.
          </p>
          <label className="mt-4 block text-sm">
            <span className="mb-1 block font-bold">Reason (required)</span>
            <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)}
              className="w-full rounded-lg border px-3 py-2" placeholder="Why is this deposit being voided?" />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => { setVoidTarget(null); setVoidReason(""); }} className="rounded-lg border px-4 py-2 text-sm font-bold">
              Cancel
            </button>
            <button type="button" disabled={busy || !voidReason.trim()} onClick={voidDeposit}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {busy ? "Voiding…" : "Void deposit"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Banking tools — check printing + bank deposits (Rentec parity R7).
// ---------------------------------------------------------------------------
export default function BankingToolsPanel() {
  const [tab, setTab] = useState("checks");
  const [accounts, setAccounts] = useState([]);
  const [loadError, setLoadError] = useState("");

  const loadAccounts = useCallback(async () => {
    try {
      const body = await readJson(await fetch("/api/rental/bank-accounts"));
      setAccounts(body.accounts || []);
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const accountName = useCallback(
    (id) => {
      const account = accounts.find((a) => a.id === id);
      return account ? account.official_name || account.name : id;
    },
    [accounts]
  );

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="mb-1 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-amber-700">Banking</p>
          <h2 className="mt-1 text-2xl font-black">Checks &amp; deposits</h2>
          <p className="mt-1 text-sm text-slate-500">
            Print recorded check payments and batch received payments into bank deposit slips.
          </p>
        </div>
      </div>

      <ErrorBanner message={loadError} onDismiss={() => setLoadError("")} />

      <div className="mb-6 flex gap-2 border-b border-slate-200">
        {[
          { id: "checks", label: "Print checks" },
          { id: "deposits", label: "Bank deposits" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-bold ${tab === t.id ? "border-slate-950 text-slate-950" : "border-transparent text-slate-500"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "checks" ? (
        <PrintChecksTab accounts={accounts} accountName={accountName} />
      ) : (
        <BankDepositsTab accounts={accounts} accountName={accountName} onChanged={loadAccounts} />
      )}
    </div>
  );
}
