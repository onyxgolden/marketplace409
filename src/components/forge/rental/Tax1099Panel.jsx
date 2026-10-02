"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Rentec parity R23 — the "Tax / 1099" surface.
// Free layer (built): recipient records (TIN stored encrypted, always masked on
// screen), tax-year aggregation from vendor payments (R3/R4) + owner
// distribution entries (manual today; R9 adapter when it merges), $600 threshold
// flagging, 1099-NEC vs 1099-MISC categorization with plain-English guidance,
// per-recipient previews, IRS-modeled export file, filing-status tracking.
// Partner layer (design only, HARD GATE): the E-filing tab always reports
// "not connected" and the submit endpoint refuses — no paid partner signups,
// no real filings. See efilePartner1099.js for what Jason would approve.
//
// Compliance: 1099 deadlines and rules change — the banner below and the
// export itself say "confirm with your CPA; this is not tax advice". The export
// file is guidance-only and NOT IRS-certified.

const TABS = [
  { id: "summary", label: "Year summary" },
  { id: "recipients", label: "Recipients" },
  { id: "previews", label: "Previews" },
  { id: "export", label: "Export" },
  { id: "status", label: "Filing status" },
  { id: "partner", label: "E-filing partner" },
];

const COMPLIANCE_NOTE =
  "Filing deadlines and rules change — confirm with your CPA; this is not tax advice. The export file is guidance-only, not IRS-certified.";

const STATUS_LABEL = { not_started: "Not started", ready: "Ready", exported: "Exported", filed_manually: "Filed manually" };
const ENTITY_LABEL = {
  individual: "Individual", sole_proprietorship: "Sole proprietorship", partnership: "Partnership",
  llc: "LLC", c_corporation: "C corporation", s_corporation: "S corporation",
  trust_estate: "Trust / estate", tax_exempt: "Tax-exempt", other: "Other",
};
const TIN_TYPE_LABEL = { ssn: "SSN", ein: "EIN", itin: "ITIN", unknown: "Unknown" };

const emptyRecipient = {
  id: null, kind: "vendor", displayName: "", entityType: "individual", tinType: "unknown",
  tin: "", linkedVendorId: "", addressLine1: "", addressLine2: "", city: "", state: "", zip: "", notes: "",
};

const emptyPayer = {
  businessName: "", tinType: "ein", tin: "", addressLine1: "", addressLine2: "",
  city: "", state: "", zip: "", contactName: "", contactPhone: "",
};

