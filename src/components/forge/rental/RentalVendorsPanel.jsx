"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { ForgeLoadingState } from "@/components/forge/ForgeStates";

// Rentec parity R3 — Vendors: vendor master records + the AP bill subledger.
// Novice-simple on purpose: one screen, plain words, the bill form pre-fills
// the vendor when opened from the vendor's own page.

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const centsToDollars = (cents) => money.format(Number(cents || 0) / 100);
const dollarsToCents = (value) => {
  const n = Number(String(value || "").replaceAll(",", "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
};
const todayISO = () => new Date().toISOString().slice(0, 10);

const inputClass = "mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100";
const labelClass = "block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400";

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

const STATUS_LABELS = { open: "Open", partial: "Partially paid", paid: "Paid", voided: "Voided" };
const STATUS_STYLES = {
  open: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  partial: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  voided: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};

function StatusPill({ status, overdue }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_STYLES[status] || STATUS_STYLES.open}`}>
        {STATUS_LABELS[status] || status}
      </span>
      {overdue && <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800 dark:bg-red-900/40 dark:text-red-300">Overdue</span>}
    </span>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`w-full ${wide ? "max-w-2xl" : "max-w-lg"} max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-xl`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black text-slate-900 dark:text-white">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1 text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const blankVendor = () => ({
  name: "", contactName: "", email: "", phone: "", address: "",
  trade: "", taxClassification: "", taxIdLast4: "", notes: "",
});

function VendorForm({ initial, onSaved, onClose }) {
  const [form, setForm] = useState(() => ({ ...blankVendor(), ...(initial || {}) }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  async function save(event) {
    event.preventDefault();
    setError("");
    if (!form.name.trim()) { setError("Vendor name is required."); return; }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { setError("That email address does not look right."); return; }
    if (form.taxIdLast4.trim() && !/^\d{4}$/.test(form.taxIdLast4.trim())) { setError("Tax ID must be the last 4 digits."); return; }
    setSaving(true);
    try {
      const method = initial?.id ? "PATCH" : "POST";
      const url = initial?.id ? `/api/rental/vendors/${encodeURIComponent(initial.id)}` : "/api/rental/vendors";
      const body = await readJson(await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          contactName: form.contactName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          address: form.address.trim(),
          trade: form.trade.trim(),
          taxClassification: form.taxClassification.trim(),
          taxIdLast4: form.taxIdLast4.trim(),
          notes: form.notes.trim(),
        }),
      }));
      onSaved(body.vendor);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={initial?.id ? "Edit vendor" : "Add vendor"} onClose={onClose}>
      <form onSubmit={save} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={`${labelClass} sm:col-span-2`}>Vendor name *
          <input className={inputClass} value={form.name} onChange={update("name")} placeholder="Acme Plumbing" autoFocus />
        </label>
        <label className={labelClass}>Contact person
          <input className={inputClass} value={form.contactName} onChange={update("contactName")} placeholder="Sam the plumber" />
        </label>
        <label className={labelClass}>Trade / category
          <input className={inputClass} value={form.trade} onChange={update("trade")} placeholder="Plumbing, HVAC, Landscaping…" />
        </label>
        <label className={labelClass}>Email
          <input className={inputClass} type="email" value={form.email} onChange={update("email")} placeholder="billing@acme.example" />
        </label>
        <label className={labelClass}>Phone
          <input className={inputClass} value={form.phone} onChange={update("phone")} placeholder="555-0100" />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>Address
          <input className={inputClass} value={form.address} onChange={update("address")} placeholder="Street, city, state, ZIP" />
        </label>
        <label className={labelClass}>Tax classification
          <input className={inputClass} value={form.taxClassification} onChange={update("taxClassification")} placeholder="LLC, S-corp, Sole proprietor…" />
        </label>
        <label className={labelClass}>Tax ID (last 4)
          <input className={inputClass} value={form.taxIdLast4} onChange={update("taxIdLast4")} placeholder="1234" maxLength={4} inputMode="numeric" />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>Notes
          <textarea className={inputClass} rows={2} value={form.notes} onChange={update("notes")} placeholder="Anything worth remembering about this vendor" />
        </label>
        {error && <p className="sm:col-span-2 text-sm font-bold text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
          <button type="submit" disabled={saving} className={goldControlClassName}>{saving ? "Saving…" : initial?.id ? "Save changes" : "Add vendor"}</button>
        </div>
      </form>
    </Modal>
  );
}

const blankBill = () => ({
  vendorId: "", propertyId: "", billDate: todayISO(), dueDate: todayISO(),
  amount: "", expenseAccountCode: "", memo: "", attachmentReference: "",
});

function BillForm({ initial, vendors, properties, expenseAccounts, onSaved, onClose }) {
  const [form, setForm] = useState(() => ({ ...blankBill(), ...(initial ? {
    vendorId: initial.vendorId, propertyId: initial.propertyId || "", billDate: initial.billDate,
    dueDate: initial.dueDate, amount: (Number(initial.amountCents || 0) / 100).toFixed(2),
    expenseAccountCode: initial.expenseAccountCode, memo: initial.memo || "",
    attachmentReference: initial.attachmentReference || "",
  } : {}) }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  async function save(event) {
    event.preventDefault();
    setError("");
    const amountCents = dollarsToCents(form.amount);
    if (!form.vendorId) { setError("Choose a vendor for the bill."); return; }
    if (!amountCents) { setError("Enter the bill amount."); return; }
    if (!form.expenseAccountCode) { setError("Choose the expense account this bill posts to."); return; }
    setSaving(true);
    try {
      const method = initial?.id ? "PATCH" : "POST";
      const url = initial?.id ? `/api/rental/vendor-bills/${encodeURIComponent(initial.id)}` : "/api/rental/vendor-bills";
      const body = await readJson(await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: form.vendorId,
          propertyId: form.propertyId || undefined,
          billDate: form.billDate,
          dueDate: form.dueDate,
          amountCents,
          expenseAccountCode: form.expenseAccountCode,
          memo: form.memo.trim(),
          attachmentReference: form.attachmentReference.trim(),
        }),
      }));
      onSaved(body.bill);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={initial?.id ? "Edit bill" : "Record a bill"} onClose={onClose} wide>
      <form onSubmit={save} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={labelClass}>Vendor *
          <select className={inputClass} value={form.vendorId} onChange={update("vendorId")} disabled={Boolean(initial?.vendorId)}>
            <option value="">Choose a vendor…</option>
            {vendors.filter((v) => v.isActive).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label className={labelClass}>Property
          <select className={inputClass} value={form.propertyId} onChange={update("propertyId")}>
            <option value="">Whole portfolio…</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className={labelClass}>Bill date *
          <input className={inputClass} type="date" value={form.billDate} onChange={update("billDate")} />
        </label>
        <label className={labelClass}>Due date *
          <input className={inputClass} type="date" value={form.dueDate} onChange={update("dueDate")} />
        </label>
        <label className={labelClass}>Amount *
          <input className={inputClass} value={form.amount} onChange={update("amount")} placeholder="0.00" inputMode="decimal" />
        </label>
        <label className={labelClass}>Expense account *
          <select className={inputClass} value={form.expenseAccountCode} onChange={update("expenseAccountCode")}>
            <option value="">Choose an account…</option>
            {expenseAccounts.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
          </select>
        </label>
        <label className={`${labelClass} sm:col-span-2`}>Memo
          <input className={inputClass} value={form.memo} onChange={update("memo")} placeholder="What was this bill for?" />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>Attachment reference
          <input className={inputClass} value={form.attachmentReference} onChange={update("attachmentReference")} placeholder="Invoice # or document reference (optional)" />
        </label>
        {error && <p className="sm:col-span-2 text-sm font-bold text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
          <button type="submit" disabled={saving} className={goldControlClassName}>{saving ? "Saving…" : initial?.id ? "Save changes" : "Record bill"}</button>
        </div>
      </form>
    </Modal>
  );
}

function VoidBillForm({ bill, onDone, onClose }) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function voidBill(event) {
    event.preventDefault();
    setError("");
    if (!reason.trim()) { setError("A reason is required to void a bill."); return; }
    if (!confirmed) { setError("Please confirm you want to void this bill."); return; }
    setSaving(true);
    try {
      const body = await readJson(await fetch(`/api/rental/vendor-bills/${encodeURIComponent(bill.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ void: true, voidReason: reason.trim() }),
      }));
      onDone(body.bill);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Void bill" onClose={onClose}>
      <form onSubmit={voidBill} className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Voiding keeps the bill on the books as history ({centsToDollars(bill.amountCents)} from {bill.vendorName || "the vendor"}).
          It is never deleted. To bill a corrected amount, record a new bill instead.
        </p>
        <label className={labelClass}>Reason *
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this bill being voided?" autoFocus />
        </label>
        <label className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          I confirm I want to void this bill.
        </label>
        {error && <p className="text-sm font-bold text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50">{saving ? "Voiding…" : "Void bill"}</button>
        </div>
      </form>
    </Modal>
  );
}
// Rentec parity R4 — record a check/ACH payment against the vendor's open
// bills. One payment can cover many bills; each line defaults to the bill's
// remaining balance and can never exceed it. props.bills are the vendor's
// open/partial serialized bills; props.presetBillIds pre-selects lines.
function PaymentForm({ vendorId, vendorName, bills, presetBillIds, onSaved, onClose }) {
  const [lines, setLines] = useState(() =>
    bills.map((bill) => ({
      billId: bill.id,
      billDate: bill.billDate,
      dueDate: bill.dueDate,
      balanceCents: Number(bill.balanceCents || 0),
      selected: presetBillIds ? presetBillIds.includes(bill.id) : true,
      amount: (Number(bill.balanceCents || 0) / 100).toFixed(2),
    }))
  );
  const [method, setMethod] = useState("check");
  const [checkNumber, setCheckNumber] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [bankAccounts, setBankAccounts] = useState([]);
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [memo, setMemo] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const body = await readJson(await fetch("/api/rental/bank-accounts"));
        if (!cancelled) setBankAccounts(body.accounts || []);
      } catch (caught) {
        if (!cancelled) setError(caught.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggleLine = (billId) => setLines((list) => list.map((line) => line.billId === billId ? { ...line, selected: !line.selected } : line));
  const setLineAmount = (billId, amount) => setLines((list) => list.map((line) => line.billId === billId ? { ...line, amount } : line));

  const selectedLines = lines.filter((line) => line.selected);
  const totalCents = selectedLines.reduce((sum, line) => sum + (dollarsToCents(line.amount) || 0), 0);

  async function save(event) {
    event.preventDefault();
    setError("");
    if (selectedLines.length === 0) { setError("Choose at least one bill to pay."); return; }
    if (!bankAccountId) { setError("Choose the bank account this payment comes from."); return; }
    if (method === "check" && !checkNumber.trim()) { setError("Enter the check number."); return; }
    const applications = [];
    for (const line of selectedLines) {
      const amountCents = dollarsToCents(line.amount);
      if (!amountCents) { setError(`Enter an amount for the ${line.billDate} bill.`); return; }
      if (amountCents > line.balanceCents) { setError(`The ${line.billDate} bill only has ${centsToDollars(line.balanceCents)} left to pay.`); return; }
      applications.push({ billId: line.billId, amountCents });
    }
    setSaving(true);
    try {
      const body = await readJson(await fetch("/api/rental/vendor-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: `rental_vendor_payment_${crypto.randomUUID().replaceAll("-", "")}`,
          vendorId,
          paymentDate,
          paymentMethod: method,
          checkNumber: method === "check" ? checkNumber.trim() : undefined,
          bankAccountId,
          memo: memo.trim(),
          amountCents: totalCents,
          applications,
        }),
      }));
      onSaved(body.payment);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Pay ${vendorName || "vendor"}`} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-slate-200 dark:border-slate-700 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2">Pay</th><th className="px-4 py-2">Bill</th><th className="px-4 py-2">Due</th><th className="px-4 py-2">Balance</th><th className="px-4 py-2">Amount</th>
            </tr></thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.billId} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <td className="px-4 py-2"><input type="checkbox" checked={line.selected} onChange={() => toggleLine(line.billId)} aria-label={`Pay bill ${line.billDate}`} /></td>
                  <td className="px-4 py-2">{line.billDate}</td>
                  <td className="px-4 py-2">{line.dueDate}</td>
                  <td className="px-4 py-2">{centsToDollars(line.balanceCents)}</td>
                  <td className="px-4 py-2">
                    <input className={`${inputClass} mt-0 w-32`} value={line.amount} onChange={(e) => setLineAmount(line.billId, e.target.value)} inputMode="decimal" aria-label={`Amount for bill ${line.billDate}`} disabled={!line.selected} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={labelClass}>Method *
            <span className="mt-1 flex gap-4 text-sm normal-case text-slate-900 dark:text-slate-100">
              <label className="flex items-center gap-1 font-bold"><input type="radio" name="paymentMethod" checked={method === "check"} onChange={() => setMethod("check")} /> Check</label>
              <label className="flex items-center gap-1 font-bold"><input type="radio" name="paymentMethod" checked={method === "ach"} onChange={() => setMethod("ach")} /> ACH</label>
            </span>
          </label>
          <label className={labelClass}>Payment date *
            <input className={inputClass} type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </label>
          {method === "check" && (
            <label className={labelClass}>Check number *
              <input className={inputClass} value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} placeholder="e.g. 1042" />
            </label>
          )}
          <label className={labelClass}>Bank account *
            <select className={inputClass} value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
              <option value="">Choose an account…</option>
              {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.official_name || account.name}</option>)}
            </select>
          </label>
          <label className={`${labelClass} sm:col-span-2`}>Memo
            <input className={inputClass} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional note on the payment" />
          </label>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-800/60 px-4 py-3">
          <span className="text-sm text-slate-500">Total payment</span>
          <span className="text-lg font-black text-slate-900 dark:text-white">{centsToDollars(totalCents)}</span>
        </div>
        <p className="text-xs text-slate-500">Posting records the expense on the ledger and marks each bill paid in full (or partially, for short payments).</p>

        {error && <p className="text-sm font-bold text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
          <button type="submit" disabled={saving} className={goldControlClassName}>{saving ? "Posting…" : "Post payment"}</button>
        </div>
      </form>
    </Modal>
  );
}

function VoidPaymentForm({ payment, onDone, onClose }) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function voidPayment(event) {
    event.preventDefault();
    setError("");
    if (!reason.trim()) { setError("A reason is required to void a payment."); return; }
    if (!confirmed) { setError("Please confirm you want to void this payment."); return; }
    setSaving(true);
    try {
      const body = await readJson(await fetch(`/api/rental/vendor-payments/${encodeURIComponent(payment.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ void: true, voidReason: reason.trim() }),
      }));
      onDone(body.payment);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Void payment" onClose={onClose}>
      <form onSubmit={voidPayment} className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Voiding reverses this {payment.paymentMethod === "check" ? "check" : "ACH"} payment of {centsToDollars(payment.amountCents)}
          {payment.checkNumber ? ` (#${payment.checkNumber})` : ""} and rolls every bill balance back.
          The ledger entries are reversed, never deleted — the void stays on the books as history.
        </p>
        <label className={labelClass}>Reason *
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this payment being voided?" autoFocus />
        </label>
        <label className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          I confirm I want to void this payment.
        </label>
        {error && <p className="text-sm font-bold text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50">{saving ? "Voiding…" : "Void payment"}</button>
        </div>
      </form>
    </Modal>
  );
}

