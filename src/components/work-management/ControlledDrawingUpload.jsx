// Slice-7 PDF blockers: "Upload controlled drawing (PDF)" — the only
// way a controlled isometric / P&ID / cut-sheet PDF becomes an issued
// revision. The file is uploaded as multipart form data; the server
// validates the PDF bytes and computes the SHA-256 from the actual
// bytes, so no typed hash ever reaches the database. The request id is
// generated once per selected file and reused across retries, so a
// failed submit retried with the same file replays the original
// receipt instead of creating a second revision. This never routes
// through Designer: an industrial isometric is a controlled drawing,
// not a room/floor plan. The generic "Upload new document" form stays
// separate and cannot create controlled revision state.
"use client";

import { useState } from "react";
import { usePageQuery } from "./packagePageContext.jsx";

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const label = "mb-1 block text-xs font-medium text-slate-600";
const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const btnPrimary = `${btn} bg-slate-900 text-white hover:bg-slate-700`;
const btnGhost = `${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`;

function localToday() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function newRequestId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function ControlledDrawingUpload({ packageId, onNavigateToTab = null, onUploaded = null, initialDrawing = null }) {
  const pageQuery = usePageQuery();
  // Slice-7 review-gating fix: the form starts empty unless a real
  // existing drawing was passed in (e.g. from a drawing's review
  // workspace) — that is a genuine prefill, and it is consumed once
  // by the parent. No example value is ever shown as a placeholder
  // on a controlled input: a placeholder that looks like a value
  // blocks submit under the browser's required validation.
  const [form, setForm] = useState(() => ({
    drawingType: initialDrawing?.drawingType || "isometric",
    drawingNumber: initialDrawing?.drawingNumber || "",
    lineNumber: initialDrawing?.lineNumber || "",
    revisionCode: initialDrawing?.revisionCode || "0",
    issueDate: localToday(),
    issuerRef: "",
    title: "",
    pIdDrawingId: "",
  }));
  const [file, setFile] = useState(null);
  const [requestId, setRequestId] = useState(() => newRequestId());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  function onFileChange(event) {
    const next = event.target.files?.[0] || null;
    setFile(next);
    // A new file is a new upload: a fresh request id, so a retry of the
    // old file can never be mistaken for this one.
    if (next) setRequestId(newRequestId());
    setSuccess(null);
    setError("");
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setSuccess(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("drawingType", form.drawingType);
      body.append("drawingNumber", form.drawingNumber.trim());
      body.append("lineNumber", form.lineNumber.trim());
      body.append("revisionCode", form.revisionCode.trim());
      body.append("issueDate", form.issueDate);
      body.append("issuerRef", form.issuerRef.trim());
      body.append("title", form.title.trim());
      body.append("pIdDrawingId", form.pIdDrawingId.trim());
      body.append("requestId", requestId);
      const response = await fetch(
        pageQuery(`/api/work-packages/${packageId}/drawings/intake`),
        { method: "POST", body },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not upload the controlled drawing.");
        return;
      }
      setSuccess({
        drawingNumber: form.drawingNumber.trim(),
        revisionCode: form.revisionCode.trim(),
        drawingId: data.artifact?.drawingId || null,
        artifactId: data.artifact?.id || null,
        sha256: data.artifact?.contentSha256 || "",
        replayed: data.replayed === true,
      });
      // Slice-7 review-gating fix: report a successful upload (fresh
      // or idempotent replay) to the parent so the Documents tab can
      // refresh its lists and invalidate the readiness cache. Never
      // called on failure — a failed upload must not present as done.
      if (onUploaded) {
        onUploaded({
          drawingId: data.artifact?.drawingId || null,
          artifactId: data.artifact?.id || null,
          revisionId: data.revision?.id || null,
          sha256: data.artifact?.contentSha256 || "",
          replayed: data.replayed === true,
          drawingNumber: form.drawingNumber.trim(),
          revisionCode: form.revisionCode.trim(),
        });
      }
      setFile(null);
      event.target.reset();
    } catch (caught) {
      setError(caught.message || "Could not upload the controlled drawing.");
    } finally {
      setBusy(false);
    }
  }

  async function onPreview() {
    if (!success?.artifactId || !success?.drawingId) return;
    setPreviewBusy(true);
    setError("");
    // Open the tab synchronously inside the click gesture; browsers
    // block window.open() after an await.
    const tab = window.open("", "_blank");
    if (!tab) {
      setError("Your browser blocked the preview tab — allow pop-ups for this site and try again.");
      setPreviewBusy(false);
      return;
    }
    tab.opener = null;
    try {
      const response = await fetch(pageQuery(
        `/api/work-packages/${packageId}/drawings/${success.drawingId}/artifacts/${success.artifactId}/preview`,
      ));
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not open the preview.");
      tab.location.href = data.url;
    } catch (caught) {
      tab.close();
      setError(caught.message);
    } finally {
      setPreviewBusy(false);
    }
  }

  return (
    <div id="controlled-drawing-intake">
      <h3 className="mt-4 text-xs font-semibold text-slate-700">Upload controlled drawing (PDF)</h3>
      <p className="mt-1 text-xs text-slate-500">
        An isometric, P&amp;ID, or cut sheet issued by the drafter becomes an immutable IFA revision.
        The file is stored privately and its SHA-256 is computed on the server — nothing is typed in by hand.
        Approval alone never makes it construction-usable; only an IFC release does.
      </p>
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
      {success && (
        <p className="mt-2 rounded-lg bg-green-50 p-3 text-sm text-green-800" role="status">
          Uploaded {success.drawingNumber} revision {success.revisionCode} as IFA
          {success.replayed ? " (already received — showing the original upload)" : ""}
          {success.sha256 ? ` — stored with SHA-256 ${success.sha256.slice(0, 12)}…` : ""}.
          <span className="mt-2 flex flex-wrap gap-1">
            <button type="button" className={btnGhost} disabled={previewBusy} onClick={onPreview}>
              Preview the uploaded PDF
            </button>
            {onNavigateToTab && (
              <button type="button" className={btnGhost} onClick={() => onNavigateToTab("redlines")}>
                View in Drawing readiness
              </button>
            )}
          </span>
        </p>
      )}
      <form onSubmit={onSubmit} className="mt-2 space-y-2 rounded border border-slate-100 p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div>
            <label className={label} htmlFor="controlled-drawing-type">Drawing type</label>
            <select id="controlled-drawing-type" className={input} value={form.drawingType}
              onChange={(e) => setForm((f) => ({ ...f, drawingType: e.target.value }))}>
              <option value="isometric">Isometric</option>
              <option value="p_id">P&amp;ID</option>
              <option value="cut_sheet">Cut sheet</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="controlled-drawing-number">Drawing number</label>
            <input id="controlled-drawing-number" className={input} value={form.drawingNumber}
              placeholder="Enter drawing number"
              onChange={(e) => setForm((f) => ({ ...f, drawingNumber: e.target.value }))} required />
          </div>
          <div>
            <label className={label} htmlFor="controlled-line-number">Line number</label>
            <input id="controlled-line-number" className={input} value={form.lineNumber}
              placeholder='2"-PL-101'
              onChange={(e) => setForm((f) => ({ ...f, lineNumber: e.target.value }))} />
          </div>
          <div>
            <label className={label} htmlFor="controlled-revision-code">Revision code</label>
            <input id="controlled-revision-code" className={input} value={form.revisionCode}
              onChange={(e) => setForm((f) => ({ ...f, revisionCode: e.target.value }))} required />
          </div>
          <div>
            <label className={label} htmlFor="controlled-issue-date">Issue date</label>
            <input id="controlled-issue-date" type="date" className={input} value={form.issueDate}
              onChange={(e) => setForm((f) => ({ ...f, issueDate: e.target.value }))} required />
          </div>
          <div>
            <label className={label} htmlFor="controlled-issuer-ref">Issuer / drafter ref (optional)</label>
            <input id="controlled-issuer-ref" className={input} value={form.issuerRef}
              onChange={(e) => setForm((f) => ({ ...f, issuerRef: e.target.value }))} />
          </div>
        </div>
        <div>
          <label className={label} htmlFor="controlled-title">Title (optional)</label>
          <input id="controlled-title" className={input} value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </div>
        <div>
          <label className={label} htmlFor="controlled-pid-parent">P&amp;ID parent drawing id (optional)</label>
          <input id="controlled-pid-parent" className={input} value={form.pIdDrawingId}
            placeholder="Leave blank when the package has no P&ID yet"
            onChange={(e) => setForm((f) => ({ ...f, pIdDrawingId: e.target.value }))} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input type="file" className={`${input} flex-1`} accept="application/pdf,.pdf"
            onChange={onFileChange} required />
          <button type="submit" className={btnPrimary} disabled={busy || !file}>
            {busy ? "Uploading…" : "Upload as IFA revision"}
          </button>
        </div>
        <p className="text-xs text-slate-400">
          PDF only, 25 MB maximum. Uploading creates the drawing and its first IFA revision;
          uploading another revision of the same drawing number attaches it to the same drawing.
        </p>
      </form>
    </div>
  );
}
