"use client";

import { useEffect, useState } from "react";
import { DOCUMENT_KIND_SUGGESTIONS, DOCUMENT_KIND_LABELS } from "@/domains/work-management/workDocuments.js";

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const btnPrimary = `${btn} bg-slate-900 text-white hover:bg-slate-700`;
const btnGhost = `${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`;

async function openSignedUrl(documentId, action) {
  const tab = window.open("", "_blank");
  if (!tab) throw new Error("Your browser blocked the preview tab — allow pop-ups for this site and try again.");
  tab.opener = null;
  try {
    const response = await fetch(
      `/api/work-documents?documentId=${encodeURIComponent(documentId)}&action=${action}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not open the document.");
    tab.location.href = data.url;
  } catch (error) {
    tab.close();
    throw error;
  }
}

export default function DocumentLibraryClient({ initialDocuments = [] }) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [kindFilter, setKindFilter] = useState("");
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Upload form
  const [name, setName] = useState("");
  const [kind, setKind] = useState("reference");
  const [customKind, setCustomKind] = useState("");
  const [templateSourceId, setTemplateSourceId] = useState("");
  const [file, setFile] = useState(null);
  // Version form (per-row)
  const [versioningId, setVersioningId] = useState(null);
  const [versionFile, setVersionFile] = useState(null);

  const templates = documents.filter((d) => d.kind === "template" && d.is_current_version);
  const knownKinds = [...new Set(documents.map((d) => d.kind))].sort();

  async function refresh() {
    setError("");
    try {
      const params = new URLSearchParams();
      if (kindFilter) params.set("kind", kindFilter);
      if (showSuperseded) params.set("includeSuperseded", "true");
      const response = await fetch(`/api/work-documents?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load the library.");
      setDocuments(data.documents || []);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { refresh(); }, [kindFilter, showSuperseded]);

  async function onUpload(event) {
    event.preventDefault();
    if (!file) return;
    setBusy(true); setError("");
    try {
      const effectiveKind = kind === "__custom" ? customKind.trim() : kind;
      if (!effectiveKind) { setError("Name the custom kind."); return; }
      const form = new FormData();
      form.append("file", file);
      form.append("name", name.trim() || file.name);
      form.append("kind", effectiveKind);
      if (templateSourceId) form.append("templateSourceId", templateSourceId);
      const response = await fetch("/api/work-documents", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "Could not upload."); return; }
      setName(""); setKind("reference"); setCustomKind(""); setTemplateSourceId(""); setFile(null);
      event.target.reset();
      refresh();
    } finally { setBusy(false); }
  }

  async function onNewVersion(event, documentId) {
    event.preventDefault();
    if (!versionFile) return;
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.append("file", versionFile);
      form.append("name", documents.find((d) => d.id === documentId)?.name || versionFile.name);
      form.append("kind", documents.find((d) => d.id === documentId)?.kind || "reference");
      form.append("versionOfDocumentId", documentId);
      const response = await fetch("/api/work-documents", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "Could not upload the new version."); return; }
      setVersioningId(null); setVersionFile(null);
      refresh();
    } finally { setBusy(false); }
  }

  async function onDelete(documentId) {
    if (!window.confirm("Delete this document? This cannot be undone.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(
        `/api/work-documents?documentId=${encodeURIComponent(documentId)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "Could not delete."); return; }
      refresh();
    } finally { setBusy(false); }
  }

  return (
    <div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select className={`${input} w-48`} value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
          <option value="">All kinds</option>
          {knownKinds.map((k) => (
            <option key={k} value={k}>{DOCUMENT_KIND_LABELS[k] || k}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={showSuperseded}
            onChange={(e) => setShowSuperseded(e.target.checked)} />
          Show superseded versions
        </label>
      </div>

      {documents.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">No documents in the library yet.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {documents.map((doc) => (
            <li key={doc.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-slate-900">{doc.name}</span>
                  <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {DOCUMENT_KIND_LABELS[doc.kind] || doc.kind}
                  </span>
                  {doc.version_number > 1 && (
                    <span className="ml-1 text-xs text-slate-400">v{doc.version_number}</span>
                  )}
                  {!doc.is_current_version && (
                    <span className="ml-1 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">superseded</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  <button className={btnGhost} disabled={busy}
                    onClick={async () => { try { await openSignedUrl(doc.id, "preview"); } catch (e) { setError(e.message); } }}>
                    Preview
                  </button>
                  <button className={btnGhost} disabled={busy}
                    onClick={async () => { try { await openSignedUrl(doc.id, "download"); } catch (e) { setError(e.message); } }}>
                    Download
                  </button>
                  {doc.is_current_version && (
                    <button className={btnGhost} disabled={busy}
                      onClick={() => { setVersioningId(versioningId === doc.id ? null : doc.id); setVersionFile(null); }}>
                      New version
                    </button>
                  )}
                  <button className={btnGhost} disabled={busy} onClick={() => onDelete(doc.id)}>
                    Delete
                  </button>
                </div>
              </div>
              {doc.description && <p className="mt-1 text-xs text-slate-500">{doc.description}</p>}
              <p className="mt-1 text-xs text-slate-400">
                {doc.original_filename} · {(doc.byte_size / 1024).toFixed(0)} KB ·
                uploaded {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : "—"}
              </p>
              {versioningId === doc.id && (
                <form onSubmit={(e) => onNewVersion(e, doc.id)} className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input type="file" className={`${input} flex-1`}
                    onChange={(e) => setVersionFile(e.target.files?.[0] || null)} required
                    accept=".pdf,.jpg,.jpeg,.png,.txt,.xlsx,.xls,.docx,.doc" />
                  <button type="submit" className={btnPrimary} disabled={busy || !versionFile}>
                    Upload v{doc.version_number + 1}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      <section className="mt-8 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Upload to the library</h2>
        <p className="mt-1 text-xs text-slate-500">
          Templates are downloaded, filled out, and re-uploaded as filled copies.
          Uploading a new version supersedes the old one.
        </p>
        <form onSubmit={onUpload} className="mt-3 flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input className={`${input} flex-1`} placeholder="Document name"
              value={name} onChange={(e) => setName(e.target.value)} />
            <select className={`${input} sm:w-64`} value={kind} onChange={(e) => setKind(e.target.value)}>
              {DOCUMENT_KIND_SUGGESTIONS.map((k) => (
                <option key={k} value={k}>{DOCUMENT_KIND_LABELS[k]}</option>
              ))}
              <option value="__custom">Custom kind…</option>
            </select>
          </div>
          {kind === "__custom" && (
            <input className={input} placeholder="Custom kind name (e.g. weld map)"
              value={customKind} onChange={(e) => setCustomKind(e.target.value)} required />
          )}
          {kind === "filled_form" && templates.length > 0 && (
            <select className={input} value={templateSourceId}
              onChange={(e) => setTemplateSourceId(e.target.value)}>
              <option value="">Made from template… (optional)</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <input type="file" className={`${input} flex-1`}
              onChange={(e) => setFile(e.target.files?.[0] || null)} required
              accept=".pdf,.jpg,.jpeg,.png,.txt,.xlsx,.xls,.docx,.doc" />
            <button type="submit" className={btnPrimary} disabled={busy || !file}>Upload</button>
          </div>
        </form>
      </section>
    </div>
  );
}
