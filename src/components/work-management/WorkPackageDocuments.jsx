"use client";

import { useEffect, useState } from "react";
import {
  LINK_RELATIONSHIPS, LINK_STATUS_LABELS,
} from "@/domains/work-management/workLinks.js";
import { DOCUMENT_KIND_SUGGESTIONS, DOCUMENT_KIND_LABELS } from "@/domains/work-management/workDocuments.js";

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const btnPrimary = `${btn} bg-slate-900 text-white hover:bg-slate-700`;
const btnGhost = `${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`;

// Relationship types shown in the Documents section: drawings from the
// Designer plus the planner's own document library. (Rental-document and
// other link types stay in the Links panel.)
const DRAWING_REL = "supported_by_drawing";
const LIBRARY_RELS = ["library_supporting_document", "library_closeout_document", "library_permit_document"];

// Preview must open the new tab synchronously inside the click gesture:
// browsers block window.open() after an await, so we open a blank tab
// first and navigate it to the signed URL once the fetch resolves.
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

function otherIdOf(link) {
  const isSource = link.source_domain === "workmgmt" && link.source_type === "work_package";
  return isSource ? link.target_id : link.source_id;
}

export default function WorkPackageDocuments({ packageId, initialLinks = [] }) {
  const [links, setLinks] = useState(initialLinks);
  const [library, setLibrary] = useState([]);
  const [designerProjects, setDesignerProjects] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Link-existing form
  const [linkKind, setLinkKind] = useState("drawing"); // drawing | document
  const [relType, setRelType] = useState(DRAWING_REL);
  const [otherId, setOtherId] = useState("");
  // Upload form
  const [uploadName, setUploadName] = useState("");
  const [uploadKind, setUploadKind] = useState("reference");
  const [uploadFile, setUploadFile] = useState(null);

  const libraryById = Object.fromEntries(library.map((d) => [d.id, d]));
  const designerById = Object.fromEntries(designerProjects.map((p) => [p.id, p]));
  const drawingLinks = links.filter((l) => l.relationship_type === DRAWING_REL);
  const documentLinks = links.filter((l) => LIBRARY_RELS.includes(l.relationship_type));

  async function refresh() {
    setError("");
    try {
      const [linksRes, libRes, designerRes] = await Promise.all([
        fetch(`/api/work-links?packageId=${encodeURIComponent(packageId)}`),
        fetch("/api/work-documents"),
        fetch("/api/forge/designer"),
      ]);
      const linksData = await linksRes.json();
      if (!linksRes.ok) throw new Error(linksData.error || "Could not load links.");
      const libData = await libRes.json();
      if (!libRes.ok) throw new Error(libData.error || "Could not load the document library.");
      const designerData = await designerRes.json();
      setLinks(linksData.links || []);
      setLibrary(libData.documents || []);
      setDesignerProjects(designerData.projects || designerData.designer_projects || []);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { refresh(); }, [packageId]);

  async function onLinkExisting(event) {
    event.preventDefault();
    if (!otherId.trim()) return;
    setBusy(true); setError("");
    try {
      const rel = LINK_RELATIONSHIPS[relType];
      const packageIsSource = rel.source.domain === "workmgmt" && rel.source.type === "work_package";
      const body = packageIsSource
        ? { relationship_type: relType,
            source_domain: "workmgmt", source_type: "work_package", source_id: packageId,
            target_domain: rel.target.domain, target_type: rel.target.type, target_id: otherId.trim() }
        : { relationship_type: relType,
            source_domain: rel.source.domain, source_type: rel.source.type, source_id: otherId.trim(),
            target_domain: "workmgmt", target_type: "work_package", target_id: packageId };
      const response = await fetch("/api/work-links", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "Could not create the link."); return; }
      setOtherId("");
      refresh();
    } finally { setBusy(false); }
  }

  async function onUpload(event) {
    event.preventDefault();
    if (!uploadFile) return;
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      form.append("name", uploadName.trim() || uploadFile.name);
      form.append("kind", uploadKind);
      const upRes = await fetch("/api/work-documents", { method: "POST", body: form });
      const upData = await upRes.json();
      if (!upRes.ok) { setError(upData.error || "Could not upload the document."); return; }
      // Auto-link the new library document to this package.
      const linkRes = await fetch("/api/work-links", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          relationship_type: "library_supporting_document",
          source_domain: "workmgmt", source_type: "work_package", source_id: packageId,
          target_domain: "workmgmt", target_type: "forge_work_document",
          target_id: upData.document.id,
        }),
      });
      const linkData = await linkRes.json();
      if (!linkRes.ok) { setError(`Uploaded, but linking failed: ${linkData.error}`); return; }
      setUploadName(""); setUploadFile(null);
      event.target.reset();
      refresh();
    } finally { setBusy(false); }
  }

  async function onUnlink(linkId) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/work-links/${linkId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "Could not unlink."); return; }
      refresh();
    } finally { setBusy(false); }
  }

  async function onPreview(documentId) {
    try { await openSignedUrl(documentId, "preview"); }
    catch (e) { setError(e.message); }
  }

  function renderLinkRow(link) {
    const id = otherIdOf(link);
    const isDrawing = link.relationship_type === DRAWING_REL;
    const doc = !isDrawing ? libraryById[id] : null;
    const project = isDrawing ? designerById[id] : null;
    const title = isDrawing
      ? (project?.name || project?.title || `Designer project ${id.slice(0, 8)}`)
      : (doc?.name || `Document ${id.slice(0, 8)}`);
    // Previews follow link health: a stale or broken link never offers a
    // preview of what may no longer be the referenced record.
    const linkHealthy = link.status === "active";
    return (
      <li key={link.id} className="rounded border border-slate-100 p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-medium text-slate-900">{title}</span>
            <span className="ml-2 text-slate-500">
              {LINK_RELATIONSHIPS[link.relationship_type]?.label || link.relationship_type}
            </span>
          </div>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">
            {LINK_STATUS_LABELS[link.status] || link.status}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {!isDrawing && doc && linkHealthy && (
            <>
              <button className={btnGhost} disabled={busy} onClick={() => onPreview(doc.id)}>Preview</button>
              <button className={btnGhost} disabled={busy}
                onClick={async () => { try { await openSignedUrl(doc.id, "download"); } catch (e) { setError(e.message); } }}>
                Download
              </button>
            </>
          )}
          {!linkHealthy && (
            <span className="text-xs text-amber-700">Re-check the link before opening this file.</span>
          )}
          <button className={btnGhost} disabled={busy} onClick={() => onUnlink(link.id)}>Unlink</button>
        </div>
      </li>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Drawings &amp; documents</h2>
      <p className="mt-1 text-xs text-slate-500">
        Drawings come from the Designer; documents live in this planner's own library.
        Links reference the real records — they never copy them.
      </p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <h3 className="mt-4 text-xs font-semibold text-slate-700">Drawings</h3>
      {drawingLinks.length > 0 ? (
        <ul className="mt-2 space-y-2">{drawingLinks.map(renderLinkRow)}</ul>
      ) : (
        <p className="mt-1 text-xs text-slate-500">No drawings linked yet.</p>
      )}

      <h3 className="mt-4 text-xs font-semibold text-slate-700">Documents</h3>
      {documentLinks.length > 0 ? (
        <ul className="mt-2 space-y-2">{documentLinks.map(renderLinkRow)}</ul>
      ) : (
        <p className="mt-1 text-xs text-slate-500">No documents linked yet.</p>
      )}

      <h3 className="mt-4 text-xs font-semibold text-slate-700">Link existing</h3>
      <form onSubmit={onLinkExisting} className="mt-2 flex flex-col gap-2 sm:flex-row">
        <select className={`${input} sm:w-40`} value={linkKind}
          onChange={(e) => {
            const kind = e.target.value;
            setLinkKind(kind);
            setRelType(kind === "drawing" ? DRAWING_REL : LIBRARY_RELS[0]);
            setOtherId("");
          }}>
          <option value="drawing">Drawing</option>
          <option value="document">Document</option>
        </select>
        {linkKind === "document" && (
          <select className={`${input} sm:w-56`} value={relType} onChange={(e) => setRelType(e.target.value)}>
            {LIBRARY_RELS.map((key) => (
              <option key={key} value={key}>{LINK_RELATIONSHIPS[key].label}</option>
            ))}
          </select>
        )}
        {linkKind === "drawing" && designerProjects.length > 0 ? (
          <select className={`${input} flex-1`} value={otherId} onChange={(e) => setOtherId(e.target.value)} required>
            <option value="">Designer project…</option>
            {designerProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name || p.title || p.id}</option>
            ))}
          </select>
        ) : linkKind === "document" && library.length > 0 ? (
          <select className={`${input} flex-1`} value={otherId} onChange={(e) => setOtherId(e.target.value)} required>
            <option value="">Library document…</option>
            {library.map((d) => (
              <option key={d.id} value={d.id}>{d.name} (v{d.version_number})</option>
            ))}
          </select>
        ) : (
          <input className={`${input} flex-1`} placeholder={linkKind === "drawing" ? "Designer project id" : "Document id"}
            value={otherId} onChange={(e) => setOtherId(e.target.value)} required />
        )}
        <button type="submit" className={btnPrimary} disabled={busy || !otherId.trim()}>Link</button>
      </form>

      <h3 className="mt-4 text-xs font-semibold text-slate-700">Upload new document</h3>
      <form onSubmit={onUpload} className="mt-2 flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className={`${input} flex-1`} placeholder="Document name"
            value={uploadName} onChange={(e) => setUploadName(e.target.value)} />
          <select className={`${input} sm:w-56`} value={uploadKind} onChange={(e) => setUploadKind(e.target.value)}>
            {DOCUMENT_KIND_SUGGESTIONS.map((k) => (
              <option key={k} value={k}>{DOCUMENT_KIND_LABELS[k] || k}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input type="file" className={`${input} flex-1`}
            onChange={(e) => setUploadFile(e.target.files?.[0] || null)} required
            accept=".pdf,.jpg,.jpeg,.png,.txt,.xlsx,.xls,.docx,.doc" />
          <button type="submit" className={btnPrimary} disabled={busy || !uploadFile}>
            Upload &amp; link
          </button>
        </div>
        <p className="text-xs text-slate-400">Uploading links the document to this package automatically.</p>
      </form>
    </section>
  );
}