// R18 (rentec-parity): un-void a voided bill. Restores it to open — safe
// because a voided bill was untouched. Blocked when a probable replacement
// bill exists; the API names the replacement in plain English.
function UnvoidBillForm({ bill, onDone, onClose }) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [audits, setAudits] = useState([]);
  const [loadingAudits, setLoadingAudits] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const body = await readJson(await fetch(`/api/rental/vendor-bills/${encodeURIComponent(bill.id)}`));
        if (!cancelled) setAudits(body.audits || []);
      } catch {
        if (!cancelled) setAudits([]);
      } finally {
        if (!cancelled) setLoadingAudits(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bill.id]);

  async function unvoidBill(event) {
    event.preventDefault();
    setError("");
    if (!reason.trim()) { setError("A reason is required to un-void a bill."); return; }
    if (!confirmed) { setError("Please confirm you want to un-void this bill."); return; }
    setSaving(true);
    try {
      const body = await readJson(await fetch(`/api/rental/vendor-bills/${encodeURIComponent(bill.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unvoid: true, unvoidReason: reason.trim() }),
      }));
      onDone(body.bill);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Un-void bill" onClose={onClose}>
      <form onSubmit={unvoidBill} className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Un-voiding restores this bill to open ({centsToDollars(bill.amountCents)} from {bill.vendorName || "the vendor"}).
          {bill.voidReason ? <> It was voided because: <span className="font-bold">“{bill.voidReason}”</span>.</> : null}
          {" "}This is blocked if a replacement bill was entered after the void — un-voiding then would double the amount owed.
        </p>
        {!loadingAudits && audits.length > 0 && (
          <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3">
            <p className="text-xs font-black uppercase tracking-wide text-slate-500">History</p>
            <ul className="mt-1 space-y-1 text-sm text-slate-600 dark:text-slate-300">
              {audits.map((audit) => (
                <li key={audit.id}>{audit.actionLabel} — {audit.reason} <span className="text-slate-400">({String(audit.createdAt || "").slice(0, 10)})</span></li>
              ))}
            </ul>
          </div>
        )}
        <label className={labelClass}>Reason *
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this bill being restored?" autoFocus />
        </label>
        <label className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          I confirm I want to un-void this bill.
        </label>
        {error && <p className="text-sm font-bold text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{saving ? "Un-voiding…" : "Un-void bill"}</button>
        </div>
      </form>
    </Modal>
  );
}

// R18 (rentec-parity): re-issue a voided vendor payment. A voided payment is
// never un-voided — instead a NEW payment (new check number) is recorded
// through the same validated path and linked to the voided original.
function ReissuePaymentForm({ payment, onDone, onClose }) {
  const isCheck = payment.paymentMethod === "check";
  const [checkNumber, setCheckNumber] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [memo, setMemo] = useState(payment.memo || "");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function reissue(event) {
    event.preventDefault();
    setError("");
    if (isCheck && !checkNumber.trim()) { setError("A new check number is required to re-issue a check."); return; }
    if (isCheck && checkNumber.trim() === (payment.checkNumber || "").trim()) { setError("The re-issued check needs a new check number — it cannot reuse the voided check's number."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) { setError("Enter a valid payment date (YYYY-MM-DD)."); return; }
    if (!reason.trim()) { setError("A reason is required to re-issue a payment."); return; }
    if (!confirmed) { setError("Please confirm you want to re-issue this payment."); return; }
    setSaving(true);
    try {
      const body = await readJson(await fetch("/api/rental/vendor-payments/reissue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voidedPaymentId: payment.id,
          checkNumber: checkNumber.trim(),
          paymentDate,
          memo: memo.trim(),
          reason: reason.trim(),
        }),
      }));
      onDone(body.payment);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Re-issue ${isCheck ? "check" : "payment"}`} onClose={onClose}>
      <form onSubmit={reissue} className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Re-issuing records a <span className="font-bold">new</span> {isCheck ? "check" : "ACH"} payment of {centsToDollars(payment.amountCents)} to {payment.vendorName || "the vendor"},
          linked to the voided {isCheck ? `check #${payment.checkNumber || "—"}` : "payment"}. The voided original stays on the books as history.
          {payment.voidReason ? <> It was voided because: <span className="font-bold">“{payment.voidReason}”</span>.</> : null}
        </p>
        {isCheck && (
          <label className={labelClass}>New check number *
            <input className={inputClass} value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} placeholder="Must differ from the voided check" autoFocus />
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className={labelClass}>Payment date
            <input type="date" className={inputClass} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </label>
          <label className={labelClass}>Memo
            <input className={inputClass} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </label>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 dark:border-sky-800 dark:bg-sky-950/30">
          <p className="text-xs font-black uppercase tracking-wide text-sky-800 dark:text-sky-300">Before → after</p>
          <p className="mt-1 text-sm font-bold text-sky-900 dark:text-sky-200">
            Voided {isCheck ? `check #${payment.checkNumber || "—"}` : "payment"} of {centsToDollars(payment.amountCents)}
            {" "}<span aria-hidden="true">→</span> new {isCheck ? `check #${checkNumber.trim() || "…"}` : "ACH"} of {centsToDollars(payment.amountCents)} on {paymentDate}
          </p>
        </div>
        <label className={labelClass}>Reason *
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this payment being re-issued?" />
        </label>
        <label className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          I confirm I want to re-issue this payment.
        </label>
        {error && <p className="text-sm font-bold text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{saving ? "Re-issuing…" : "Re-issue payment"}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function RentalVendorsPanel() {  const [tab, setTab] = useState("vendors");
  const [vendors, setVendors] = useState([]);
  const [bills, setBills] = useState([]);
  const [expenseAccounts, setExpenseAccounts] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [selectedVendorId, setSelectedVendorId] = useState(null);
  const [vendorDetail, setVendorDetail] = useState(null);
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [editingVendor, setEditingVendor] = useState(null);
  const [showBillForm, setShowBillForm] = useState(false);
  const [editingBill, setEditingBill] = useState(null);
  const [billVendorPreset, setBillVendorPreset] = useState(null);
  const [voidingBill, setVoidingBill] = useState(null);
  const [unvoidingBill, setUnvoidingBill] = useState(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [payingBills, setPayingBills] = useState(null);
  const [voidingPayment, setVoidingPayment] = useState(null);
  const [reissuingPayment, setReissuingPayment] = useState(null);
  const [togglingActive, setTogglingActive] = useState(false);

  // Pure data fetchers (no setState inside) so effects can call them through
  // promise callbacks, per the repo's set-state-in-effect lint rule.
  const fetchAll = useCallback(async () => {
    const [vendorsBody, billsBody, chartBody, rentalBody] = await Promise.all([
      readJson(await fetch("/api/rental/vendors?includeInactive=1")),
      readJson(await fetch("/api/rental/vendor-bills")),
      readJson(await fetch("/api/rental/chart-of-accounts")).catch(() => ({ accounts: [] })),
      readJson(await fetch("/api/rental")).catch(() => ({ units: [] })),
    ]);
    const seen = new Map();
    for (const unit of rentalBody.units || []) {
      const pid = unit.property_id || unit.id;
      if (!seen.has(pid)) {
        const siblings = (rentalBody.units || []).filter((u) => (u.property_id || u.id) === pid);
        seen.set(pid, { id: pid, label: siblings.length > 1 ? `${unit.label || pid} (${siblings.length} units)` : (unit.label || pid) });
      }
    }
    return {
      vendors: vendorsBody.vendors || [],
      bills: billsBody.bills || [],
      expenseAccounts: (chartBody.accounts || []).filter((a) => a.account_type === "expense" && a.is_active),
      properties: [...seen.values()],
    };
  }, []);

  const fetchVendorDetail = useCallback(async (vendorId) =>
    readJson(await fetch(`/api/rental/vendors/${encodeURIComponent(vendorId)}`)), []);

  useEffect(() => {
    let cancelled = false;
    fetchAll()
      .then((all) => {
        if (cancelled) return;
        setError("");
        setVendors(all.vendors);
        setBills(all.bills);
        setExpenseAccounts(all.expenseAccounts);
        setProperties(all.properties);
        setLoading(false);
      })
      .catch((caught) => { if (!cancelled) { setError(caught.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [fetchAll]);

  useEffect(() => {
    if (!selectedVendorId) return;
    let cancelled = false;
    fetchVendorDetail(selectedVendorId)
      .then((body) => { if (!cancelled) setVendorDetail(body); })
      .catch((caught) => { if (!cancelled) setError(caught.message); });
    return () => { cancelled = true; };
  }, [selectedVendorId, fetchVendorDetail]);

  const refreshVendorDetail = useCallback((vendorId) => {
    if (!vendorId) return;
    fetchVendorDetail(vendorId)
      .then((body) => setVendorDetail(body))
      .catch((caught) => setError(caught.message));
  }, [fetchVendorDetail]);

  const selectVendor = useCallback((vendorId) => {
    setVendorDetail(null);
    setSelectedVendorId(vendorId);
  }, []);

  const filteredVendors = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendors.filter((v) => v.isActive && (!q || [v.name, v.contactName, v.trade].some((f) => (f || "").toLowerCase().includes(q))));
  }, [vendors, search]);

  const openBalanceByVendor = useMemo(() => {
    const map = new Map();
    for (const bill of bills) {
      if (bill.status === "voided") continue;
      map.set(bill.vendorId, (map.get(bill.vendorId) || 0) + Number(bill.balanceCents || 0));
    }
    return map;
  }, [bills]);

  const filteredBills = useMemo(() => {
    const now = todayISO();
    return bills.filter((bill) => {
      if (statusFilter === "overdue") return bill.status === "open" && bill.dueDate < now && Number(bill.balanceCents || 0) > 0;
      if (statusFilter === "all") return true;
      return bill.status === statusFilter;
    });
  }, [bills, statusFilter]);

  const totals = useMemo(() => {
    const live = bills.filter((b) => b.status !== "voided");
    return {
      openCents: live.reduce((s, b) => s + Number(b.balanceCents || 0), 0),
      openCount: live.filter((b) => Number(b.balanceCents || 0) > 0).length,
    };
  }, [bills]);

  function afterVendorSaved(saved) {
    setVendors((list) => {
      const exists = list.some((v) => v.id === saved.id);
      return exists ? list.map((v) => (v.id === saved.id ? saved : v)) : [...list, saved].sort((a, b) => a.name.localeCompare(b.name));
    });
    setShowVendorForm(false);
    setEditingVendor(null);
    if (saved.id) { selectVendor(saved.id); refreshVendorDetail(saved.id); }
  }

  function afterBillSaved(saved) {
    setBills((list) => {
      const exists = list.some((b) => b.id === saved.id);
      return exists ? list.map((b) => (b.id === saved.id ? saved : b)) : [saved, ...list];
    });
    setShowBillForm(false);
    setEditingBill(null);
    setBillVendorPreset(null);
    setVoidingBill(null);
    if (saved.vendorId) refreshVendorDetail(saved.vendorId);
  }

  async function toggleVendorActive(vendor) {
    setTogglingActive(true);
    setError("");
    try {
      const body = await readJson(await fetch(`/api/rental/vendors/${encodeURIComponent(vendor.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !vendor.isActive }),
      }));
      setVendors((list) => list.map((v) => (v.id === vendor.id ? body.vendor : v)));
      refreshVendorDetail(vendor.id);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setTogglingActive(false);
    }
  }

  function openBillForm(vendorId = null, bill = null) {
    setBillVendorPreset(vendorId ? { vendorId } : null);
    setEditingBill(bill);
    setShowBillForm(true);
  }

  function openPaymentForm(vendorId, vendorName, bills, presetBillIds = null) {
    const payable = (bills || []).filter((b) => b.status === "open" || b.status === "partial");
    if (payable.length === 0) return;
    setPayingBills({ vendorId, vendorName, bills: payable, presetBillIds });
    setShowPaymentForm(true);
  }

  function afterPaymentSaved(saved) {
    setShowPaymentForm(false);
    setPayingBills(null);
    setVoidingPayment(null);
    // Bill balances and statuses changed — refresh the bills list and the
    // vendor's ledger so both views agree.
    fetchAll()
      .then((all) => { setVendors(all.vendors); setBills(all.bills); })
      .catch((caught) => setError(caught.message));
    if (saved?.vendorId) refreshVendorDetail(saved.vendorId);
  }

  if (loading) return <ForgeLoadingState label="Loading vendors…" />;
  const selectedVendor = vendors.find((v) => v.id === selectedVendorId) || null;

  return (
    <section aria-label="Vendors" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900 dark:text-white">Vendors</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {totals.openCount > 0
              ? `${centsToDollars(totals.openCents)} owed across ${totals.openCount} open bill${totals.openCount === 1 ? "" : "s"}`
              : "No open bills. Record a bill when a vendor invoice arrives."}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => { setEditingVendor(null); setShowVendorForm(true); }} className={goldControlClassName}>Add vendor</button>
          <button type="button" onClick={() => openBillForm(selectedVendorId)} className="rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">Record bill</button>
        </div>
      </div>

      <div className="flex gap-2" role="tablist" aria-label="Vendors views">
        {[["vendors", "Vendors"], ["bills", `Bills (${bills.filter((b) => b.status !== "voided").length})`]].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`rounded-lg px-4 py-2 text-sm font-bold ${tab === id ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
            {label}
          </button>
        ))}
      </div>

      {error && <p className="rounded-lg bg-red-50 dark:bg-red-900/20 px-4 py-2 text-sm font-bold text-red-700 dark:text-red-300">{error}</p>}

      {tab === "vendors" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-2 lg:col-span-1">
            <input className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendors…" aria-label="Search vendors" />
            {filteredVendors.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No vendors yet. Add your first vendor to get started.</p>}
            {filteredVendors.map((vendor) => {
              const balance = openBalanceByVendor.get(vendor.id) || 0;
              const active = vendor.id === selectedVendorId;
              return (
                <button key={vendor.id} type="button" onClick={() => selectVendor(vendor.id)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left ${active ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20" : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-amber-400"}`}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-slate-900 dark:text-slate-100">{vendor.name}</span>
                    <span className="block truncate text-xs text-slate-500">{[vendor.trade, vendor.contactName].filter(Boolean).join(" · ") || "—"}</span>
                  </span>
                  {balance > 0 && <span className="shrink-0 text-sm font-bold text-amber-700 dark:text-amber-300">{centsToDollars(balance)}</span>}
                </button>
              );
            })}
          </div>

          <div className="lg:col-span-2">
            {!selectedVendor && <p className="rounded-xl border border-dashed border-slate-300 dark:border-slate-600 p-8 text-center text-sm text-slate-500">Choose a vendor to see their bills and details.</p>}
            {selectedVendor && vendorDetail && (
              <div className="space-y-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-black text-slate-900 dark:text-white">{vendorDetail.vendor.name}</h3>
                    <p className="text-sm text-slate-500">{[vendorDetail.vendor.trade, vendorDetail.vendor.contactName].filter(Boolean).join(" · ")}</p>
                    {!vendorDetail.vendor.isActive && <span className="mt-1 inline-block rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">Inactive</span>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => openBillForm(selectedVendor.id)} className={goldControlClassName}>Record bill</button>
                    {vendorDetail.totals.openCents > 0 && (
                      <button type="button" onClick={() => openPaymentForm(selectedVendor.id, vendorDetail.vendor.name, vendorDetail.bills)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700">Pay bills</button>
                    )}
                    <button type="button" onClick={() => { setEditingVendor(vendorDetail.vendor); setShowVendorForm(true); }} className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">Edit</button>
                    <button type="button" disabled={togglingActive} onClick={() => toggleVendorActive(vendorDetail.vendor)} className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 disabled:opacity-50">
                      {vendorDetail.vendor.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  </div>
                </div>

                <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                  {[["Contact", vendorDetail.vendor.contactName], ["Email", vendorDetail.vendor.email], ["Phone", vendorDetail.vendor.phone], ["Address", vendorDetail.vendor.address], ["Tax classification", vendorDetail.vendor.taxClassification], ["Tax ID (last 4)", vendorDetail.vendor.taxIdLast4 ? `•••• ${vendorDetail.vendor.taxIdLast4}` : null]].map(([label, value]) => (
                    value ? <div key={label}><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="text-slate-900 dark:text-slate-100">{value}</dd></div> : null
                  ))}
                </dl>
                {vendorDetail.vendor.notes && <p className="text-sm text-slate-600 dark:text-slate-300"><span className="font-bold">Notes:</span> {vendorDetail.vendor.notes}</p>}

                <div className="flex gap-6 rounded-lg bg-slate-50 dark:bg-slate-800/60 px-4 py-3 text-sm">
                  <span><span className="font-bold text-slate-900 dark:text-white">{centsToDollars(vendorDetail.totals.openCents)}</span> <span className="text-slate-500">open</span></span>
                  <span><span className="font-bold text-slate-900 dark:text-white">{centsToDollars(vendorDetail.totals.billedCents)}</span> <span className="text-slate-500">lifetime billed</span></span>
                  <span><span className="font-bold text-slate-900 dark:text-white">{centsToDollars(vendorDetail.totals.paidCents)}</span> <span className="text-slate-500">lifetime paid</span></span>
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-black uppercase tracking-wide text-slate-500">Bill history</h4>
                  {vendorDetail.bills.length === 0 && <p className="text-sm text-slate-500">No bills recorded for this vendor yet.</p>}
                  {vendorDetail.bills.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead><tr className="text-xs uppercase tracking-wide text-slate-500">
                          <th className="py-2 pr-3">Bill date</th><th className="py-2 pr-3">Due</th><th className="py-2 pr-3">Amount</th><th className="py-2 pr-3">Balance</th><th className="py-2 pr-3">Status</th><th className="py-2">Actions</th>
                        </tr></thead>
                        <tbody>
                          {vendorDetail.bills.map((bill) => (
                            <tr key={bill.id} className="border-t border-slate-100 dark:border-slate-800">
                              <td className="py-2 pr-3">{bill.billDate}</td>
                              <td className="py-2 pr-3">{bill.dueDate}</td>
                              <td className="py-2 pr-3 font-bold">{centsToDollars(bill.amountCents)}</td>
                              <td className="py-2 pr-3">{centsToDollars(bill.balanceCents)}</td>
                              <td className="py-2 pr-3"><StatusPill status={bill.status} overdue={bill.status === "open" && bill.dueDate < todayISO()} /></td>
                              <td className="py-2">
                                <span className="flex gap-2">
                                  {bill.status === "open" && <button type="button" onClick={() => openBillForm(null, bill)} className="text-xs font-bold text-amber-700 hover:underline dark:text-amber-300">Edit</button>}
                                  {(bill.status === "open" || bill.status === "partial") && (
                                    <button type="button" onClick={() => openPaymentForm(selectedVendor.id, vendorDetail.vendor.name, vendorDetail.bills, [bill.id])} className="text-xs font-bold text-emerald-700 hover:underline dark:text-emerald-300">Pay</button>
                                  )}
                                  {(bill.status === "open") && <button type="button" onClick={() => setVoidingBill(bill)} className="text-xs font-bold text-red-600 hover:underline">Void</button>}
                                  {bill.status === "voided" && <button type="button" onClick={() => setUnvoidingBill(bill)} className="text-xs font-bold text-emerald-700 hover:underline dark:text-emerald-300">Un-void</button>}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-black uppercase tracking-wide text-slate-500">Payment history</h4>
                  {(!vendorDetail.payments || vendorDetail.payments.length === 0) && <p className="text-sm text-slate-500">No payments recorded for this vendor yet.</p>}
                  {vendorDetail.payments && vendorDetail.payments.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead><tr className="text-xs uppercase tracking-wide text-slate-500">
                          <th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Method</th><th className="py-2 pr-3">Amount</th><th className="py-2 pr-3">Bills</th><th className="py-2 pr-3">Status</th><th className="py-2">Actions</th>
                        </tr></thead>
                        <tbody>
                          {vendorDetail.payments.map((payment) => (
                            <tr key={payment.id} className="border-t border-slate-100 dark:border-slate-800">
                              <td className="py-2 pr-3">{payment.paymentDate}</td>
                              <td className="py-2 pr-3">{payment.paymentMethod === "check" ? `Check${payment.checkNumber ? ` #${payment.checkNumber}` : ""}` : "ACH"}</td>
                              <td className="py-2 pr-3 font-bold">{centsToDollars(payment.amountCents)}</td>
                              <td className="py-2 pr-3 text-xs text-slate-500">
                                {(payment.applications || []).map((app) => `${app.billBillDate || "bill"} (${centsToDollars(app.amountCents)})`).join(", ") || "—"}
                              </td>
                              <td className="py-2 pr-3">
                                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${payment.status === "active" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"}`}>
                                  {payment.status === "active" ? "Active" : "Voided"}
                                </span>
                                {payment.reissueCheckNumber && (
                                  <span className="ml-1 inline-block rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">
                                    Re-issued as check #{payment.reissueCheckNumber}
                                  </span>
                                )}
                                {!payment.reissueCheckNumber && payment.reissuePaymentId && (
                                  <span className="ml-1 inline-block rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">Re-issued</span>
                                )}
                                {payment.reissuedFromPaymentId && (
                                  <span className="ml-1 inline-block rounded-full bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-800 dark:bg-violet-900/40 dark:text-violet-300">Re-issue of voided payment</span>
                                )}
                              </td>
                              <td className="py-2">
                                {payment.status === "active" && (
                                  <button type="button" onClick={() => setVoidingPayment(payment)} className="text-xs font-bold text-red-600 hover:underline">Void</button>
                                )}
                                {payment.status === "voided" && !payment.reissuePaymentId && (
                                  <button type="button" onClick={() => setReissuingPayment(payment)} className="text-xs font-bold text-emerald-700 hover:underline dark:text-emerald-300">Re-issue</button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "bills" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Bill status filter">
            {[["open", "Open"], ["overdue", "Overdue"], ["paid", "Paid"], ["voided", "Voided"], ["all", "All"]].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setStatusFilter(id)}
                className={`rounded-full px-3 py-1 text-xs font-bold ${statusFilter === id ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"}`}>
                {label}
              </button>
            ))}
          </div>
          {filteredBills.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No bills in this view.</p>}
          {filteredBills.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full bg-white dark:bg-slate-900 text-left text-sm">
                <thead><tr className="border-b border-slate-200 dark:border-slate-700 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2">Vendor</th><th className="px-4 py-2">Bill date</th><th className="px-4 py-2">Due</th><th className="px-4 py-2">Amount</th><th className="px-4 py-2">Balance</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Actions</th>
                </tr></thead>
                <tbody>
                  {filteredBills.map((bill) => (
                    <tr key={bill.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                      <td className="px-4 py-2 font-bold text-slate-900 dark:text-slate-100">{bill.vendorName || "—"}</td>
                      <td className="px-4 py-2">{bill.billDate}</td>
                      <td className="px-4 py-2">{bill.dueDate}</td>
                      <td className="px-4 py-2 font-bold">{centsToDollars(bill.amountCents)}</td>
                      <td className="px-4 py-2">{centsToDollars(bill.balanceCents)}</td>
                      <td className="px-4 py-2"><StatusPill status={bill.status} overdue={bill.status === "open" && bill.dueDate < todayISO()} /></td>
                      <td className="px-4 py-2">
                        <span className="flex gap-2">
                          {bill.status === "open" && <button type="button" onClick={() => openBillForm(null, bill)} className="text-xs font-bold text-amber-700 hover:underline dark:text-amber-300">Edit</button>}
                          {(bill.status === "open" || bill.status === "partial") && (
                            <button type="button" onClick={() => openPaymentForm(bill.vendorId, bill.vendorName, [bill], [bill.id])} className="text-xs font-bold text-emerald-700 hover:underline dark:text-emerald-300">Pay</button>
                          )}
                          {bill.status === "open" && <button type="button" onClick={() => setVoidingBill(bill)} className="text-xs font-bold text-red-600 hover:underline">Void</button>}
                          {bill.status === "voided" && <button type="button" onClick={() => setUnvoidingBill(bill)} className="text-xs font-bold text-emerald-700 hover:underline dark:text-emerald-300">Un-void</button>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showVendorForm && <VendorForm initial={editingVendor} onSaved={afterVendorSaved} onClose={() => { setShowVendorForm(false); setEditingVendor(null); }} />}
      {showBillForm && (
        <BillForm
          initial={editingBill ? { ...editingBill, ...(billVendorPreset || {}) } : billVendorPreset}
          vendors={vendors}
          properties={properties}
          expenseAccounts={expenseAccounts}
          onSaved={afterBillSaved}
          onClose={() => { setShowBillForm(false); setEditingBill(null); setBillVendorPreset(null); }}
        />
      )}
      {voidingBill && <VoidBillForm bill={voidingBill} onDone={afterBillSaved} onClose={() => setVoidingBill(null)} />}
      {unvoidingBill && <UnvoidBillForm bill={unvoidingBill} onDone={afterBillSaved} onClose={() => setUnvoidingBill(null)} />}
      {showPaymentForm && payingBills && (
        <PaymentForm
          vendorId={payingBills.vendorId}
          vendorName={payingBills.vendorName}
          bills={payingBills.bills}
          presetBillIds={payingBills.presetBillIds}
          onSaved={afterPaymentSaved}
          onClose={() => { setShowPaymentForm(false); setPayingBills(null); }}
        />
      )}
      {voidingPayment && <VoidPaymentForm payment={voidingPayment} onDone={afterPaymentSaved} onClose={() => setVoidingPayment(null)} />}
      {reissuingPayment && <ReissuePaymentForm payment={reissuingPayment} onDone={afterPaymentSaved} onClose={() => setReissuingPayment(null)} />}
    </section>
  );
}