const formatMoney = (cents) => `$${(Number(cents || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

// R23 CHANGES fix — property attribution has a user-facing write path.
// Syncs an owner recipient's linked properties: POSTs newly selected links,
// DELETEs deselected ones, leaves untouched links alone (edits never wipe).
// Exported for unit tests.
export async function syncRecipientPropertyLinks(recipientId, originalIds, selectedIds) {
  const original = new Set(originalIds || []);
  const selected = new Set(selectedIds || []);
  const toAdd = [...selected].filter((id) => !original.has(id));
  const toRemove = [...original].filter((id) => !selected.has(id));
  const base = `/api/rental/1099/recipients/${encodeURIComponent(recipientId)}/properties`;
  for (const propertyId of toAdd) {
    await readJson(await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ propertyId }),
    }));
  }
  for (const propertyId of toRemove) {
    await readJson(await fetch(`${base}?propertyId=${encodeURIComponent(propertyId)}`, { method: "DELETE" }));
  }
  return { added: toAdd.length, removed: toRemove.length };
}

export default function Tax1099Panel({ initialTab = "summary" }) {
  const [tab, setTab] = useState(initialTab);
  const [taxYear, setTaxYear] = useState(() => new Date().getFullYear());
  const [summary, setSummary] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [properties, setProperties] = useState([]);
  const [payer, setPayer] = useState(null);
  const [efile, setEfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editor, setEditor] = useState(null);
  const [payerEditor, setPayerEditor] = useState(emptyPayer);
  const [previewId, setPreviewId] = useState("");
  const [entryForm, setEntryForm] = useState(null);
  const [exportResult, setExportResult] = useState(null);

  // R23 attribution-race isolation. Every property-link load captures a
  // request id; only the latest request may write into the open editor, and
  // the previous in-flight fetch is aborted. A delayed response for owner A
  // can never populate owner B's editor.
  const editorLinksRequestRef = useRef(0);
  const editorLinksAbortRef = useRef(null);

  async function loadEditorPropertyLinks(recipientId) {
    const requestId = ++editorLinksRequestRef.current;
    editorLinksAbortRef.current?.abort();
    const controller = new AbortController();
    editorLinksAbortRef.current = controller;
    setEditor((current) => (current
      ? { ...current, propertyLinksLoading: true, propertyLinksReady: false, propertyLinksError: "" }
      : current));
    try {
      const links = await readJson(await fetch(
        `/api/rental/1099/recipients/${encodeURIComponent(recipientId)}/properties`,
        { signal: controller.signal },
      ));
      if (editorLinksRequestRef.current !== requestId) return; // stale — superseded by a newer editor
      const ids = links.propertyIds || [];
      setEditor((current) => (current
        ? {
            ...current,
            linkedPropertyIds: ids,
            linkedPropertyIdsOriginal: ids,
            propertyLinksLoading: false,
            propertyLinksReady: true,
            propertyLinksError: "",
          }
        : current));
    } catch (error) {
      if (controller.signal.aborted || editorLinksRequestRef.current !== requestId) return; // stale — ignore
      setEditor((current) => (current
        ? {
            ...current,
            propertyLinksLoading: false,
            propertyLinksReady: false,
            propertyLinksError: error?.message || "Could not load this owner's attributed properties.",
          }
        : current));
    }
  }

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [summaryBody, recipientsBody, vendorsBody, payerBody, efileBody, rentalBody] = await Promise.all([
        readJson(await fetch(`/api/rental/1099/summary?taxYear=${encodeURIComponent(taxYear)}`)),
        readJson(await fetch("/api/rental/1099/recipients")),
        readJson(await fetch("/api/rental/vendors")),
        readJson(await fetch(`/api/rental/1099/payer-profile?taxYear=${encodeURIComponent(taxYear)}`)),
        readJson(await fetch("/api/rental/1099/efile-status")),
        readJson(await fetch("/api/rental")).catch(() => ({ units: [] })),
      ]);
      setSummary(summaryBody);
      setRecipients(recipientsBody.recipients || []);
      setVendors(vendorsBody.vendors || []);
      // Property attribution picker: link key is the unit's property_id slug
      // (matches financial_events.property_id for gross-rent aggregation).
      setProperties((rentalBody.units || []).filter((unit) => unit.status !== "archived"));
      setPayer(payerBody.profile);
      if (payerBody.profile) {
        const profile = payerBody.profile;
        setPayerEditor((current) => ({
          ...current,
          businessName: profile.businessName || "",
          tinType: profile.tinType || "ein",
          addressLine1: profile.addressLine1 || "", addressLine2: profile.addressLine2 || "",
          city: profile.city || "", state: profile.state || "", zip: profile.zip || "",
          contactName: profile.contactName || "", contactPhone: profile.contactPhone || "",
        }));
      }
      setEfile(efileBody.efile);
      if (!previewId && (summaryBody.rows || []).length > 0) setPreviewId(summaryBody.rows[0].recipientId);
    } catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }, [taxYear]); // eslint-disable-line react-hooks/exhaustive-deps

  // The load-on-mount pattern is the established rental-panel convention
  // (MessageTemplatesPanel etc.); the effect only refetches, it does not
  // derive state from props.
  useEffect(() => { load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect

  // Opens the recipient editor; for existing owner recipients the current
  // property links are loaded so edits preserve them (never wipe). Opening a
  // new editor invalidates any in-flight load from the previous one.
  async function openRecipientEditor(recipient) {
    editorLinksRequestRef.current += 1;
    editorLinksAbortRef.current?.abort();
    const base = recipient ? { ...emptyRecipient, ...recipient, tin: "", linkedVendorId: recipient.linkedVendorId || "" } : { ...emptyRecipient };
    const needsLinks = !!(recipient?.id && recipient.kind === "owner");
    setEditor({
      ...base,
      linkedPropertyIds: [],
      linkedPropertyIdsOriginal: [],
      propertyLinksLoading: needsLinks,
      propertyLinksReady: !needsLinks,
      propertyLinksError: "",
    });
    if (needsLinks) {
      await loadEditorPropertyLinks(recipient.id);
    }
  }

  // Switching an existing recipient's kind to owner mid-edit must load that
  // owner's links under the same isolation; switching away aborts the load.
  function handleEditorKindChange(nextKind) {
    if (!editor) return;
    if (nextKind !== "owner") {
      editorLinksRequestRef.current += 1;
      editorLinksAbortRef.current?.abort();
      setEditor({ ...editor, kind: nextKind, propertyLinksLoading: false, propertyLinksError: "" });
      return;
    }
    if (editor.id && !editor.propertyLinksReady) {
      setEditor({ ...editor, kind: nextKind, propertyLinksLoading: true, propertyLinksError: "" });
      loadEditorPropertyLinks(editor.id);
    } else {
      setEditor({ ...editor, kind: nextKind });
    }
  }

  function toggleEditorProperty(propertyId) {
    setEditor((current) => {
      if (!current) return current;
      const selected = new Set(current.linkedPropertyIds || []);
      if (selected.has(propertyId)) selected.delete(propertyId);
      else selected.add(propertyId);
      return { ...current, linkedPropertyIds: [...selected] };
    });
  }

  async function saveRecipient(event) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const payload = { ...editor };
      delete payload.linkedPropertyIds;
      delete payload.linkedPropertyIdsOriginal;
      delete payload.propertyLinksLoading;
      delete payload.propertyLinksReady;
      delete payload.propertyLinksError;
      if (!payload.tin || !payload.tin.trim()) delete payload.tin; // empty = keep existing
      const url = editor.id ? `/api/rental/1099/recipients/${encodeURIComponent(editor.id)}` : "/api/rental/1099/recipients";
      const body = await readJson(await fetch(url, {
        method: editor.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }));
      // Owner recipients: sync property attribution links (the gross-rent
      // basis for 1099-MISC Box 1). New recipients have no links yet.
      // Never sync from a failed/stale load: the diff would wipe existing
      // attribution, so the Save button stays disabled until links load.
      const recipientId = editor.id || body?.recipient?.id || body?.id;
      if (recipientId && editor.kind === "owner" && editor.propertyLinksReady) {
        await syncRecipientPropertyLinks(recipientId, editor.linkedPropertyIdsOriginal || [], editor.linkedPropertyIds || []);
      }
      setEditor(null);
      setMessage(editor.id ? "Recipient updated." : "Recipient added.");
      await load();
      return body;
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function archiveRecipient(id) {
    if (!window.confirm("Archive this recipient? Past-year filing history is kept; the recipient leaves future summaries.")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await readJson(await fetch(`/api/rental/1099/recipients/${encodeURIComponent(id)}`, { method: "DELETE" }));
      setMessage("Recipient archived.");
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function saveEntry(event) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      await readJson(await fetch("/api/rental/1099/payment-entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipientId: entryForm.recipientId,
          taxYear,
          paymentDate: entryForm.paymentDate,
          amountCents: Math.round(Number(entryForm.amountDollars) * 100),
          source: "manual",
          memo: entryForm.memo,
        }),
      }));
      setEntryForm(null);
      setMessage("Distribution entry recorded.");
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function transitionStatus(recipientId, toStatus) {
    setBusy(true); setError(""); setMessage("");
    try {
      await readJson(await fetch("/api/rental/1099/filing-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipientId, taxYear, toStatus }),
      }));
      setMessage(`Filing status → ${STATUS_LABEL[toStatus]}.`);
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function savePayer(event) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const payload = { ...payerEditor, taxYear };
      if (!payload.tin || !payload.tin.trim()) delete payload.tin;
      await readJson(await fetch("/api/rental/1099/payer-profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }));
      setMessage("Payer profile saved.");
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function downloadExport(format) {
    setBusy(true); setError(""); setMessage(""); setExportResult(null);
    try {
      const response = await fetch(`/api/rental/1099/export?taxYear=${encodeURIComponent(taxYear)}&format=${format}`);
      const disposition = response.headers.get("content-disposition") || "";
      const filename = (disposition.match(/filename="([^"]+)"/) || [])[1] || `FORGE-1099-${taxYear}.${format === "csv" ? "csv" : "txt"}`;
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Export failed.");
      }
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setExportResult({ filename, exported: response.headers.get("x-1099-exported-records"), skipped: response.headers.get("x-1099-skipped") });
      setMessage(`Export downloaded: ${filename}.`);
      await load(); // refresh filing statuses after a FIRE export
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function attemptEfile() {
    setBusy(true); setError(""); setMessage("");
    try {
      await readJson(await fetch("/api/rental/1099/efile-submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taxYear }),
      }));
    } catch (reason) { setMessage(reason.message); } // the 409 gate message lands here, by design
    finally { setBusy(false); }
  }

  const rows = summary?.rows || [];
  const totals = summary?.summary;
  // Owner recipients with no attributed properties total $0 gross rent — the
  // UI must never present them as filing-ready.
  const linkedCountByRecipient = new Map((rows || []).map((row) => [row.recipientId, row.linkedPropertyCount ?? 0]));
  const preview = rows.find((row) => row.recipientId === previewId) || null;
  const previewRecipient = recipients.find((recipient) => recipient.id === previewId) || null;

  return (
    <section aria-label="Tax / 1099">
      <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
        <strong>Not tax advice.</strong> {COMPLIANCE_NOTE}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold">Tax / 1099</h2>
        <label className="flex items-center gap-2 text-sm">
          Tax year
          <select value={taxYear} onChange={(event) => setTaxYear(Number(event.target.value))} className="rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900">
            {[taxYear - 1, taxYear, taxYear + 1].filter((value, index, all) => all.indexOf(value) === index).map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => window.print()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600">
          Print summary
        </button>
      </div>

      <nav className="mb-4 flex flex-wrap gap-2" aria-label="1099 sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            aria-pressed={tab === item.id}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === item.id ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "border border-slate-300 dark:border-slate-600"}`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {error && <p role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-100">{error}</p>}
      {message && <p className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100">{message}</p>}
      {loading && <p className="text-sm text-slate-500">Loading 1099 data…</p>}

      {tab === "summary" && (
        <div>
          {/* Static guidance — renders even before data loads. */}
          <div className="mb-4 grid gap-3 text-xs text-slate-600 dark:text-slate-300 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <strong>1099-NEC — Nonemployee compensation.</strong> The IRS uses Form 1099-NEC to report pay to people
              who worked for you but were not your employees — plumbers, electricians, lawn crews, repair contractors.
            </div>
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <strong>1099-MISC — Rents.</strong> The IRS uses Form 1099-MISC Box 1 to report rents you paid out —
              for example, rental income distributions to a property owner.
            </div>
          </div>
          {loading && <p className="text-sm text-slate-500">Loading 1099 data…</p>}
          {!loading && (
          <>
          {totals && (
            <div className="mb-4 grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <div className="text-xs uppercase text-slate-500">1099-NEC total</div>
                <div className="text-xl font-bold">{formatMoney(totals.totalsByFormType["1099-NEC"])}</div>
                <div className="text-xs text-slate-500">Vendors — nonemployee compensation, Box 1</div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <div className="text-xs uppercase text-slate-500">1099-MISC total</div>
                <div className="text-xl font-bold">{formatMoney(totals.totalsByFormType["1099-MISC"])}</div>
                <div className="text-xs text-slate-500">Owners — rents, Box 1</div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <div className="text-xs uppercase text-slate-500">Reportable</div>
                <div className="text-xl font-bold">{totals.reportableCount} of {totals.recipientCount}</div>
                <div className="text-xs text-slate-500">Recipients at/above $600</div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <div className="text-xs uppercase text-slate-500">Excluded</div>
                <div className="text-xl font-bold">{totals.belowThresholdCount + totals.corpExcludedCount}</div>
                <div className="text-xs text-slate-500">Below $600: {totals.belowThresholdCount} · Corp-excluded: {totals.corpExcludedCount}</div>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500">
                  <th className="p-2">Recipient</th><th className="p-2">Form</th><th className="p-2">Total paid</th>
                  <th className="p-2">TIN</th><th className="p-2">Flag</th><th className="p-2">Filing status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.recipientId} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="p-2 font-semibold">{row.displayName}<div className="text-xs font-normal text-slate-500">{row.kind === "owner" ? "Owner" : "Vendor"} · {ENTITY_LABEL[row.entityType] || row.entityType}</div></td>
                    <td className="p-2">{row.formType}</td>
                    <td className="p-2">{formatMoney(row.totalCents)}<div className="text-xs text-slate-500">{row.paymentCount} payment{row.paymentCount === 1 ? "" : "s"}</div></td>
                    <td className="p-2 font-mono text-xs">{row.tinMasked}</td>
                    <td className="p-2 text-xs">{row.reportable ? <span className="text-emerald-700 dark:text-emerald-300">Reportable</span> : <span className="text-amber-700 dark:text-amber-300">{row.exclusionReason}</span>}{row.kind === "owner" && (row.linkedPropertyCount ?? 0) === 0 && <div className="mt-1 font-semibold text-amber-700 dark:text-amber-300">No properties attributed — total is $0 until properties are checked on the Recipients tab.</div>}</td>
                    <td className="p-2 text-xs">{STATUS_LABEL[row.filingStatus]}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-500">No recipients yet — add them on the Recipients tab.</td></tr>}
              </tbody>
            </table>
          </div>
          </>)}
        </div>
      )}

      {!loading && tab === "recipients" && (
        <div>
          <div className="mb-3 flex gap-2">
            <button type="button" onClick={() => openRecipientEditor(null)} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white dark:bg-slate-100 dark:text-slate-900">Add recipient</button>
            <button type="button" onClick={() => setEntryForm({ recipientId: recipients[0]?.id || "", paymentDate: `${taxYear}-01-15`, amountDollars: "", memo: "" })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600" disabled={recipients.length === 0}>
              Record owner distribution
            </button>
          </div>
          {entryForm && (
            <form onSubmit={saveEntry} className="mb-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <h3 className="mb-2 font-bold">Record owner distribution (manual entry)</h3>
              <p className="mb-3 text-xs text-slate-500">Owner payouts live here until the R9 owner-statement system lands — then R9 disbursements feed this automatically.</p>
              <div className="grid gap-3 md:grid-cols-4">
                <label className="text-sm">Recipient
                  <select value={entryForm.recipientId} onChange={(event) => setEntryForm({ ...entryForm, recipientId: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900">
                    {recipients.filter((recipient) => recipient.kind === "owner").map((recipient) => <option key={recipient.id} value={recipient.id}>{recipient.displayName}</option>)}
                  </select>
                </label>
                <label className="text-sm">Payment date
                  <input type="date" value={entryForm.paymentDate} onChange={(event) => setEntryForm({ ...entryForm, paymentDate: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900" />
                </label>
                <label className="text-sm">Amount ($)
                  <input inputMode="decimal" value={entryForm.amountDollars} onChange={(event) => setEntryForm({ ...entryForm, amountDollars: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900" placeholder="1600.00" />
                </label>
                <label className="text-sm">Memo
                  <input value={entryForm.memo} onChange={(event) => setEntryForm({ ...entryForm, memo: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900" placeholder="Q1 distribution" />
                </label>
              </div>
              <div className="mt-3 flex gap-2">
                <button type="submit" disabled={busy} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">Save entry</button>
                <button type="button" onClick={() => setEntryForm(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600">Cancel</button>
              </div>
            </form>
          )}
          {editor && (
            <form onSubmit={saveRecipient} className="mb-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <h3 className="mb-2 font-bold">{editor.id ? "Edit recipient" : "Add recipient"}</h3>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-sm">Kind
                  <select value={editor.kind} onChange={(event) => handleEditorKindChange(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900">
                    <option value="vendor">Vendor → 1099-NEC</option>
                    <option value="owner">Owner → 1099-MISC</option>
                  </select>
                </label>
                <label className="text-sm md:col-span-2">Name (as it appears on the 1099)
                  <input value={editor.displayName} onChange={(event) => setEditor({ ...editor, displayName: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900" required />
                </label>
                <label className="text-sm">Entity type
                  <select value={editor.entityType} onChange={(event) => setEditor({ ...editor, entityType: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900">
                    {Object.entries(ENTITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="text-sm">TIN type
                  <select value={editor.tinType} onChange={(event) => setEditor({ ...editor, tinType: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900">
                    {Object.entries(TIN_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="text-sm">TIN (9 digits{editor.id ? " — leave blank to keep" : ""})
                  <input value={editor.tin} onChange={(event) => setEditor({ ...editor, tin: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-mono dark:border-slate-600 dark:bg-slate-900" placeholder="123-45-6789" inputMode="numeric" />
                </label>
                {editor.kind === "vendor" && (
                  <label className="text-sm">Link vendor record
                    <select value={editor.linkedVendorId} onChange={(event) => setEditor({ ...editor, linkedVendorId: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900">
                      <option value="">None — manual entries only</option>
                      {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
                    </select>
                  </label>
                )}
                {editor.kind === "owner" && (
                  <fieldset className="text-sm md:col-span-3">
                    <legend className="font-semibold">Properties for 1099-MISC Box 1 (gross rent)</legend>
                    <p className="mb-2 text-xs text-slate-500">
                      Check every property whose rental income counts toward this owner&apos;s Box 1.
                      Only income from checked properties is included — unchecked means $0 from that property.
                    </p>
                    {editor.propertyLinksLoading && (
                      <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Loading this owner&apos;s attributed properties…</p>
                    )}
                    {editor.propertyLinksError && (
                      <div className="mb-2 rounded-lg border border-red-300 bg-red-50 p-2 dark:border-red-700 dark:bg-red-950">
                        <p className="text-xs font-semibold text-red-700 dark:text-red-300">
                          Could not load this owner&apos;s attributed properties: {editor.propertyLinksError}
                        </p>
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                          Saving is paused until the links load — otherwise the save could wipe existing attribution.
                        </p>
                        <button
                          type="button"
                          onClick={() => editor.id && loadEditorPropertyLinks(editor.id)}
                          className="mt-1 rounded-lg border border-red-400 px-2 py-1 text-xs font-semibold text-red-700 dark:text-red-300"
                        >
                          Try again
                        </button>
                      </div>
                    )}
                    {!editor.propertyLinksLoading && !editor.propertyLinksError && (
                      <>
                        {properties.length === 0 && <p className="text-xs text-slate-500">No properties found in this workspace.</p>}
                        <div className="grid gap-1 md:grid-cols-2">
                          {properties.map((property) => {
                            const linkId = property.property_id || property.id;
                            const checked = (editor.linkedPropertyIds || []).includes(linkId);
                            return (
                              <label key={property.id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-700">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleEditorProperty(linkId)}
                                  disabled={editor.propertyLinksLoading || !!editor.propertyLinksError}
                                />
                                {property.label || linkId}
                              </label>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </fieldset>
                )}
                <label className="text-sm">Address
                  <input value={editor.addressLine1} onChange={(event) => setEditor({ ...editor, addressLine1: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900" />
                </label>
                <label className="text-sm">City
                  <input value={editor.city} onChange={(event) => setEditor({ ...editor, city: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900" />
                </label>
                <label className="text-sm">State
                  <input value={editor.state} onChange={(event) => setEditor({ ...editor, state: event.target.value })} className="mt-1 w-24 rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900" placeholder="TX" maxLength={2} />
                </label>
                <label className="text-sm">ZIP
                  <input value={editor.zip} onChange={(event) => setEditor({ ...editor, zip: event.target.value })} className="mt-1 w-32 rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900" placeholder="77001" />
                </label>
                <label className="text-sm md:col-span-3">Notes
                  <input value={editor.notes} onChange={(event) => setEditor({ ...editor, notes: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900" />
                </label>
              </div>
              <p className="mt-2 text-xs text-slate-500">TINs are encrypted on the server and shown masked everywhere except the export file.</p>
              <div className="mt-3 flex gap-2">
                <button type="submit" disabled={busy || (editor.kind === "owner" && !!editor.id && !editor.propertyLinksReady)} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">Save recipient</button>
                <button type="button" onClick={() => setEditor(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600">Cancel</button>
              </div>
            </form>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500">
                  <th className="p-2">Recipient</th><th className="p-2">Form</th><th className="p-2">Entity</th>
                  <th className="p-2">TIN</th><th className="p-2">Properties</th><th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((recipient) => (
                  <tr key={recipient.id} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="p-2 font-semibold">{recipient.displayName}<div className="text-xs font-normal text-slate-500">{recipient.kind === "owner" ? "Owner" : "Vendor"}{recipient.city ? ` · ${recipient.city}, ${recipient.state || ""}` : ""}</div></td>
                    <td className="p-2">{recipient.kind === "owner" ? "1099-MISC" : "1099-NEC"}</td>
                    <td className="p-2">{ENTITY_LABEL[recipient.entityType] || recipient.entityType}</td>
                    <td className="p-2 font-mono text-xs">{recipient.tinMasked}</td>
                    <td className="p-2 text-xs">
                      {recipient.kind === "owner" ? (
                        (linkedCountByRecipient.get(recipient.id) ?? 0) === 0 ? (
                          <span className="font-semibold text-amber-700 dark:text-amber-300">No properties attributed — Box 1 will be $0. Edit to check properties.</span>
                        ) : (
                          <span>{linkedCountByRecipient.get(recipient.id)} propert{(linkedCountByRecipient.get(recipient.id) ?? 0) === 1 ? "y" : "ies"}</span>
                        )
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="p-2">
                      <div className="flex gap-2">
                        <button type="button" onClick={() => openRecipientEditor(recipient)} className="text-xs underline">Edit</button>
                        <button type="button" onClick={() => archiveRecipient(recipient.id)} className="text-xs text-red-600 underline dark:text-red-400">Archive</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {recipients.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-500">No recipients yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && tab === "previews" && (
        <div>
          <label className="mb-3 flex items-center gap-2 text-sm">Recipient
            <select value={previewId} onChange={(event) => setPreviewId(event.target.value)} className="rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900">
              {rows.map((row) => <option key={row.recipientId} value={row.recipientId}>{row.displayName} — {row.formType}</option>)}
            </select>
          </label>
          {preview && (
            <div className="max-w-xl rounded-xl border-2 border-slate-800 p-6 dark:border-slate-200">
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <div className="text-lg font-bold">Form {preview.formType}</div>
                  <div className="text-sm text-slate-500">{preview.formBox} · Tax year {taxYear}</div>
                </div>
                <div className="text-right text-sm">
                  <div className="font-semibold">PAYER</div>
                  <div>{payer?.businessName || "— payer profile not set —"}</div>
                  <div className="font-mono text-xs">{payer?.tinMasked || ""}</div>
                </div>
              </div>
              <div className="mb-4 grid gap-2 text-sm">
                <div><span className="text-slate-500">Recipient:</span> <strong>{preview.displayName}</strong></div>
                <div><span className="text-slate-500">TIN:</span> <span className="font-mono">{preview.tinMasked}</span> <span className="text-xs text-slate-500">(full value appears only in the export file)</span></div>
                {previewRecipient?.addressLine1 && <div><span className="text-slate-500">Address:</span> {previewRecipient.addressLine1}{previewRecipient.city ? `, ${previewRecipient.city}, ${previewRecipient.state || ""} ${previewRecipient.zip || ""}` : ""}</div>}
                <div><span className="text-slate-500">Entity:</span> {ENTITY_LABEL[preview.entityType] || preview.entityType}</div>
              </div>
              <div className="rounded-lg bg-slate-100 p-4 dark:bg-slate-800">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm">{preview.formBox}</span>
                  <span className="text-2xl font-bold">{formatMoney(preview.totalCents)}</span>
                </div>
                <div className="mt-1 text-xs text-slate-500">{preview.paymentCount} reportable payment{preview.paymentCount === 1 ? "" : "s"} in {taxYear}</div>
              </div>
              {!preview.reportable && <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">{preview.exclusionReason}</p>}
              {preview.kind === "owner" && (preview.linkedPropertyCount ?? 0) === 0 && (
                <p className="mt-3 text-sm font-semibold text-amber-700 dark:text-amber-300">
                  No properties are attributed to this owner — Box 1 is $0 until you check properties on the Recipients tab. This recipient is not ready for filing.
                </p>
              )}
              {!preview.tinOnFile && <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">No TIN on file — collect the W-9 TIN before this recipient can be exported.</p>}
              <p className="mt-4 text-xs text-slate-500">{COMPLIANCE_NOTE}</p>
            </div>
          )}
          {!preview && <p className="text-sm text-slate-500">No recipients to preview.</p>}
        </div>
      )}

      {!loading && tab === "export" && (
        <div>
          <h3 className="mb-2 font-bold">Payer profile ({taxYear})</h3>
          <p className="mb-3 text-xs text-slate-500">Your business identity as it appears on the 1099s. TIN is encrypted on the server and masked everywhere except the export file.</p>
          <form onSubmit={savePayer} className="mb-6 grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-3 dark:border-slate-700">
            <label className="text-sm md:col-span-2">Business name
              <input value={payerEditor.businessName} onChange={(event) => setPayerEditor({ ...payerEditor, businessName: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900" required />
            </label>
            <label className="text-sm">TIN type
              <select value={payerEditor.tinType} onChange={(event) => setPayerEditor({ ...payerEditor, tinType: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900">
                <option value="ein">EIN</option><option value="ssn">SSN</option><option value="unknown">Unknown</option>
              </select>
            </label>
            <label className="text-sm">TIN (9 digits{payer?.tinOnFile ? " — leave blank to keep" : ""})
              <input value={payerEditor.tin} onChange={(event) => setPayerEditor({ ...payerEditor, tin: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-mono dark:border-slate-600 dark:bg-slate-900" placeholder={payer?.tinMasked || "12-3456789"} inputMode="numeric" />
            </label>
            <label className="text-sm">Address
              <input value={payerEditor.addressLine1} onChange={(event) => setPayerEditor({ ...payerEditor, addressLine1: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900" />
            </label>
            <label className="text-sm">City
              <input value={payerEditor.city} onChange={(event) => setPayerEditor({ ...payerEditor, city: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900" />
            </label>
            <label className="text-sm">State
              <input value={payerEditor.state} onChange={(event) => setPayerEditor({ ...payerEditor, state: event.target.value })} className="mt-1 w-24 rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900" maxLength={2} />
            </label>
            <label className="text-sm">ZIP
              <input value={payerEditor.zip} onChange={(event) => setPayerEditor({ ...payerEditor, zip: event.target.value })} className="mt-1 w-32 rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900" />
            </label>
            <div className="md:col-span-3">
              <button type="submit" disabled={busy} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">Save payer profile</button>
            </div>
          </form>

          <h3 className="mb-2 font-bold">Download</h3>
          <div className="mb-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => downloadExport("fire")} disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
              Download FIRE-format file
            </button>
            <button type="button" onClick={() => downloadExport("csv")} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-600">
              Download CSV summary
            </button>
          </div>
          {exportResult && (
            <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
              {exportResult.filename}: {exportResult.exported} payee records, {exportResult.skipped} skipped (no TIN on file).
            </p>
          )}
          <div className="rounded-xl border border-slate-200 p-4 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
            <strong>About this file.</strong> The FIRE-format file is a fixed-width electronic file modeled on IRS Publication 1220 —
            the shape the IRS FIRE system and most e-filing partners ingest. It is <strong>not IRS-certified</strong>;
            your CPA must validate it against the current-year Pub 1220 before any real filing. The CSV summary carries
            masked TINs for eyeballing. Format spec: <code>src/application/rental/IRS_FIRE_FORMAT.md</code>.
          </div>
        </div>
      )}

      {!loading && tab === "status" && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500">
                <th className="p-2">Recipient</th><th className="p-2">Form</th><th className="p-2">Reportable</th><th className="p-2">Status</th><th className="p-2">Move to</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <StatusRow key={row.recipientId} row={row} busy={busy} onTransition={transitionStatus} />
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-slate-500">No recipients yet.</td></tr>}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">
            Status machine: Not started → Ready → Exported → Filed manually. Ready can reset to Not started;
            Exported can return to Ready (re-export). Filed manually is terminal. Exporting the FIRE file moves
            included recipients to Exported automatically.
          </p>
        </div>
      )}

      {tab === "partner" && (
        <div className="max-w-2xl">
          {/* Static gate panel — renders even before data loads: the stub is
              always "not connected" by design. */}
          <div className="mb-4 rounded-xl border border-slate-300 bg-slate-100 p-5 dark:border-slate-600 dark:bg-slate-800">
            <div className="text-lg font-bold">E-file: not connected — export and file manually.</div>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              The e-filing partner integration is designed but hard-gated: no partner is signed up, contacted, or paid.
              For now, download the FIRE-format file on the Export tab and file manually or hand it to your CPA.
            </p>
          </div>
          <h3 className="mb-2 font-bold">What Jason would need to approve before e-filing goes live</h3>
          <ul className="mb-4 list-disc pl-5 text-sm">
            {(efile?.approvalChecklist || ["Partner choice", "Per-filing cost", "Secure Vault credentials + TCC", "CPA verification"]).map((item) => <li key={item} className="mb-1">{item}</li>)}
          </ul>
          <button type="button" onClick={attemptEfile} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-50 dark:border-slate-600">
            Try e-file submission (expected: refused)
          </button>
          <p className="mt-2 text-xs text-slate-500">The submit endpoint always refuses with the gate message and makes no network call.</p>
        </div>
      )}
    </section>
  );
}

const NEXT_STATUSES = {
  not_started: ["ready"],
  ready: ["exported", "not_started"],
  exported: ["filed_manually", "ready"],
  filed_manually: [],
};

function StatusRow({ row, busy, onTransition }) {
  const options = NEXT_STATUSES[row.filingStatus] || [];
  return (
    <tr className="border-t border-slate-200 dark:border-slate-700">
      <td className="p-2 font-semibold">{row.displayName}</td>
      <td className="p-2">{row.formType}</td>
      <td className="p-2 text-xs">{row.reportable ? "Yes" : "No"}</td>
      <td className="p-2 text-xs font-semibold">{STATUS_LABEL[row.filingStatus]}</td>
      <td className="p-2">
        <div className="flex flex-wrap gap-2">
          {options.map((to) => (
            <button key={to} type="button" disabled={busy} onClick={() => onTransition(row.recipientId, to)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-slate-600">
              → {STATUS_LABEL[to]}
            </button>
          ))}
          {options.length === 0 && <span className="text-xs text-slate-500">Terminal</span>}
        </div>
      </td>
    </tr>
  );
}
