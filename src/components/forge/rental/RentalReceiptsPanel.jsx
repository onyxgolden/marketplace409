"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";

// Receipts — the R26 receipt/invoice scanner surface (free layer).
// Tabs: Inbox (unmatched receipts + manual entry), Receipt detail (edit,
// suggested bill matches, one-click apply through the R4 pay flow, AI scan
// button that honestly reports "not connected"), Reconciliation assist
// (deterministic bank-row matching, unmatched items on both sides).

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const cents = (value) => money.format(Number(value || 0) / 100);

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

const TABS = [
  { id: "inbox", label: "Inbox" },
  { id: "assist", label: "Reconciliation assist" },
];

function ReceiptForm({ vendors, properties, onSaved, onCancel }) {
  const [vendorId, setVendorId] = useState("");
  const [vendorNameHint, setVendorNameHint] = useState("");
  const [propertyId, setPropertyId] = useState(properties[0]?.property_id || "");
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [tax, setTax] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const amountCents = Math.round(Number(amount) * 100);
  const taxCents = tax === "" ? 0 : Math.round(Number(tax) * 100);

  async function uploadReceiptFile() {
    if (!file) return null;
    const form = new FormData();
    form.set("file", file);
    form.set("propertyId", propertyId);
    form.set("title", `Receipt ${receiptDate}`);
    form.set("category", "receipt");
    form.set("documentDate", receiptDate);
    const body = await readJson(await fetch("/api/rental/documents", { method: "POST", body: form }));
    return body.document?.id || null;
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const documentId = await uploadReceiptFile();
      const body = await readJson(
        await fetch("/api/rental/receipts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            vendorId: vendorId || undefined,
            vendorNameHint: vendorId ? undefined : vendorNameHint,
            propertyId: propertyId || undefined,
            receiptDate,
            amountCents,
            taxCents,
            documentId: documentId || undefined,
            notes: notes || undefined,
          }),
        })
      );
      onSaved(body.receipt);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <h3 className="text-lg font-black text-slate-950 dark:text-white">New receipt</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Upload the image or PDF and type what it says. AI scan is not connected — entry is manual.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="block text-sm">
          <span className="font-bold text-slate-700 dark:text-slate-300">Receipt file (image/PDF, optional)</span>
          <input type="file" accept="image/*,application/pdf" onChange={(event) => setFile(event.target.files?.[0] || null)}
            className="mt-1 block w-full text-sm text-slate-600 dark:text-slate-400" />
        </label>
        <label className="block text-sm">
          <span className="font-bold text-slate-700 dark:text-slate-300">Vendor (known)</span>
          <select value={vendorId} onChange={(event) => setVendorId(event.target.value)}
            className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800">
            <option value="">— Unknown vendor —</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
            ))}
          </select>
        </label>
        {!vendorId ? (
          <label className="block text-sm">
            <span className="font-bold text-slate-700 dark:text-slate-300">Vendor name on the receipt</span>
            <input value={vendorNameHint} onChange={(event) => setVendorNameHint(event.target.value)}
              placeholder="e.g. Acme Plumbing"
              className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800" />
          </label>
        ) : null}
        <label className="block text-sm">
          <span className="font-bold text-slate-700 dark:text-slate-300">Property</span>
          <select value={propertyId} onChange={(event) => setPropertyId(event.target.value)}
            className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800">
            <option value="">— None —</option>
            {properties.map((unit) => (
              <option key={unit.property_id} value={unit.property_id}>{unit.property_id}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-bold text-slate-700 dark:text-slate-300">Receipt date</span>
          <input type="date" value={receiptDate} onChange={(event) => setReceiptDate(event.target.value)}
            className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800" />
        </label>
        <label className="block text-sm">
          <span className="font-bold text-slate-700 dark:text-slate-300">Total ($)</span>
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800" />
        </label>
        <label className="block text-sm">
          <span className="font-bold text-slate-700 dark:text-slate-300">Tax ($, optional)</span>
          <input inputMode="decimal" value={tax} onChange={(event) => setTax(event.target.value)}
            placeholder="0.00"
            className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800" />
        </label>
        <label className="block text-sm md:col-span-2">
          <span className="font-bold text-slate-700 dark:text-slate-300">Notes</span>
          <input value={notes} onChange={(event) => setNotes(event.target.value)}
            className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800" />
        </label>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm font-bold text-red-700 dark:text-red-400">{error}</p> : null}
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={save} disabled={saving}
          className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
          {saving ? "Saving…" : "Save receipt"}
        </button>
        <button type="button" onClick={onCancel}
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 dark:border-slate-600 dark:text-slate-300">
          Cancel
        </button>
      </div>
    </div>
  );
}

function ReceiptDetail({ receipt, vendors, bankAccounts, onChanged, onClose }) {
  const [matches, setMatches] = useState(null);
  const [matchesError, setMatchesError] = useState(null);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [applyFor, setApplyFor] = useState(null);
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id || "");
  const [paymentMethod, setPaymentMethod] = useState("ach");
  const [checkNumber, setCheckNumber] = useState("");
  const [applyError, setApplyError] = useState(null);
  const [applying, setApplying] = useState(false);
  const [scanMessage, setScanMessage] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [actionError, setActionError] = useState(null);

  const loadMatches = useCallback(async () => {
    const body = await readJson(await fetch(`/api/rental/receipts/${encodeURIComponent(receipt.id)}/matches`));
    return body.matches || [];
  }, [receipt.id]);

  useEffect(() => {
    let cancelled = false;
    loadMatches()
      .then((rows) => { if (!cancelled) { setMatches(rows); setMatchesLoading(false); } })
      .catch((matchError) => { if (!cancelled) { setMatchesError(matchError.message); setMatchesLoading(false); } });
    return () => { cancelled = true; };
  }, [loadMatches]);

  async function applyToBill(billId) {
    setApplyError(null);
    setApplying(true);
    try {
      const body = await readJson(
        await fetch(`/api/rental/receipts/${encodeURIComponent(receipt.id)}/apply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            billId,
            bankAccountId,
            paymentMethod,
            checkNumber: paymentMethod === "check" ? checkNumber : undefined,
          }),
        })
      );
      onChanged({ ...receipt, status: "applied", appliedBillId: body.billId, appliedPaymentId: body.paymentId });
      setApplyFor(null);
    } catch (applyFailure) {
      setApplyError(applyFailure.message);
    } finally {
      setApplying(false);
    }
  }

  async function scanWithAi() {
    setScanLoading(true);
    setScanMessage(null);
    try {
      const body = await readJson(
        await fetch(`/api/rental/receipts/${encodeURIComponent(receipt.id)}/extract`, { method: "POST" })
      );
      setScanMessage(body.extraction?.message || "AI scan is not connected.");
    } catch (scanError) {
      setScanMessage(scanError.message);
    } finally {
      setScanLoading(false);
    }
  }

  async function createVendorFromHint() {
    setActionError(null);
    try {
      const created = await readJson(
        await fetch("/api/rental/vendors", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: receipt.vendorNameHint }),
        })
      );
      const updated = await readJson(
        await fetch(`/api/rental/receipts/${encodeURIComponent(receipt.id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ vendorId: created.vendor.id }),
        })
      );
      onChanged(updated.receipt);
    } catch (createError) {
      setActionError(createError.message);
    }
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-slate-950 dark:text-white">
            {receipt.vendorName || receipt.vendorNameHint || "Unknown vendor"} — {cents(receipt.amountCents)}
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {receipt.receiptDate} · status: {receipt.status}
            {receipt.propertyId ? ` · ${receipt.propertyId}` : ""}
          </p>
        </div>
        <button type="button" onClick={onClose}
          className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-700 dark:border-slate-600 dark:text-slate-300">
          Close
        </button>
      </div>

      {!receipt.vendorId && receipt.status === "inbox" ? (
        <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm dark:bg-amber-950/40">
          <p className="font-bold text-amber-900 dark:text-amber-200">Unknown vendor: “{receipt.vendorNameHint}”</p>
          <button type="button" onClick={createVendorFromHint}
            className="mt-2 rounded-xl bg-amber-700 px-3 py-1.5 text-xs font-black text-white">
            Create vendor from this name
          </button>
          {actionError ? <p role="alert" className="mt-2 text-xs font-bold text-red-700 dark:text-red-400">{actionError}</p> : null}
        </div>
      ) : null}

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">AI scan</h4>
          <button type="button" onClick={scanWithAi} disabled={scanLoading}
            className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300">
            {scanLoading ? "Scanning…" : "Scan with AI"}
          </button>
        </div>
        {scanMessage ? (
          <p role="status" className="mt-2 rounded-xl bg-slate-100 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {scanMessage}
          </p>
        ) : null}
      </div>

      <div className="mt-6">
        <h4 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Suggested vendor bills
        </h4>
        {matchesLoading ? <p className="mt-2 text-sm text-slate-500">Matching…</p> : null}
        {matchesError ? <p role="alert" className="mt-2 text-sm font-bold text-red-700 dark:text-red-400">{matchesError}</p> : null}
        {matches && matches.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            No open bills matched this receipt — it may be a direct expense, or the bill has not been recorded yet.
          </p>
        ) : null}
        <ul className="mt-2 space-y-3">
          {(matches || []).map((match) => (
            <li key={match.billId} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-slate-900 dark:text-slate-100">
                    {match.bill?.vendorName || "Bill"} — {cents(match.bill?.balanceCents)}
                    {match.suggested ? (
                      <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-black text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                        suggested · {match.confidence}
                      </span>
                    ) : (
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                        {match.confidence}
                      </span>
                    )}
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-xs text-slate-600 dark:text-slate-400">
                    {match.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              </div>
              {receipt.status === "inbox" && match.suggested ? (
                <div className="mt-3">
                  {applyFor === match.billId ? (
                    <div className="grid gap-2 md:grid-cols-4">
                      <select value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)}
                        className="rounded-xl border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800">
                        {bankAccounts.map((account) => (
                          <option key={account.id} value={account.id}>{account.name || account.id}</option>
                        ))}
                      </select>
                      <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}
                        className="rounded-xl border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800">
                        <option value="ach">ACH</option>
                        <option value="check">Check</option>
                      </select>
                      {paymentMethod === "check" ? (
                        <input value={checkNumber} onChange={(event) => setCheckNumber(event.target.value)}
                          placeholder="Check #"
                          className="rounded-xl border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800" />
                      ) : null}
                      <div className="flex gap-2">
                        <button type="button" onClick={() => applyToBill(match.billId)} disabled={applying}
                          className="rounded-xl bg-emerald-700 px-3 py-1.5 text-sm font-black text-white disabled:opacity-50">
                          {applying ? "Applying…" : "Confirm pay"}
                        </button>
                        <button type="button" onClick={() => setApplyFor(null)}
                          className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-bold dark:border-slate-600">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setApplyFor(match.billId)}
                      className="rounded-xl bg-sky-700 px-3 py-1.5 text-sm font-black text-white">
                      Pay this bill with this receipt
                    </button>
                  )}
                  {applyError ? <p role="alert" className="mt-2 text-xs font-bold text-red-700 dark:text-red-400">{applyError}</p> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ReconciliationAssist({ bankAccounts }) {
  const [bankAccountId, setBankAccountId] = useState("");
  const [windowDays, setWindowDays] = useState(5);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ windowDays: String(windowDays) });
      if (bankAccountId) params.set("bankAccountId", bankAccountId);
      const body = await readJson(await fetch(`/api/rental/receipts/reconciliation-assist?${params.toString()}`));
      setResult(body);
    } catch (runError) {
      setError(runError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <h3 className="text-lg font-black text-slate-950 dark:text-white">Reconciliation assist</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Matches unapplied receipts and unpaid bills to bank register rows by amount and date — and lists
        what is unmatched on <em>both</em> sides. Deterministic; it never writes.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="font-bold text-slate-700 dark:text-slate-300">Bank account</span>
          <select value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)}
            className="mt-1 block rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800">
            <option value="">All accounts</option>
            {bankAccounts.map((account) => (
              <option key={account.id} value={account.id}>{account.name || account.id}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-bold text-slate-700 dark:text-slate-300">Date window (days ±)</span>
          <input type="number" min="0" max="30" value={windowDays}
            onChange={(event) => setWindowDays(Number(event.target.value))}
            className="mt-1 block w-24 rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800" />
        </label>
        <button type="button" onClick={run} disabled={loading}
          className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
          {loading ? "Running…" : "Run assist"}
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm font-bold text-red-700 dark:text-red-400">{error}</p> : null}
      {result ? (
        <div className="mt-6 space-y-6">
          <section>
            <h4 className="text-sm font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              Matched ({result.matches.length})
            </h4>
            {result.matches.length === 0 ? <p className="mt-1 text-sm text-slate-500">Nothing matched.</p> : (
              <ul className="mt-2 space-y-1 text-sm">
                {result.matches.map((match) => (
                  <li key={`${match.targetKind}:${match.targetId}`} className="text-slate-700 dark:text-slate-300">
                    {match.targetKind === "receipt" ? "Receipt" : "Bill"} {match.targetId.slice(-8)} ↔ bank row{" "}
                    {match.bankEventId.slice(-8)} · {cents(match.amountCents)} · {match.daysApart}d apart
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h4 className="text-sm font-black uppercase tracking-wide text-amber-700 dark:text-amber-400">
              Unmatched receipts ({result.unmatchedReceipts.length})
            </h4>
            <ul className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
              {result.unmatchedReceipts.map((receipt) => (
                <li key={receipt.id}>
                  {receipt.vendor_name_hint || receipt.vendor_id} · {cents(receipt.amount_cents)} · {receipt.receipt_date}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h4 className="text-sm font-black uppercase tracking-wide text-amber-700 dark:text-amber-400">
              Unmatched unpaid bills ({result.unmatchedBills.length})
            </h4>
            <ul className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
              {result.unmatchedBills.map((bill) => (
                <li key={bill.id}>
                  Bill {bill.id.slice(-8)} · {cents(Number(bill.amount_cents) - Number(bill.paid_amount_cents || 0))} · {bill.bill_date}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h4 className="text-sm font-black uppercase tracking-wide text-amber-700 dark:text-amber-400">
              Unmatched bank rows ({result.unmatchedBankEvents.length})
            </h4>
            <ul className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
              {result.unmatchedBankEvents.map((event) => (
                <li key={event.id}>
                  {event.payee || event.id.slice(-8)} · {cents(Math.round(Number(event.amount) * 100))} · {event.event_date}
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default function RentalReceiptsPanel() {
  const [tab, setTab] = useState("inbox");
  const [receipts, setReceipts] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [properties, setProperties] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState(null);

  // Pure data fetcher (no setState inside) so the effect can call it through
  // promise callbacks, per the repo's set-state-in-effect lint rule.
  const fetchReceiptsData = useCallback(async () => {
    const [receiptsBody, vendorsBody, accountsBody, rentalBody] = await Promise.all([
      readJson(await fetch("/api/rental/receipts?unmatched=1")),
      readJson(await fetch("/api/rental/vendors?includeInactive=1")).catch(() => ({ vendors: [] })),
      readJson(await fetch("/api/rental/bank-accounts")).catch(() => ({ accounts: [] })),
      readJson(await fetch("/api/rental")).catch(() => ({ units: [] })),
    ]);
    return {
      receipts: receiptsBody.receipts || [],
      vendors: vendorsBody.vendors || [],
      bankAccounts: accountsBody.accounts || accountsBody.bankAccounts || [],
      properties: rentalBody.units || [],
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchReceiptsData()
      .then((data) => {
        if (cancelled) return;
        setReceipts(data.receipts);
        setVendors(data.vendors);
        setBankAccounts(data.bankAccounts);
        setProperties(data.properties);
        setLoading(false);
      })
      .catch((loadError) => { if (!cancelled) { setError(loadError.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [fetchReceiptsData]);

  function retryLoad() {
    setLoading(true);
    setError(null);
    let cancelled = false;
    fetchReceiptsData()
      .then((data) => {
        if (cancelled) return;
        setReceipts(data.receipts);
        setVendors(data.vendors);
        setBankAccounts(data.bankAccounts);
        setProperties(data.properties);
        setLoading(false);
      })
      .catch((loadError) => { if (!cancelled) { setError(loadError.message); setLoading(false); } });
    return () => { cancelled = true; };
  }

  const inbox = useMemo(() => receipts || [], [receipts]);

  if (loading && !receipts) return <ForgeLoadingState label="Loading receipts…" />;
  if (error && !receipts) return <ForgeErrorState title="Unable to load receipts" detail={error} onRetry={retryLoad} />;

  return (
    <section className="space-y-6" data-rental-receipts>
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Rentec parity R26</p>
        <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Receipts</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
          Scan the paper trail: upload a receipt, type what it says, match it to a vendor bill, and pay the
          bill from the receipt — one click, through the normal pay-vendors flow. AI extraction is not
          connected; entry is manual.
        </p>
        <div className="mt-4 flex gap-2">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={`rounded-xl px-4 py-2 text-sm font-black ${tab === entry.id ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "border border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-300"}`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "inbox" ? (
        <div className="space-y-4">
          <div>
            <button type="button" onClick={() => setShowForm((value) => !value)}
              className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-black text-white">
              {showForm ? "Hide form" : "New receipt"}
            </button>
          </div>
          {showForm ? (
            <ReceiptForm
              vendors={vendors}
              properties={properties}
              onCancel={() => setShowForm(false)}
              onSaved={(receipt) => {
                setShowForm(false);
                setReceipts((rows) => [receipt, ...(rows || [])]);
              }}
            />
          ) : null}
          {selected ? (
            <ReceiptDetail
              key={selected.id}
              receipt={selected}
              vendors={vendors}
              bankAccounts={bankAccounts}
              onClose={() => setSelected(null)}
              onChanged={(updated) => {
                setSelected(updated);
                setReceipts((rows) => (rows || []).map((row) => (row.id === updated.id ? updated : row)));
                if (updated.status !== "inbox") {
                  setReceipts((rows) => (rows || []).filter((row) => row.id !== updated.id));
                  setSelected(null);
                }
              }}
            />
          ) : null}
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-lg font-black text-slate-950 dark:text-white">Unmatched inbox ({inbox.length})</h3>
            {inbox.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">The inbox is clear — every receipt is applied or voided.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                {inbox.map((receipt) => (
                  <li key={receipt.id}>
                    <button type="button" onClick={() => setSelected(receipt)}
                      className="flex w-full items-center justify-between gap-4 py-3 text-left">
                      <span>
                        <span className="block text-sm font-black text-slate-900 dark:text-slate-100">
                          {receipt.vendorName || receipt.vendorNameHint || "Unknown vendor"}
                        </span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          {receipt.receiptDate}
                          {receipt.propertyId ? ` · ${receipt.propertyId}` : ""}
                          {receipt.documentId ? " · has file" : ""}
                        </span>
                      </span>
                      <span className="text-sm font-black text-slate-900 dark:text-slate-100">{cents(receipt.amountCents)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <ReconciliationAssist bankAccounts={bankAccounts} />
      )}
    </section>
  );
}
