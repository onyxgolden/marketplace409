"use client";
import { useCallback, useEffect, useState } from "react";

// Rentec parity R21 — public listings + application-form builder + the
// syndication surface (free layer). Tabs:
//   Listings          — every listing with publish/unpublish, preview, link
//   Vacant units      — units with status 'available', "New listing" per unit
//   Application forms — the builder (sections, fee, custom questions)
//   Syndication       — RSS feed URL, copy-paste pack, the gated site catalog
//
// Auto-posting stays a hard gate: the "Try auto-post" button exists only to
// demonstrate that the stub refuses (501 not_connected). No money, no API
// signups, no real posts — see src/domains/rental-listings/SYNDICATION_GATE.md.

const STATUS_LABEL = { draft: "Draft", published: "Published", unpublished: "Unpublished" };
const STATUS_CLASS = {
  draft: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300",
  published: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  unpublished: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
};
const inputClass = "rounded-xl border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white";
const goldControlClass = "bg-amber-400 text-slate-950 hover:bg-amber-300";

const emptyListing = {
  id: null, unitId: "", title: "", description: "", rentCents: "", bedsDisplay: "",
  bathsDisplay: "", petPolicy: "", availableAt: "", contactEmail: "", contactPhone: "", listingFormId: "",
};

function money(cents) {
  if (cents === null || cents === undefined) return "—";
  return `$${(Number(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

export default function ListingsPanel() {
  const [tab, setTab] = useState("listings");
  const [listings, setListings] = useState([]);
  const [units, setUnits] = useState([]);
  const [forms, setForms] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [listingEditor, setListingEditor] = useState(null);
  const [formEditor, setFormEditor] = useState(null);
  const [packListingId, setPackListingId] = useState("");
  const [pack, setPack] = useState(null);
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [listingsRes, unitsRes, formsRes, sitesRes] = await Promise.all([
        fetch("/api/rental/listings"),
        fetch("/api/rental"),
        fetch("/api/rental/application-forms"),
        fetch("/api/rental/syndication"),
      ]);
      const listingsBody = await listingsRes.json();
      if (!listingsRes.ok) throw new Error(listingsBody.error || "Unable to load listings.");
      setListings(listingsBody.listings || []);
      const unitsBody = await unitsRes.json();
      if (unitsRes.ok) setUnits((unitsBody.units || []).filter((unit) => unit.status === "available"));
      const formsBody = await formsRes.json();
      if (formsRes.ok) setForms(formsBody.forms || []);
      const sitesBody = await sitesRes.json();
      if (sitesRes.ok) setSites(sitesBody.sites || []);
    } catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch when the panel opens.
  useEffect(() => { load(); }, [load]);

  function openListingEditor(listing, unitId) {
    setListingEditor(listing ? {
      id: listing.id, unitId: listing.unitId, title: listing.title, description: listing.description || "",
      rentCents: listing.rentCents ?? "", bedsDisplay: listing.bedsDisplay || "", bathsDisplay: listing.bathsDisplay || "",
      petPolicy: listing.petPolicy || "", availableAt: listing.availableAt ? listing.availableAt.slice(0, 10) : "",
      contactEmail: listing.contactEmail || "", contactPhone: listing.contactPhone || "",
      listingFormId: listing.listingFormId || "",
    } : { ...emptyListing, unitId: unitId || "" });
  }

  async function saveListing(event) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const payload = {
        listing: {
          unitId: listingEditor.unitId, title: listingEditor.title, description: listingEditor.description,
          rentCents: listingEditor.rentCents === "" ? null : Number(listingEditor.rentCents),
          bedsDisplay: listingEditor.bedsDisplay, bathsDisplay: listingEditor.bathsDisplay,
          petPolicy: listingEditor.petPolicy, availableAt: listingEditor.availableAt || null,
          contactEmail: listingEditor.contactEmail, contactPhone: listingEditor.contactPhone,
          listingFormId: listingEditor.listingFormId || null,
        },
      };
      const url = listingEditor.id ? `/api/rental/listings/${encodeURIComponent(listingEditor.id)}` : "/api/rental/listings";
      const response = await fetch(url, { method: listingEditor.id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save the listing.");
      setListingEditor(null); setMessage(`Listing "${result.listing.title}" saved.`);
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function setStatus(listing, status) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/rental/listings/${encodeURIComponent(listing.id)}`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ listing: { status } }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to change the listing status.");
      setMessage(`Listing ${status === "published" ? "published" : "unpublished"}.`);
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function deleteListing(listing) {
    if (!window.confirm(`Delete the listing "${listing.title}"? Applications are never deleted this way.`)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/rental/listings/${encodeURIComponent(listing.id)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to delete the listing.");
      setMessage("Listing deleted."); await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  function copyLink(slug) {
    const url = `${window.location.origin}/rentals/${slug}`;
    navigator.clipboard?.writeText(url).then(() => { setCopied(slug); setTimeout(() => setCopied(""), 2000); });
  }

  function openFormEditor(form) {
    setFormEditor(form ? {
      id: form.id, name: form.name, isDefault: form.isDefault,
      sections: { ...form.sections }, feeAmountCents: form.feeAmountCents ?? 0,
      consentText: form.consentText || "", customQuestions: form.customQuestions || [],
      newKey: "", newLabel: "", newType: "text", newRequired: false, newOptions: "",
    } : {
      id: null, name: "", isDefault: false,
      sections: { personal_info: true, residence_history: true, employment: true, references: true },
      feeAmountCents: 0, consentText: "", customQuestions: [],
      newKey: "", newLabel: "", newType: "text", newRequired: false, newOptions: "",
    });
  }

  function addCustomQuestion() {
    const key = formEditor.newKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!key || !formEditor.newLabel.trim()) { setError("A custom question needs a key and a label."); return; }
    if (formEditor.customQuestions.some((q) => q.key === key)) { setError(`Question key "${key}" is already used.`); return; }
    const question = { key, label: formEditor.newLabel.trim(), type: formEditor.newType, required: formEditor.newRequired };
    if (formEditor.newType === "select") {
      const options = formEditor.newOptions.split(",").map((o) => o.trim()).filter(Boolean);
      if (options.length < 2) { setError("A select question needs at least two options (comma-separated)."); return; }
      question.options = options;
    }
    setFormEditor({ ...formEditor, customQuestions: [...formEditor.customQuestions, question], newKey: "", newLabel: "", newType: "text", newRequired: false, newOptions: "" });
    setError("");
  }

  async function saveForm(event) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const payload = {
        form: {
          name: formEditor.name, sections: formEditor.sections, feeAmountCents: Number(formEditor.feeAmountCents) || 0,
          consentText: formEditor.consentText, customQuestions: formEditor.customQuestions,
        },
      };
      const url = formEditor.id ? `/api/rental/application-forms/${encodeURIComponent(formEditor.id)}` : "/api/rental/application-forms";
      const response = await fetch(url, { method: formEditor.id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save the form.");
      setFormEditor(null); setMessage(`Application form "${result.form.name}" saved.`);
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function deleteForm(form) {
    if (!window.confirm(`Delete the form "${form.name}"?`)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/rental/application-forms/${encodeURIComponent(form.id)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to delete the form.");
      setMessage("Form deleted."); await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function loadPack(listingId) {
    setPackListingId(listingId); setPack(null); setError("");
    if (!listingId) return;
    try {
      const response = await fetch(`/api/rental/syndication?listingId=${encodeURIComponent(listingId)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to build the copy-paste pack.");
      setPack(result.pack);
    } catch (reason) { setError(reason.message); }
  }

  async function tryAutoPost(siteKey) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/rental/syndication", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteKey }),
      });
      const result = await response.json();
      setMessage(`Auto-post to ${result.siteName || siteKey}: ${result.status} — ${result.reason}`);
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  const tabs = [["listings", "Listings"], ["units", "Vacant units"], ["forms", "Application forms"], ["syndication", "Syndication"]];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Leasing</p>
          <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Listings &amp; applications</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Public listing pages for vacant units, the application builder, and the gated syndication layer.</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Listings sections">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${tab === id ? goldControlClass : "border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
            {label}
          </button>
        ))}
      </div>
      {error ? <p role="alert" className="mt-3 text-sm font-bold text-red-600 dark:text-red-400">{error}</p> : null}
      {message ? <p role="status" className="mt-3 text-sm font-bold text-emerald-700 dark:text-emerald-400">{message}</p> : null}
      {loading ? <p className="mt-4 text-sm text-slate-500">Loading…</p> : null}

      {!loading && tab === "listings" && (
        <div className="mt-4">
          <button type="button" onClick={() => openListingEditor(null)} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${goldControlClass}`}>New listing</button>
          <div className="mt-3 grid gap-3">
            {listings.length === 0 ? <p className="text-sm text-slate-500">No listings yet — start one from a vacant unit.</p> : null}
            {listings.map((listing) => (
              <div key={listing.id} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-black text-slate-950 dark:text-white">{listing.title}</p>
                    <p className="text-xs text-slate-500">{money(listing.rentCents)}{listing.rentCents ? "/mo" : ""}{listing.bedsDisplay ? ` · ${listing.bedsDisplay} bed` : ""}{listing.bathsDisplay ? ` · ${listing.bathsDisplay} bath` : ""} · {listing.viewCount} views</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${STATUS_CLASS[listing.status]}`}>{STATUS_LABEL[listing.status]}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => openListingEditor(listing)} disabled={busy} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Edit</button>
                  {listing.status === "published" ? (
                    <button type="button" onClick={() => setStatus(listing, "unpublished")} disabled={busy} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Unpublish</button>
                  ) : (
                    <button type="button" onClick={() => setStatus(listing, "published")} disabled={busy} className="rounded-xl border border-amber-400 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950">Publish</button>
                  )}
                  {listing.status === "published" ? (
                    <>
                      <a href={`/rentals/${listing.publicSlug}`} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Preview</a>
                      <button type="button" onClick={() => copyLink(listing.publicSlug)} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">{copied === listing.publicSlug ? "Copied!" : "Copy link"}</button>
                    </>
                  ) : null}
                  <button type="button" onClick={() => deleteListing(listing)} disabled={busy} className="rounded-xl border border-red-300 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && tab === "units" && (
        <div className="mt-4 grid gap-3">
          {units.length === 0 ? <p className="text-sm text-slate-500">No vacant units — units with status “available” appear here.</p> : null}
          {units.map((unit) => (
            <div key={unit.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div>
                <p className="font-black text-slate-950 dark:text-white">{unit.label}</p>
                <p className="text-xs text-slate-500">{unit.property_id}{unit.bedrooms ? ` · ${unit.bedrooms} bed` : ""}{unit.bathrooms ? ` · ${unit.bathrooms} bath` : ""}</p>
              </div>
              <button type="button" onClick={() => { openListingEditor(null, unit.id); setTab("listings"); }} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${goldControlClass}`}>New listing</button>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === "forms" && (
        <div className="mt-4">
          <button type="button" onClick={() => openFormEditor(null)} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${goldControlClass}`}>New form</button>
          <div className="mt-3 grid gap-3">
            {forms.map((form) => (
              <div key={form.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <div>
                  <p className="font-black text-slate-950 dark:text-white">{form.name} {form.isDefault ? <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-black text-sky-800 dark:bg-sky-900 dark:text-sky-200">Default</span> : null}</p>
                  <p className="text-xs text-slate-500">
                    {Object.entries(form.sections).filter(([, on]) => on).length} of 4 sections · {form.customQuestions.length} custom questions · fee {money(form.feeAmountCents)} (record-only)
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => openFormEditor(form)} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Edit</button>
                  {!form.isDefault ? <button type="button" onClick={() => deleteForm(form)} disabled={busy} className="rounded-xl border border-red-300 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950">Delete</button> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && tab === "syndication" && (
        <div className="mt-4 grid gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <p className="font-black text-slate-950 dark:text-white">Listing feed (RSS 2.0)</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Published listings as a standards-based feed — any feed reader or aggregator can poll it today.</p>
            <p className="mt-2 break-all font-mono text-xs text-slate-500">{typeof window !== "undefined" ? `${window.location.origin}/api/rental/syndication?format=feed` : "/api/rental/syndication?format=feed"}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <p className="font-black text-slate-950 dark:text-white">Copy-paste pack</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Ad copy + schema.org snippet to paste manually into Facebook Marketplace, Craigslist, or any site.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <select value={packListingId} onChange={(event) => loadPack(event.target.value)} className={inputClass} aria-label="Listing for copy-paste pack">
                <option value="">Select a listing…</option>
                {listings.map((listing) => <option key={listing.id} value={listing.id}>{listing.title}</option>)}
              </select>
            </div>
            {pack ? (
              <div className="mt-3">
                <textarea readOnly rows={10} value={pack.adCopy} className={`${inputClass} w-full font-mono text-xs`} aria-label="Ad copy" />
                <p className="mt-2 text-xs font-bold text-slate-500">schema.org JSON-LD:</p>
                <pre className="mt-1 max-h-48 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-emerald-200">{JSON.stringify(pack.jsonLd, null, 2)}</pre>
              </div>
            ) : null}
          </div>
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/40">
            <p className="font-black text-amber-900 dark:text-amber-200">Auto-posting is gated</p>
            <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">Syndication APIs may cost money or need partner agreements — nothing posts automatically until Jason approves each site and its cost. The button below proves the stub refuses.</p>
            <div className="mt-3 grid gap-2">
              {sites.map((site) => (
                <div key={site.siteKey} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/70 p-3 dark:bg-slate-900/70">
                  <div>
                    <p className="text-sm font-black text-slate-900 dark:text-white">{site.siteName} <span className="ml-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">{site.mode}</span></p>
                    <p className="text-xs text-slate-600 dark:text-slate-400">{site.reason}</p>
                  </div>
                  <button type="button" onClick={() => tryAutoPost(site.siteKey)} disabled={busy} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Try auto-post</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {listingEditor ? (
        <form onSubmit={saveListing} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" aria-label="Listing editor">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 dark:bg-slate-900">
            <h3 className="text-xl font-black text-slate-950 dark:text-white">{listingEditor.id ? "Edit listing" : "New listing"}</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-sm font-bold text-slate-900 dark:text-white md:col-span-2">Unit
                <select value={listingEditor.unitId} disabled={!!listingEditor.id} onChange={(e) => setListingEditor({ ...listingEditor, unitId: e.target.value })} required className={`${inputClass} mt-1 w-full`}>
                  <option value="">Select a vacant unit…</option>
                  {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.label} · {unit.property_id}</option>)}
                </select>
              </label>
              <label className="text-sm font-bold text-slate-900 dark:text-white md:col-span-2">Title
                <input value={listingEditor.title} onChange={(e) => setListingEditor({ ...listingEditor, title: e.target.value })} required className={`${inputClass} mt-1 w-full`} placeholder="Sunny 2-bed near downtown" />
              </label>
              <label className="text-sm font-bold text-slate-900 dark:text-white md:col-span-2">Description
                <textarea value={listingEditor.description} onChange={(e) => setListingEditor({ ...listingEditor, description: e.target.value })} rows={4} className={`${inputClass} mt-1 w-full`} placeholder="Fresh paint, new floors…" />
              </label>
              <label className="text-sm font-bold text-slate-900 dark:text-white">Monthly rent (cents)
                <input type="number" min="1" value={listingEditor.rentCents} onChange={(e) => setListingEditor({ ...listingEditor, rentCents: e.target.value })} className={`${inputClass} mt-1 w-full`} placeholder="160000" />
              </label>
              <label className="text-sm font-bold text-slate-900 dark:text-white">Available date
                <input type="date" value={listingEditor.availableAt} onChange={(e) => setListingEditor({ ...listingEditor, availableAt: e.target.value })} className={`${inputClass} mt-1 w-full`} />
              </label>
              <label className="text-sm font-bold text-slate-900 dark:text-white">Bedrooms
                <input value={listingEditor.bedsDisplay} onChange={(e) => setListingEditor({ ...listingEditor, bedsDisplay: e.target.value })} className={`${inputClass} mt-1 w-full`} placeholder="2" />
              </label>
              <label className="text-sm font-bold text-slate-900 dark:text-white">Bathrooms
                <input value={listingEditor.bathsDisplay} onChange={(e) => setListingEditor({ ...listingEditor, bathsDisplay: e.target.value })} className={`${inputClass} mt-1 w-full`} placeholder="1.5" />
              </label>
              <label className="text-sm font-bold text-slate-900 dark:text-white md:col-span-2">Pet policy
                <input value={listingEditor.petPolicy} onChange={(e) => setListingEditor({ ...listingEditor, petPolicy: e.target.value })} className={`${inputClass} mt-1 w-full`} placeholder="Cats and small dogs with deposit" />
              </label>
              <label className="text-sm font-bold text-slate-900 dark:text-white">Contact email
                <input type="email" value={listingEditor.contactEmail} onChange={(e) => setListingEditor({ ...listingEditor, contactEmail: e.target.value })} className={`${inputClass} mt-1 w-full`} />
              </label>
              <label className="text-sm font-bold text-slate-900 dark:text-white">Contact phone
                <input value={listingEditor.contactPhone} onChange={(e) => setListingEditor({ ...listingEditor, contactPhone: e.target.value })} className={`${inputClass} mt-1 w-full`} />
              </label>
              <label className="text-sm font-bold text-slate-900 dark:text-white md:col-span-2">Application form
                <select value={listingEditor.listingFormId} onChange={(e) => setListingEditor({ ...listingEditor, listingFormId: e.target.value })} className={`${inputClass} mt-1 w-full`}>
                  <option value="">Workspace default</option>
                  {forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setListingEditor(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 dark:border-slate-600 dark:text-slate-300">Cancel</button>
              <button type="submit" disabled={busy} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${goldControlClass}`}>Save listing</button>
            </div>
          </div>
        </form>
      ) : null}

      {formEditor ? (
        <form onSubmit={saveForm} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" aria-label="Application form editor">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 dark:bg-slate-900">
            <h3 className="text-xl font-black text-slate-950 dark:text-white">{formEditor.id ? "Edit application form" : "New application form"}</h3>
            <div className="mt-4 grid gap-3">
              <label className="text-sm font-bold text-slate-900 dark:text-white">Form name
                <input value={formEditor.name} disabled={formEditor.isDefault} onChange={(e) => setFormEditor({ ...formEditor, name: e.target.value })} required className={`${inputClass} mt-1 w-full`} />
              </label>
              <fieldset>
                <legend className="text-sm font-bold text-slate-900 dark:text-white">Sections</legend>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {[["personal_info", "Personal info"], ["residence_history", "Residence history"], ["employment", "Employment"], ["references", "References"]].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                      <input type="checkbox" checked={!!formEditor.sections[key]} onChange={(e) => setFormEditor({ ...formEditor, sections: { ...formEditor.sections, [key]: e.target.checked } })} /> {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="text-sm font-bold text-slate-900 dark:text-white">Application fee (cents, record-only — collected offline)
                <input type="number" min="0" value={formEditor.feeAmountCents} onChange={(e) => setFormEditor({ ...formEditor, feeAmountCents: e.target.value })} className={`${inputClass} mt-1 w-full`} />
              </label>
              <label className="text-sm font-bold text-slate-900 dark:text-white">Screening consent text
                <textarea value={formEditor.consentText} onChange={(e) => setFormEditor({ ...formEditor, consentText: e.target.value })} rows={3} className={`${inputClass} mt-1 w-full`} placeholder="Standard consent text is used when blank." />
              </label>
              <fieldset>
                <legend className="text-sm font-bold text-slate-900 dark:text-white">Custom questions</legend>
                <div className="mt-2 grid gap-2">
                  {formEditor.customQuestions.map((question) => (
                    <div key={question.key} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 p-2 text-sm dark:border-slate-700">
                      <span className="text-slate-700 dark:text-slate-300"><span className="font-bold">{question.label}</span> <span className="text-xs text-slate-500">({question.type}{question.required ? ", required" : ""})</span></span>
                      <button type="button" onClick={() => setFormEditor({ ...formEditor, customQuestions: formEditor.customQuestions.filter((q) => q.key !== question.key) })} className="text-xs font-bold text-red-600 hover:underline">Remove</button>
                    </div>
                  ))}
                  <div className="grid gap-2 rounded-xl border border-dashed border-slate-300 p-3 dark:border-slate-600 md:grid-cols-2">
                    <input value={formEditor.newLabel} onChange={(e) => setFormEditor({ ...formEditor, newLabel: e.target.value })} placeholder="Question label" className={inputClass} aria-label="New question label" />
                    <input value={formEditor.newKey} onChange={(e) => setFormEditor({ ...formEditor, newKey: e.target.value })} placeholder="key (a-z, 0-9, _)" className={inputClass} aria-label="New question key" />
                    <select value={formEditor.newType} onChange={(e) => setFormEditor({ ...formEditor, newType: e.target.value })} className={inputClass} aria-label="New question type">
                      <option value="text">Short text</option><option value="textarea">Long text</option>
                      <option value="select">Dropdown</option><option value="checkbox">Checkbox</option>
                    </select>
                    <input value={formEditor.newOptions} onChange={(e) => setFormEditor({ ...formEditor, newOptions: e.target.value })} placeholder="Dropdown options, comma-separated" className={inputClass} aria-label="New question options" />
                    <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 md:col-span-2">
                      <input type="checkbox" checked={formEditor.newRequired} onChange={(e) => setFormEditor({ ...formEditor, newRequired: e.target.checked })} /> Required
                    </label>
                    <button type="button" onClick={addCustomQuestion} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 md:col-span-2">Add question</button>
                  </div>
                </div>
              </fieldset>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setFormEditor(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 dark:border-slate-600 dark:text-slate-300">Cancel</button>
              <button type="submit" disabled={busy} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${goldControlClass}`}>Save form</button>
            </div>
          </div>
        </form>
      ) : null}
    </div>
  );
}
