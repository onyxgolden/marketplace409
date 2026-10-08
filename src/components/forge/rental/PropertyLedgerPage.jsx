"use client";
import { useEffect, useMemo, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeLoadingState } from "@/components/forge/ForgeStates";
import TransactionForm from "./TransactionForm";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const label = (value) => String(value ?? "—").replaceAll("_", " ");
const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
};
// Ledger convention: positive balance = net income for the property (green);
// negative = net loss (red).
const balanceClass = (cents) => cents < 0
  ? "text-red-700 dark:text-red-400"
  : "text-emerald-700 dark:text-emerald-400";

async function fetchPropertyLedger(propertyId) {
  const response = await fetch(`/api/rental/property-ledger?propertyId=${encodeURIComponent(propertyId)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load the property ledger.");
  return body;
}

async function fetchTransaction(eventId) {
  const response = await fetch(`/api/rental/transactions?eventId=${encodeURIComponent(eventId)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load the transaction.");
  return body.event;
}

async function deleteTransaction(eventId) {
  const response = await fetch(`/api/rental/transactions?eventId=${encodeURIComponent(eventId)}`, { method: "DELETE" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to delete the transaction.");
}

// Running-balance ledger table for one property: Date | Description | Check # |
// Debit | Credit | Balance, with cleared (C) and attachment indicators and a
// per-row edit action for owned manual entries. Income posts to Credit,
// expenses to Debit. Succeeded rent payments on the property's leases appear as
// rental income; contractor payouts and manual/imported expense events appear
// as debits.
//
// Data layer: stale-while-revalidate, same as the tenant ledger — reopening a
// recently viewed property serves the cached payload instantly and refreshes
// in the background.
//
// Post Income / Post Expense open the transaction modal (TransactionForm).
// The onPostIncome / onPostExpense props remain as host overrides; when absent
// the page opens its own modal.
export default function PropertyLedgerPage({ propertyId, propertyLabel, properties = [], tenants = [], onClose, onPostIncome, onPostExpense }) {
  const { data, error, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    propertyId ? `property-ledger:${propertyId}` : null,
    () => fetchPropertyLedger(propertyId),
    { ttlMs: 60_000 },
  );
  const ledger = data?.ledger || null;
  const [detailEntry, setDetailEntry] = useState(null);
  const [postKind, setPostKind] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [editError, setEditError] = useState("");
  // Ledger view controls: transaction filter, date range, and display settings.
  const [kindFilter, setKindFilter] = useState("all");
  const [dateRange, setDateRange] = useState("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [compactRows, setCompactRows] = useState(false);
  const [showSubLine, setShowSubLine] = useState(true);

  async function startEdit(entry) {
    setEditError("");
    try {
      const event = await fetchTransaction(entry.sourceId);
      setDetailEntry(null);
      setEditingEvent(event);
    } catch (caught) {
      setEditError(caught.message);
    }
  }

  async function confirmDelete(entry) {
    setEditError("");
    try {
      await deleteTransaction(entry.sourceId);
      setDetailEntry(null);
      refresh();
    } catch (caught) {
      setEditError(caught.message);
    }
  }

  useEffect(() => {
    if (!detailEntry) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setDetailEntry(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailEntry]);

  const title = ledger?.propertyLabel || propertyLabel || "Property";

  // Client-side filtering over the loaded entries: kind filter + date range.
  // "This month"/"Last month"/"This year" use the device's local calendar.
  const filteredEntries = useMemo(() => {
    const rows = ledger?.entries || [];
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    return rows.filter((entry) => {
      if (kindFilter === "income" && !(entry.creditCents > 0)) return false;
      if (kindFilter === "expense" && !(entry.debitCents > 0)) return false;
      if (kindFilter === "cleared" && !entry.cleared) return false;
      if (kindFilter === "uncleared" && entry.cleared) return false;
      if (dateRange !== "all" && entry.date) {
        const day = new Date(entry.date.length === 10 ? `${entry.date}T12:00:00` : entry.date);
        if (Number.isNaN(day.getTime())) return true;
        if (dateRange === "month" && day < startOfMonth) return false;
        if (dateRange === "lastMonth" && (day < startOfLastMonth || day >= startOfMonth)) return false;
        if (dateRange === "year" && day < startOfYear) return false;
        if (dateRange === "custom") {
          if (customStart && day < new Date(`${customStart}T12:00:00`)) return false;
          if (customEnd && day > new Date(`${customEnd}T12:00:00`)) return false;
        }
      }
      return true;
    });
  }, [ledger, kindFilter, dateRange, customStart, customEnd]);
  const filtersActive = kindFilter !== "all" || dateRange !== "all";

  return (
    <section data-property-ledger-page aria-label={`Property ledger for ${title}`}
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          {onClose && (
            <button type="button" onClick={onClose}
              className="text-sm font-black text-sky-700 underline hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-300">
              ← Back to properties
            </button>
          )}
          <p className="mt-2 text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">
            Properties <span className="mx-1 text-slate-400 dark:text-slate-500">/</span>{" "}
            <span className="text-slate-950 dark:text-white">{title}</span>
          </p>
          <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Ledger</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => (onPostIncome ? onPostIncome() : setPostKind("income"))}
            className={`rounded-xl px-4 py-2.5 text-sm font-black transition ${goldControlClassName}`}>
            Post Income
          </button>
          <button type="button" onClick={() => (onPostExpense ? onPostExpense() : setPostKind("expense"))}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            Post Expense
          </button>
          <div className="relative">
            <button type="button" onClick={() => setSettingsOpen((open) => !open)} aria-label="Ledger display settings"
              aria-expanded={settingsOpen}
              className="rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              ⚙
            </button>
            {settingsOpen && (
              <div className="absolute right-0 z-20 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-800">
                <p className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Row density</p>
                <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Row density">
                  {[false, true].map((compact) => (
                    <button key={String(compact)} type="button" role="radio" aria-checked={compactRows === compact}
                      onClick={() => setCompactRows(compact)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-black ${compactRows === compact
                        ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                        : "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"}`}>
                      {compact ? "Compact" : "Comfortable"}
                    </button>
                  ))}
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-300">
                  <input type="checkbox" checked={showSubLine} onChange={(event) => setShowSubLine(event.target.checked)}
                    className="h-4 w-4 accent-emerald-600" />
                  Show detail line
                </label>
                <button type="button" onClick={() => { setSettingsOpen(false); if (typeof window.print === "function") window.print(); }}
                  className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-black text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                  Print ledger
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {isLoading && <ForgeLoadingState label="Loading ledger…" />}
      {isRefreshing && ledger && (
        <p className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Updating…</p>
      )}
      {error && <p role="alert" className="mt-6 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      {!isLoading && ledger && (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-xl font-black text-slate-950 dark:text-white">Transactions</h3>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <label className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <span className="sr-only">Filter transactions</span>
                <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)} aria-label="Filter transactions"
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                  <option value="all">All transactions</option>
                  <option value="income">Income</option>
                  <option value="expense">Expenses</option>
                  <option value="cleared">Cleared</option>
                  <option value="uncleared">Uncleared</option>
                </select>
              </label>
              <label className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <span className="sr-only">Date range</span>
                <select value={dateRange} onChange={(event) => setDateRange(event.target.value)} aria-label="Date range"
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                  <option value="all">All dates</option>
                  <option value="month">This month</option>
                  <option value="lastMonth">Last month</option>
                  <option value="year">This year</option>
                  <option value="custom">Custom…</option>
                </select>
              </label>
              {dateRange === "custom" && (
                <span className="flex items-center gap-1 text-xs font-bold text-slate-600 dark:text-slate-300">
                  <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} aria-label="Start date"
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800" />
                  <span>–</span>
                  <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} aria-label="End date"
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800" />
                </span>
              )}
            </div>
          </div>
          <p className="mt-2 text-sm font-bold text-slate-600 dark:text-slate-400">
            Balance: <strong className={`text-lg font-black ${balanceClass(ledger.balanceCents)}`}>{money.format(ledger.balanceCents / 100)}</strong>
            <span className="ml-2 font-normal">
              {ledger.balanceCents > 0 ? "net income" : ledger.balanceCents < 0 ? "net loss" : "break-even"}
            </span>
            <span className="ml-3 font-normal">
              In: <strong className="text-emerald-700 dark:text-emerald-400">{money.format(ledger.totalCreditCents / 100)}</strong>
              {" · "}Out: <strong className="text-slate-700 dark:text-slate-300">{money.format(ledger.totalDebitCents / 100)}</strong>
            </span>
          </p>

          {filtersActive && (
            <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
              Showing {filteredEntries.length} of {ledger.entries.length} entries.
            </p>
          )}

          {filteredEntries.length === 0
            ? <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              {ledger.entries.length === 0
                ? "No income or expenses on record for this property yet."
                : "No entries match the current filter."}
            </p>
            : <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm" data-ledger-table>
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    <th className="py-2 pr-3 font-black">Date</th>
                    <th className="py-2 pr-3 font-black">Description</th>
                    <th className="py-2 pr-3 font-black">Check #</th>
                    <th className="py-2 pr-3 text-right font-black">Debit</th>
                    <th className="py-2 pr-3 text-right font-black">Credit</th>
                    <th className="py-2 pr-3 text-right font-black">Balance</th>
                    <th className="py-2 pr-3 text-center font-black" title="Cleared">C</th>
                    <th className="py-2 pr-3 text-center font-black"><span className="sr-only">Attachments</span>📎</th>
                    <th className="py-2 font-black"><span className="sr-only">Edit</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry, entryIndex) => (
                    <tr key={entry.id} data-ledger-entry={entry.source} className={`border-b border-slate-100 dark:border-slate-800 ${entryIndex % 2 === 1 ? "bg-slate-100/70 dark:bg-slate-800/40" : ""}`}>
                      <td className={`${compactRows ? "py-1.5" : "py-2.5"} pr-3 font-bold text-slate-700 dark:text-slate-300`}>{formatDate(entry.date)}</td>
                      <td className={`${compactRows ? "py-1.5" : "py-2.5"} pr-3`}>
                        <button type="button" onClick={() => setDetailEntry(entry)}
                          title="View transaction detail"
                          className="text-left font-bold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300">
                          {entry.description}
                        </button>
                        <span className="ml-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{entry.sourceLabel}</span>
                        {entry.possibleDuplicate && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Possible duplicate</span>
                        )}
                        {showSubLine && (
                          <span className="block text-xs text-slate-500 dark:text-slate-400">
                            {[entry.payee, entry.category, entry.method ? label(entry.method) : null, entry.reference, entry.memo].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </td>
                      <td className={`${compactRows ? "py-1.5" : "py-2.5"} pr-3 font-bold text-slate-600 dark:text-slate-300`}>
                        {entry.checkNumber || <span className="font-normal text-slate-300 dark:text-slate-700">—</span>}
                      </td>
                      <td className={`${compactRows ? "py-1.5" : "py-2.5"} pr-3 text-right font-black text-slate-950 dark:text-white`}>
                        {entry.debitCents > 0 ? money.format(entry.debitCents / 100) : <span className="font-normal text-slate-300 dark:text-slate-700">—</span>}
                      </td>
                      <td className={`${compactRows ? "py-1.5" : "py-2.5"} pr-3 text-right font-black text-emerald-700 dark:text-emerald-400`}>
                        {entry.creditCents > 0 ? money.format(entry.creditCents / 100) : <span className="font-normal text-slate-300 dark:text-slate-700">—</span>}
                      </td>
                      <td className={`${compactRows ? "py-1.5" : "py-2.5"} pr-3 text-right font-black ${balanceClass(entry.balanceAfterCents)}`}>
                        {money.format(entry.balanceAfterCents / 100)}
                      </td>
                      <td className={`${compactRows ? "py-1.5" : "py-2.5"} pr-3 text-center`}>
                        {entry.cleared
                          ? <span className="font-black text-emerald-700 dark:text-emerald-400" title="Cleared">✓</span>
                          : <span className="font-normal text-slate-300 dark:text-slate-700" title="Uncleared">—</span>}
                      </td>
                      <td className={`${compactRows ? "py-1.5" : "py-2.5"} pr-3 text-center`}>
                        {entry.hasAttachment
                          ? <span title="Has attachments" aria-label="Has attachments">📎</span>
                          : <span className="font-normal text-slate-300 dark:text-slate-700">—</span>}
                      </td>
                      <td className={`${compactRows ? "py-1.5" : "py-2.5"}`}>
                        {entry.source === "manual" ? (
                          <button type="button" onClick={() => startEdit(entry)} title="Edit transaction" aria-label={`Edit ${entry.description}`}
                            className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-black text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
                            ✎
                          </button>
                        ) : (
                          <span className="font-normal text-slate-300 dark:text-slate-700">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}

          {ledger.possibleDuplicateCount > 0 && (
            <p className="mt-3 text-xs font-bold text-amber-700 dark:text-amber-400">
              {ledger.possibleDuplicateCount} entr{ledger.possibleDuplicateCount === 1 ? "y" : "ies"} flagged as possible duplicates — same amount and date from different sources. Review and delete one source if they are the same transaction.
            </p>
          )}
        </>
      )}

      {propertyId && <PropertyWorkPackages propertyId={propertyId} />}

      {detailEntry && (
        <PropertyTransactionDetailModal
          key={detailEntry.id}
          entry={detailEntry}
          properties={(properties || []).map((property) => ({ id: property.id, label: property.label }))}
          tenants={(tenants || []).map((tenant) => ({ id: tenant.id, name: tenant.display_name || tenant.name }))}
          onClose={() => { setDetailEntry(null); setEditError(""); }}
          canEdit={detailEntry.source === "manual"}
          editError={editError}
          onEdit={() => startEdit(detailEntry)}
          onDelete={() => confirmDelete(detailEntry)}
        />
      )}

      {editingEvent && (
        <TransactionForm
          propertyId={propertyId}
          properties={(properties || []).map((property) => ({ id: property.id, label: property.label }))}
          tenants={(tenants || []).map((tenant) => ({ id: tenant.id, name: tenant.display_name || tenant.name }))}
          initialEvent={editingEvent}
          onSaved={() => { setEditingEvent(null); refresh(); }}
          onCancel={() => setEditingEvent(null)}
        />
      )}

      {postKind && (
        <TransactionForm
          propertyId={propertyId}
          properties={(properties || []).map((property) => ({ id: property.id, label: property.label }))}
          tenants={(tenants || []).map((tenant) => ({ id: tenant.id, name: tenant.display_name || tenant.name }))}
          defaultKind={postKind}
          onSaved={() => { setPostKind(null); refresh(); }}
          onCancel={() => setPostKind(null)}
        />
      )}
    </section>
  );
}

// Transaction detail with edit/delete for owned manual entries. Imported and
// system entries stay read-only. Delete is a two-step inline confirm and only
// soft-deletes on the server. Manual entries load the full event so the modal
// mirrors the edit form's sections: Transaction details, Accounts,
// Attachments, plus split lines and a per-edit history ("View edits").
function PropertyTransactionDetailModal({ entry, properties = [], tenants = [], onClose, canEdit, editError, onEdit, onDelete }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [fullEvent, setFullEvent] = useState(null);
  const [eventLoading, setEventLoading] = useState(canEdit);
  const [splits, setSplits] = useState([]);
  const [splitsLoading, setSplitsLoading] = useState(canEdit);
  const [attachments, setAttachments] = useState([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(canEdit);
  const [showEdits, setShowEdits] = useState(false);
  const [edits, setEdits] = useState(null);
  const [detailError, setDetailError] = useState("");

  // Full event + splits + attachments for manual entries — fetched once when
  // the detail opens.
  useEffect(() => {
    if (!canEdit) return undefined;
    let cancelled = false;
    fetchTransaction(entry.sourceId).then(
      (event) => { if (!cancelled) { setFullEvent(event); setEventLoading(false); } },
      () => { if (!cancelled) setEventLoading(false); },
    );
    fetch(`/api/rental/transaction-splits?eventId=${encodeURIComponent(entry.sourceId)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!cancelled) setSplits(response.ok ? (body.splits || []) : []);
      })
      .catch(() => { if (!cancelled) setSplits([]); })
      .finally(() => { if (!cancelled) setSplitsLoading(false); });
    fetch(`/api/rental/transaction-attachments?eventId=${encodeURIComponent(entry.sourceId)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!cancelled) setAttachments(response.ok ? (body.attachments || []) : []);
      })
      .catch(() => { if (!cancelled) setAttachments([]); })
      .finally(() => { if (!cancelled) setAttachmentsLoading(false); });
    return () => { cancelled = true; };
  }, [canEdit, entry.sourceId]);

  // Edit history loads on demand behind the "View edits" toggle.
  useEffect(() => {
    if (!showEdits || !canEdit) return undefined;
    let cancelled = false;
    fetch(`/api/rental/transaction-edits?eventId=${encodeURIComponent(entry.sourceId)}`)
      .then(async (response) => {
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(body.error || "Unable to load the edit history.");
        setEdits(body.edits || []);
      })
      .catch((caught) => { if (!cancelled) setDetailError(caught.message); });
    return () => { cancelled = true; };
  }, [showEdits, canEdit, entry.sourceId]);

  async function downloadAttachment(attachmentId) {
    setDetailError("");
    try {
      const response = await fetch(`/api/rental/transaction-attachments?attachmentId=${encodeURIComponent(attachmentId)}&action=download`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to download the attachment.");
      window.open(body.url, "_blank", "noopener");
    } catch (caught) {
      setDetailError(caught.message);
    }
  }

  const propertyLabel = properties.find((p) => p.id === fullEvent?.propertyId)?.label
    || fullEvent?.propertyId || "—";
  const tenantName = tenants.find((t) => t.id === fullEvent?.tenantId)?.name
    || fullEvent?.tenantId || "—";
  const amount = entry.debitCents > 0 ? entry.debitCents : entry.creditCents;
  const amountLabel = entry.debitCents > 0 ? "debit" : "credit";

  const detailRows = [
    ["Date", formatDate(fullEvent?.eventDate || entry.date)],
    ["Amount", `${money.format(amount / 100)} (${amountLabel})`],
    ["Status", fullEvent ? (fullEvent.cleared ? "Cleared" : "Uncleared") : (entry.cleared ? "Cleared" : "Uncleared")],
    ["Payment method", fullEvent?.paymentMethod ? label(fullEvent.paymentMethod) : "—"],
    ["Check #", fullEvent?.checkNumber || entry.checkNumber || "—"],
    ["Display as", fullEvent?.displayAs || "—"],
    ["Ref #", fullEvent?.refNumber || "—"],
    ["Payee", fullEvent?.payee || entry.payee || "—"],
    ["Memo", fullEvent?.memo || entry.memo || "—"],
  ];
  const mailingAddress = fullEvent?.payeeMailingAddress || "";
  const accountRows = [
    ["Assigned to (vendor)", fullEvent?.assignedTo || "—"],
    ["Property", propertyLabel],
    ["Tenant", tenantName],
    ["Category", entry.category || "—"],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 print:hidden"
      onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-label={`Transaction detail: ${entry.description}`}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-black text-slate-950 dark:text-white">Transaction detail</h3>
            <p className="mt-1 text-sm font-bold text-slate-600 dark:text-slate-400">{entry.description}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close transaction detail"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-black text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">✕</button>
        </div>

        {canEdit && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-4 dark:border-slate-800">
            <button type="button" onClick={onEdit}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              Edit
            </button>
            <button type="button" onClick={() => setShowEdits((show) => !show)} aria-expanded={showEdits}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              {showEdits ? "Hide edits" : "View edits"}
            </button>
            {confirmingDelete ? (
              <>
                <span className="text-sm font-bold text-slate-600 dark:text-slate-300">Delete this transaction?</span>
                <button type="button" onClick={onDelete}
                  className="rounded-xl bg-red-700 px-4 py-2 text-sm font-black text-white transition hover:bg-red-800">
                  Confirm delete
                </button>
                <button type="button" onClick={() => setConfirmingDelete(false)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmingDelete(true)}
                className="rounded-xl border border-red-300 px-4 py-2 text-sm font-black text-red-700 transition hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40">
                Delete
              </button>
            )}
          </div>
        )}

        {eventLoading && canEdit && (
          <p className="mt-4 text-sm font-bold text-slate-400">Loading transaction details…</p>
        )}

        <div className="mt-4">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Transaction details</p>
          <dl className="mt-2 space-y-2 text-sm">
            {detailRows.map(([term, value]) => (
              <div key={term} className="flex items-baseline justify-between gap-4 border-b border-slate-100 pb-1.5 dark:border-slate-800">
                <dt className="shrink-0 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{term}</dt>
                <dd className="text-right font-bold text-slate-950 dark:text-white">{value}</dd>
              </div>
            ))}
          </dl>
          {mailingAddress && (
            <div className="mt-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
              <p className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Payee mailing address</p>
              <p className="mt-1 whitespace-pre-line font-bold text-slate-950 dark:text-white">{mailingAddress}</p>
            </div>
          )}
        </div>

        {canEdit && (
          <div className="mt-5">
            <p className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Accounts</p>
            <dl className="mt-2 space-y-2 text-sm">
              {accountRows.map(([term, value]) => (
                <div key={term} className="flex items-baseline justify-between gap-4 border-b border-slate-100 pb-1.5 dark:border-slate-800">
                  <dt className="shrink-0 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{term}</dt>
                  <dd className="text-right font-bold text-slate-950 dark:text-white">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {canEdit && !attachmentsLoading && attachments.length > 0 && (
          <div className="mt-5">
            <p className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Attachments</p>
            <ul className="mt-2 space-y-1.5">
              {attachments.map((attachment) => (
                <li key={attachment.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm dark:bg-slate-800/60">
                  <span className="truncate font-bold text-slate-700 dark:text-slate-300">📎 {attachment.filename}</span>
                  <button type="button" onClick={() => downloadAttachment(attachment.id)}
                    className="shrink-0 text-xs font-black text-sky-700 underline hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300">
                    Download
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {entry.possibleDuplicate && (
          <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            Flagged as a possible duplicate — another source recorded the same amount on the same date.
          </p>
        )}
        {canEdit && !splitsLoading && splits.length > 0 && (
          <div className="mt-5">
            <p className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Split lines</p>
            <ul className="mt-2 space-y-1.5">
              {splits.map((split) => (
                <li key={split.id} className="flex items-baseline justify-between gap-4 rounded-lg bg-slate-50 px-3 py-1.5 text-sm dark:bg-slate-800/60">
                  <span className="font-bold text-slate-700 dark:text-slate-300">
                    {label(split.normalized_category)}
                    {split.memo && <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">{split.memo}</span>}
                  </span>
                  <span className="font-black text-slate-950 dark:text-white">{money.format(Number(split.amount))}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {canEdit && showEdits && (
          <div className="mt-5">
            <p className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Edit history</p>
            {edits === null ? (
              <p className="mt-2 text-sm font-bold text-slate-400">Loading edit history…</p>
            ) : edits.length === 0 ? (
              <p className="mt-2 text-sm font-bold text-slate-500 dark:text-slate-400">No edits recorded for this transaction yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {edits.map((edit) => (
                  <li key={edit.id} className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                    <p className="text-xs font-black text-slate-500 dark:text-slate-400">
                      {formatDate(String(edit.edited_at).slice(0, 10))}{edit.edited_by ? ` · edited by ${edit.edited_by}` : ""}
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {Object.entries(edit.changes || {}).map(([field, change]) => (
                        <li key={field} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                          <span className="font-black text-slate-700 dark:text-slate-300">{EDIT_FIELD_LABELS[field] || field}:</span>
                          <span className="font-bold text-slate-500 line-through dark:text-slate-400">{formatEditValue(change.from)}</span>
                          <span className="font-black text-slate-400">→</span>
                          <span className="font-bold text-slate-950 dark:text-white">{formatEditValue(change.to)}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {detailError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{detailError}</p>}
        {editError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{editError}</p>}
      </div>
    </div>
  );
}

const EDIT_FIELD_LABELS = {
  eventDate: "Date",
  description: "Description",
  amount: "Amount",
  transactionKind: "Type",
  normalizedCategory: "Category",
  payee: "Payee",
  checkNumber: "Check #",
  bankAccountId: "Bank account",
  propertyId: "Property",
  cleared: "Cleared",
  displayAs: "Display as",
  refNumber: "Ref #",
  payeeMailingAddress: "Payee mailing address",
  assignedTo: "Assigned to (vendor)",
  isRecurring: "Recurring",
  recurrenceRule: "Repeats",
  depreciate: "Depreciate",
  memo: "Memo",
  tenantId: "Tenant",
  paymentMethod: "Payment method",
};

function formatEditValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return money.format(value);
  return String(value);
}

// Work packages assigned to this property (Residential Slice 2). Reads the
// owner-scoped work-packages list filtered by the exact canonical property
// key; the section is read-only navigation — package lifecycle actions live
// on the package pages. "New work package" lands on the create form with
// this property preselected.
function PropertyWorkPackages({ propertyId }) {
  const [load, setLoad] = useState({ slug: null, error: "", packages: null });

  // State is stamped with the slug it belongs to, so a stale result never
  // renders under a new property and no state reset is needed in the
  // effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/work-packages?propertyId=${encodeURIComponent(propertyId)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load work packages.");
        return body.packages || [];
      })
      .then((packages) => { if (!cancelled) setLoad({ slug: propertyId, error: "", packages }); })
      .catch((caught) => { if (!cancelled) setLoad({ slug: propertyId, error: caught.message, packages: null }); });
    return () => { cancelled = true; };
  }, [propertyId]);

  const loading = load.slug !== propertyId;
  const packages = loading ? null : load.packages;
  const error = loading ? "" : load.error;

  return (
    <div className="mt-8 border-t border-slate-200 pt-5 dark:border-slate-700" data-property-work-packages>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xl font-black text-slate-950 dark:text-white">
          Work packages
          {packages && (
            <span className="ml-2 align-middle text-sm font-bold text-slate-500 dark:text-slate-400">
              {packages.length} {packages.length === 1 ? "package" : "packages"}
            </span>
          )}
        </h3>
        <a
          href={`/forge/work/new?propertyId=${encodeURIComponent(propertyId)}`}
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          New work package
        </a>
      </div>

      {loading && <p className="mt-3 text-sm font-bold text-slate-400">Loading work packages…</p>}
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">
          Work packages could not be loaded ({error}).
        </p>
      )}
      {!loading && !error && packages?.length === 0 && (
        <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No work packages for this property yet. Create the first one with the property already selected.
        </p>
      )}
      {!loading && !error && packages?.length > 0 && (
        <ul className="mt-3 space-y-2">
          {packages.map((pkg) => (
            <li key={pkg.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-700">
              <a href={`/forge/work/${pkg.id}`} className="min-w-0">
                <span className="block truncate text-sm font-black text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300">
                  {pkg.code} — {pkg.title}
                </span>
              </a>
              <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {String(pkg.status || "").replace(/_/g, " ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
