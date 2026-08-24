"use client";
import { useCallback, useEffect, useState } from "react";
import RentalRecordBrowser from "./RentalRecordBrowser";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { compressImageFile } from "./compressImageFile";

const label = (value) => value?.replaceAll("_", " ") || "—";
const identity = (value) => value;

const CATEGORY_OPTIONS = [
  ["lease", "Lease"], ["addendum", "Addendum"], ["notice", "Notice"], ["inspection", "Inspection"], ["receipt", "Receipt"],
  ["survey_plat", "Survey / Plat"], ["deed", "Deed"], ["title_policy", "Title Policy"], ["insurance_policy", "Insurance Policy"],
  ["tax_document", "Tax Document"], ["appraisal", "Appraisal"], ["permit", "Permit"], ["warranty", "Warranty"], ["hoa_document", "HOA Document"],
  ["other", "Other"],
];

const EXPIRATION_BADGE = {
  expired: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  expiring_soon: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  current: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
};
const EXPIRATION_TEXT = { expired: "Expired", expiring_soon: "Expiring soon", current: "Current" };

export default function RentalDocumentsPanel({ initialData = null, dataScope = identity, recordContext = null }) {
  const propertyId = recordContext?.propertyId || null;
  const [documents, setDocuments] = useState(initialData?.documents || []);
  const [schedules, setSchedules] = useState(initialData?.schedules || []);
  const [selectedId, setSelectedId] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [versionOf, setVersionOf] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [versions, setVersions] = useState(null);
  const [auditLog, setAuditLog] = useState(null);

  const load = useCallback(() => Promise.all([fetch("/api/rental/documents"), fetch("/api/rental")]).then(async ([documentResponse, rentalResponse]) => {
    const documentBody = await documentResponse.json();
    const rentalBody = await rentalResponse.json();
    if (!documentResponse.ok) throw new Error(documentBody.error);
    if (!rentalResponse.ok) throw new Error(rentalBody.error);
    const scoped = dataScope({ ...rentalBody, documents: documentBody.documents || [] });
    setDocuments(scoped.documents || []);
    setSchedules(scoped.schedules || []);
  }), [dataScope]);

  useEffect(() => { if (!initialData) load().catch((reason) => setError(reason.message)); }, [initialData, load]);

  async function runSearch(event) {
    event.preventDefault();
    setError("");
    if (!searchTerm.trim()) { setSearchResults(null); return; }
    try {
      const params = new URLSearchParams({ q: searchTerm.trim() });
      if (propertyId) params.set("propertyId", propertyId);
      const response = await fetch(`/api/rental/documents?${params}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setSearchResults(body.documents || []);
    } catch (reason) { setError(reason.message); }
  }
  function clearSearch() { setSearchTerm(""); setSearchResults(null); }

  const visibleDocuments = searchResults ?? documents;
  const activeId = visibleDocuments.some((item) => item.id === selectedId) ? selectedId : visibleDocuments[0]?.id || "";
  const selected = visibleDocuments.find((item) => item.id === activeId);

  async function upload(event) {
    event.preventDefault();
    setError(""); setMessage("");
    const element = event.currentTarget;
    const form = new FormData(element);
    form.set("tenantVisible", form.get("tenantVisible") === "on" ? "true" : "false");
    if (!form.get("leaseId") && propertyId) form.set("propertyId", propertyId);
    if (versionOf) form.set("versionOfDocumentId", versionOf.id);
    const originalFile = form.get("file");
    if (originalFile instanceof File) {
      // A phone-camera photo of a paper document routinely exceeds the platform's request body
      // limit before it ever reaches this app's own (larger) file-size check. Downscaling/
      // re-encoding client-side fixes the actual failure mode without lowering what the app
      // otherwise supports for normal PDFs and already-reasonable images.
      form.set("file", await compressImageFile(originalFile));
    }
    try {
      const response = await fetch("/api/rental/documents", { method: "POST", body: form });
      // A platform-level rejection (e.g. 413 Request Entity Too Large) returns plain text, not
      // JSON -- response.json() would throw its own confusing parse error instead of surfacing
      // what actually happened.
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || (response.status === 413 ? "That file is too large to upload, even after compression." : `Upload failed (${response.status}).`));
      element.reset();
      await load();
      setShowUpload(false);
      setMessage(versionOf ? "New version uploaded. The prior version is preserved and still accessible." : "Document uploaded.");
      setVersionOf(null);
    } catch (reason) { setError(reason.message); }
  }

  function startVersionUpload(document) {
    setVersionOf(document); setShowUpload(true); setError(""); setMessage("");
  }
  function startFreshUpload() {
    setVersionOf(null); setShowUpload((value) => !value);
  }

  async function openDocument(documentId, action) {
    setError("");
    try {
      const response = await fetch(`/api/rental/documents?documentId=${encodeURIComponent(documentId)}&action=${action}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      window.open(body.url, "_blank", "noreferrer");
    } catch (reason) { setError(reason.message); }
  }

  async function removeDocument(documentId) {
    if (!window.confirm("Remove this document? The file and its history remain recoverable; it will no longer appear in the library.")) return;
    setError(""); setMessage("");
    try {
      const response = await fetch(`/api/rental/documents?documentId=${encodeURIComponent(documentId)}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      await load();
      setMessage("Document removed.");
    } catch (reason) { setError(reason.message); }
  }

  async function loadVersions(documentId) {
    setError(""); setAuditLog(null);
    try {
      const response = await fetch(`/api/rental/documents?versionsOf=${encodeURIComponent(documentId)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setVersions({ rootId: documentId, list: body.versions || [] });
    } catch (reason) { setError(reason.message); }
  }

  async function loadAuditLog(documentId) {
    setError(""); setVersions(null);
    try {
      const response = await fetch(`/api/rental/documents?auditFor=${encodeURIComponent(documentId)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setAuditLog({ rootId: documentId, list: body.auditLog || [] });
    } catch (reason) { setError(reason.message); }
  }

  return <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900" data-rental-documents-panel>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Document library</p>
        <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">
          {propertyId ? `Documents — ${propertyId}` : "Lease documents and notices"}
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Records stay private unless explicitly published to the tenant portal. One authoritative record per document — Financial FORGE, inspections, maintenance, and leases all reference the same library.</p>
      </div>
      <button type="button" onClick={startFreshUpload} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${goldControlClassName}`}>
        {showUpload && !versionOf ? "Cancel upload" : "Upload document"}
      </button>
    </div>

    {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null}
    {message ? <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">{message}</p> : null}

    <form onSubmit={runSearch} className="mt-6 flex flex-wrap gap-2" role="search">
      <label className="sr-only" htmlFor="rental-document-search">Search documents</label>
      <input id="rental-document-search" type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)}
        placeholder="Search document text, titles, and descriptions…"
        className="min-w-[16rem] flex-1 rounded-lg border border-slate-300 bg-white p-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
      <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 dark:border-slate-600 dark:text-slate-200">Search</button>
      {searchResults ? <button type="button" onClick={clearSearch} className="rounded-lg px-4 py-2 text-sm font-bold text-sky-700 dark:text-sky-400">Clear</button> : null}
    </form>
    {searchResults ? <p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{searchResults.length} result(s) for "{searchTerm}"</p> : null}

    {showUpload ? <form aria-label={versionOf ? `Upload a new version of ${versionOf.title}` : "Upload rental document"} onSubmit={upload}
      className="mt-6 grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40 md:grid-cols-2">
      {versionOf ? <p className="rounded-lg bg-sky-50 p-3 text-sm font-bold text-sky-950 dark:bg-sky-950/30 dark:text-sky-200 md:col-span-2">
        New version of "{versionOf.title}". The current file is preserved and stays accessible in version history.
      </p> : null}
      <label className="text-sm font-bold text-slate-900 dark:text-white">Lease (leave blank for a property-level document)
        <select name="leaseId" defaultValue="" required={!propertyId} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white">
          <option value="">{propertyId ? "None — property document" : "Select a lease"}</option>
          {schedules.map((schedule) => <option key={schedule.id} value={schedule.lease_id}>{schedule.lease_id}</option>)}
        </select>
      </label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Category
        <select name="category" required defaultValue={versionOf?.category || (propertyId ? "survey_plat" : "lease")}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white">
          {CATEGORY_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
      </label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Document title
        <input name="title" required defaultValue={versionOf?.title || ""} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white" placeholder="Survey / plat" />
      </label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Document date (optional)
        <input name="documentDate" type="date" className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
      </label>
      <label className="text-sm font-bold text-slate-900 dark:text-white md:col-span-2">Description (optional)
        <textarea name="description" rows={2} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
      </label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Expires (optional — enables an expiration reminder badge)
        <input name="expiresAt" type="date" className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
      </label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">File (PDF, JPG, PNG, or text — up to 10 MB)
        <input name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,.txt" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-3 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
      </label>
      <label className="flex items-center gap-3 rounded-lg bg-sky-50 p-4 text-sm font-bold text-sky-950 dark:bg-sky-950/30 dark:text-sky-200 md:col-span-2">
        <input type="checkbox" name="tenantVisible" /> Publish this document to the tenant portal (only available for a document attached to a lease)
      </label>
      <button className={`rounded-lg px-5 py-3 text-sm font-bold transition md:col-span-2 ${goldControlClassName}`}>{versionOf ? "Upload new version" : "Upload document"}</button>
    </form> : null}

    <div className="mt-6">
      <RentalRecordBrowser title="Rental documents" records={visibleDocuments} selectedId={activeId} onSelect={(id) => { setSelectedId(id); setVersions(null); setAuditLog(null); }}
        getTitle={(item) => item.title} getSubtitle={(item) => `${label(item.category)} · ${item.tenant_visible ? "Published" : "Private"}${item.expiration_status ? ` · ${EXPIRATION_TEXT[item.expiration_status]}` : ""}`}
        emptyMessage="No rental documents uploaded.">
        {!selected ? <p className="text-sm text-slate-500 dark:text-slate-400">Select a document to review its details, versions, and audit trail.</p> : <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Selected document</p>
          <h3 className="mt-2 text-xl font-black text-slate-950 dark:text-white">{selected.title}</h3>
          {selected.expiration_status ? <span className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-black uppercase ${EXPIRATION_BADGE[selected.expiration_status]}`}>
            {EXPIRATION_TEXT[selected.expiration_status]}{selected.expires_at ? ` · ${new Date(`${selected.expires_at}T00:00:00Z`).toLocaleDateString()}` : ""}
          </span> : null}
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <Fact term="Category" value={label(selected.category)} />
            <Fact term="Publication" value={selected.property_id && !selected.lease_id ? "Property document (not publishable)" : selected.tenant_visible ? "Visible to tenant" : "Private to landlord"} />
            <Fact term={selected.property_id && !selected.lease_id ? "Property" : "Lease"} value={selected.property_id && !selected.lease_id ? selected.property_id : selected.lease_id} />
            <Fact term="Version" value={`v${selected.version_number}${selected.is_current_version ? " (current)" : ""}`} />
            <Fact term="Document date" value={selected.document_date ? new Date(`${selected.document_date}T00:00:00Z`).toLocaleDateString() : "Not recorded"} />
            <Fact term="Uploaded" value={selected.created_at ? new Date(selected.created_at).toLocaleDateString() : "—"} />
            <Fact term="File" value={selected.original_filename} />
            <Fact term="Acknowledgements" value={String(selected.acknowledgements?.length || 0)} />
          </dl>
          {selected.description ? <p className="mt-4 text-sm text-slate-700 dark:text-slate-300">{selected.description}</p> : null}
          {selected.tenant_visible ? <p className="mt-5 rounded-xl bg-sky-50 p-3 text-sm font-bold text-sky-900 dark:bg-sky-950/30 dark:text-sky-200">Published to the tenant portal{selected.published_at ? ` on ${new Date(selected.published_at).toLocaleDateString()}` : ""}.</p>
            : <p className="mt-5 rounded-xl bg-slate-100 p-3 text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">Private. The tenant cannot access this document.</p>}
          <div className="mt-5">
            <h4 className="font-black text-slate-950 dark:text-white">Tenant acknowledgements</h4>
            {selected.acknowledgements?.length ? selected.acknowledgements.map((item) => <p key={`${item.tenant_id}:${item.acknowledged_at}`} className="mt-2 text-sm text-slate-700 dark:text-slate-300">Acknowledged {new Date(item.acknowledged_at).toLocaleString()}</p>)
              : <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No tenant acknowledgement recorded.</p>}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" onClick={() => openDocument(selected.id, "preview")} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-sky-700 transition hover:bg-sky-50 dark:border-slate-600 dark:text-sky-400 dark:hover:bg-slate-800">Preview</button>
            <button type="button" onClick={() => openDocument(selected.id, "download")} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-sky-700 transition hover:bg-sky-50 dark:border-slate-600 dark:text-sky-400 dark:hover:bg-slate-800">Download</button>
            <button type="button" onClick={() => startVersionUpload(selected)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">Upload new version</button>
            <button type="button" onClick={() => loadVersions(selected.version_of_document_id || selected.id)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">Version history</button>
            <button type="button" onClick={() => loadAuditLog(selected.version_of_document_id || selected.id)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">Audit trail</button>
            <button type="button" onClick={() => removeDocument(selected.id)} className="rounded-xl border border-red-300 px-4 py-2 text-sm font-bold text-red-700 transition hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30">Remove</button>
          </div>
          {versions ? <div className="mt-6 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <h4 className="font-black text-slate-950 dark:text-white">Version history</h4>
            <ul className="mt-3 space-y-2">
              {versions.list.map((version) => <li key={version.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-bold text-slate-800 dark:text-slate-200">v{version.version_number}{version.is_current_version ? " (current)" : ""} — {version.original_filename}</span>
                <span className="text-slate-500 dark:text-slate-400">{new Date(version.created_at).toLocaleString()}</span>
              </li>)}
            </ul>
          </div> : null}
          {auditLog ? <div className="mt-6 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <h4 className="font-black text-slate-950 dark:text-white">Audit trail</h4>
            <ul className="mt-3 space-y-2">
              {auditLog.list.map((entry) => <li key={entry.id} className="text-sm text-slate-700 dark:text-slate-300">
                <span className="font-bold capitalize">{entry.action.replaceAll("_", " ")}</span> by {entry.actor_role} on {new Date(entry.created_at).toLocaleString()}
              </li>)}
              {auditLog.list.length === 0 ? <li className="text-sm text-slate-500 dark:text-slate-400">No audit history recorded.</li> : null}
            </ul>
          </div> : null}
        </div>}
      </RentalRecordBrowser>
    </div>
  </section>;
}
function Fact({ term, value }) { return <div><dt className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">{term}</dt><dd className="mt-1 break-words font-bold capitalize text-slate-900 dark:text-white">{value || "—"}</dd></div>; }
