// Drawing readiness panel (work package planner, slice 7).
//
// The IFA-to-IFC redline review workflow, as a derived read model over
// controlled drawings. Nothing here edits a drawing: controlled
// isometrics, P&IDs and cut sheets are corrected by drafters, never
// in this tool. The panel shows, per drawing, its badge ("IFA — In
// review", "IFA — Returned to drafter", "IFA — Approved; IFC not
// issued", "IFC — Issued for construction", "Retired", "IFA — Awaiting
// review"), its revisions, review rounds, redlines, IFC releases and
// field hand-redline history, and offers the review actions: open a
// round, add a redline, resolve a redline, decide a round, issue an
// IFC revision (a distinct uploaded IFC revision + release event), and
// capture a field hand-redline. An approved IFA review is never
// labelled issued IFC — only a release makes a drawing construction
// usable. A field hand-redline is shown as a historical record, never
// as an issued revision.

import { useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { usePageQuery, usePackagePageContext } from "./packagePageContext.jsx";
import { scopedSWRKey } from "./workspaceQuery.js";

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const label = "block text-xs font-medium text-slate-600 mb-1";
const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const btnPrimary = `${btn} bg-slate-900 text-white hover:bg-slate-700`;
const btnGhost = `${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`;
const btnDanger = `${btn} border border-red-300 text-red-700 hover:bg-red-50`;

async function api(pageQuery, path, options) {
  const response = await fetch(pageQuery(path), {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `key-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export function badgeClass(badge) {
  if (badge === "IFC — Issued for construction") return "bg-green-100 text-green-800";
  if (badge === "IFA — In review") return "bg-amber-100 text-amber-800";
  if (badge === "IFA — Returned to drafter") return "bg-red-100 text-red-800";
  if (badge === "IFA — Approved; IFC not issued") return "bg-blue-100 text-blue-800";
  if (badge === "Retired") return "bg-slate-200 text-slate-600";
  // Fix round 1: a withdrawn drawing (terminal package) reads like a
  // retired one — not usable, grey, never green.
  if (badge === "Withdrawn — package cancelled" || badge === "Withdrawn — package verified closed") return "bg-slate-200 text-slate-600";
  return "bg-slate-100 text-slate-700";
}

function formatWhen(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function shortId(value) {
  return value ? String(value).slice(-8) : "—";
}

// One review round: redlines, decision form, audit events. Detail is
// fetched only while the round is expanded.
function ReviewRound({ packageId, drawingId, review, onChanged }) {
  const pageQuery = usePageQuery();
  const pageContext = usePackagePageContext();
  const [expanded, setExpanded] = useState(false);
  const [decision, setDecision] = useState("APPROVE");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [redlineForm, setRedlineForm] = useState({
    comment: "", severity: "REQUIRED", anchorPage: "", anchorX: "", anchorY: "",
  });
  const [resolveForm, setResolveForm] = useState({});
  const [resolvingId, setResolvingId] = useState(null);

  const { data, error: loadError, refresh } = useStaleWhileRevalidate(
    expanded ? scopedSWRKey(pageContext, "work-packages", packageId, "drawings", drawingId, "reviews", review.id, "detail") : null,
    () => api(pageQuery, `/api/work-packages/${packageId}/drawings/${drawingId}/reviews/${review.id}`),
    { ttlMs: 10_000 },
  );
  const redlines = data?.redlines || [];
  const events = data?.events || [];
  const isOpen = review.state === "OPEN";

  async function submitDecision(event) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await api(pageQuery, `/api/work-packages/${packageId}/drawings/${drawingId}/reviews/${review.id}/decision`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: review.version, decision, reason: reason.trim() }),
      });
      setReason("");
      await refresh();
      if (onChanged) onChanged();
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function submitRedline(event) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await api(pageQuery, `/api/work-packages/${packageId}/drawings/${drawingId}/reviews/${review.id}/redlines`, {
        method: "POST",
        body: JSON.stringify({
          drawingRevisionId: review.drawingRevisionId,
          comment: redlineForm.comment.trim(),
          severity: redlineForm.severity,
          ...(redlineForm.anchorPage !== "" ? { anchorPage: Number(redlineForm.anchorPage) } : {}),
          ...(redlineForm.anchorX !== "" ? { anchorX: Number(redlineForm.anchorX) } : {}),
          ...(redlineForm.anchorY !== "" ? { anchorY: Number(redlineForm.anchorY) } : {}),
          idempotencyKey: newIdempotencyKey(),
        }),
      });
      setRedlineForm({ comment: "", severity: "REQUIRED", anchorPage: "", anchorX: "", anchorY: "" });
      await refresh();
      if (onChanged) onChanged();
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function submitResolve(event, redline) {
    event.preventDefault();
    const form = resolveForm[redline.id] || {};
    setBusy(true); setError("");
    try {
      await api(pageQuery, `/api/work-packages/${packageId}/drawings/${drawingId}/reviews/${review.id}/redlines/${redline.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: redline.version,
          resolution: form.resolution || "RESOLVED",
          resolutionNote: (form.resolutionNote || "").trim(),
        }),
      });
      setResolvingId(null);
      await refresh();
      if (onChanged) onChanged();
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  return (
    <li className="rounded border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="text-left font-medium text-slate-900 underline decoration-slate-300 underline-offset-2" onClick={() => setExpanded((v) => !v)}>
          Round {review.roundNo} — {review.state}
        </button>
        <span className="text-xs text-slate-500">
          opened {formatWhen(review.openedAt)}
          {review.closedAt ? ` · closed ${formatWhen(review.closedAt)}` : ""}
        </span>
        {review.decisionReason && <span className="text-xs text-slate-500">— {review.decisionReason}</span>}
      </div>
      {expanded && (
        <div className="mt-3 space-y-3">
          {loadError && <p className="text-xs text-red-600">{loadError}</p>}
          <div>
            <p className="text-xs font-medium text-slate-700">Redlines ({redlines.length})</p>
            {redlines.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">No redlines in this round yet.</p>
            ) : (
              <ul className="mt-1 space-y-2">
                {redlines.map((redline) => (
                  <li key={redline.id} className="rounded border border-slate-100 p-2 text-xs text-slate-600">
                    <span className={`mr-2 rounded px-2 py-0.5 ${redline.severity === "REQUIRED" ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-600"}`}>
                      {redline.severity}
                    </span>
                    <span className="font-medium text-slate-900">{redline.comment}</span>
                    {redline.anchorPage != null && (
                      <span className="ml-2 text-slate-500">
                        p.{redline.anchorPage}
                        {redline.anchorX != null && redline.anchorY != null ? ` (${redline.anchorX}, ${redline.anchorY})` : ""}
                      </span>
                    )}
                    <span className="ml-2">— {redline.resolution}</span>
                    {redline.resolutionNote && <span className="block text-slate-500">{redline.resolutionNote}</span>}
                    {isOpen && redline.resolution === "OPEN" && resolvingId !== redline.id && (
                      <button type="button" className={`${btnGhost} ml-2 mt-1`} onClick={() => setResolvingId(redline.id)}>
                        Resolve
                      </button>
                    )}
                    {isOpen && resolvingId === redline.id && (
                      <form className="mt-2 space-y-2" onSubmit={(e) => submitResolve(e, redline)}>
                        <div>
                          <label className={label} htmlFor={`resolve-${redline.id}`}>Resolution</label>
                          <select id={`resolve-${redline.id}`} className={input} value={(resolveForm[redline.id] || {}).resolution || "RESOLVED"}
                            onChange={(e) => setResolveForm((f) => ({ ...f, [redline.id]: { ...(f[redline.id] || {}), resolution: e.target.value } }))}>
                            <option value="RESOLVED">Resolved</option>
                            <option value="ACCEPTED_AS_NOTED">Accepted as noted</option>
                          </select>
                        </div>
                        <div>
                          <label className={label} htmlFor={`resolve-note-${redline.id}`}>Resolution note</label>
                          <input id={`resolve-note-${redline.id}`} className={input}
                            value={(resolveForm[redline.id] || {}).resolutionNote || ""}
                            onChange={(e) => setResolveForm((f) => ({ ...f, [redline.id]: { ...(f[redline.id] || {}), resolutionNote: e.target.value } }))} />
                        </div>
                        <div className="flex gap-2">
                          <button type="submit" className={btnPrimary} disabled={busy}>Save resolution</button>
                          <button type="button" className={btnGhost} onClick={() => setResolvingId(null)}>Cancel</button>
                        </div>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {isOpen && (
            <>
              <form className="space-y-2 rounded border border-slate-100 p-3" onSubmit={submitRedline}>
                <p className="text-xs font-medium text-slate-700">Add a redline</p>
                <div>
                  <label className={label} htmlFor={`redline-comment-${review.id}`}>Comment</label>
                  <input id={`redline-comment-${review.id}`} className={input} value={redlineForm.comment}
                    onChange={(e) => setRedlineForm((f) => ({ ...f, comment: e.target.value }))} required />
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <label className={label} htmlFor={`redline-severity-${review.id}`}>Severity</label>
                    <select id={`redline-severity-${review.id}`} className={input} value={redlineForm.severity}
                      onChange={(e) => setRedlineForm((f) => ({ ...f, severity: e.target.value }))}>
                      <option value="REQUIRED">Required</option>
                      <option value="INFO">Info</option>
                    </select>
                  </div>
                  <div>
                    <label className={label} htmlFor={`redline-page-${review.id}`}>Page</label>
                    <input id={`redline-page-${review.id}`} className={input} type="number" min="1" value={redlineForm.anchorPage}
                      onChange={(e) => setRedlineForm((f) => ({ ...f, anchorPage: e.target.value }))} />
                  </div>
                  <div>
                    <label className={label} htmlFor={`redline-x-${review.id}`}>X (0–1)</label>
                    <input id={`redline-x-${review.id}`} className={input} type="number" step="0.01" min="0" max="1" value={redlineForm.anchorX}
                      onChange={(e) => setRedlineForm((f) => ({ ...f, anchorX: e.target.value }))} />
                  </div>
                  <div>
                    <label className={label} htmlFor={`redline-y-${review.id}`}>Y (0–1)</label>
                    <input id={`redline-y-${review.id}`} className={input} type="number" step="0.01" min="0" max="1" value={redlineForm.anchorY}
                      onChange={(e) => setRedlineForm((f) => ({ ...f, anchorY: e.target.value }))} />
                  </div>
                </div>
                <button type="submit" className={btnPrimary} disabled={busy || !redlineForm.comment.trim()}>Add redline</button>
              </form>
              <form className="space-y-2 rounded border border-slate-100 p-3" onSubmit={submitDecision}>
                <p className="text-xs font-medium text-slate-700">Decide this round</p>
                <div>
                  <label className={label} htmlFor={`decision-${review.id}`}>Decision</label>
                  <select id={`decision-${review.id}`} className={input} value={decision}
                    onChange={(e) => setDecision(e.target.value)}>
                    <option value="APPROVE">Approve</option>
                    <option value="APPROVE_WITH_REDLINES">Approve with redlines</option>
                    <option value="RETURN_TO_DRAFTER">Return to drafter</option>
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor={`decision-reason-${review.id}`}>Reason</label>
                  <input id={`decision-reason-${review.id}`} className={input} value={reason}
                    onChange={(e) => setReason(e.target.value)} required />
                </div>
                <button type="submit" className={btnPrimary} disabled={busy || !reason.trim()}>Record decision</button>
              </form>
            </>
          )}
          {events.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-700">History</p>
              <ul className="mt-1 space-y-1 text-xs text-slate-500">
                {events.map((event) => (
                  <li key={event.id}>{formatWhen(event.createdAt)} — {event.eventType}{event.actorId ? ` · ${shortId(event.actorId)}` : ""}</li>
                ))}
              </ul>
            </div>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </li>
  );
}

// One drawing's review workspace: revisions, review rounds, IFC
// releases, field hand-redline history, and the actions that move a
// drawing through review. Lists are fetched only while expanded.
function DrawingReviewWorkspace({ packageId, row, onChanged, onNavigateToTab = null }) {
  const pageQuery = usePageQuery();
  const pageContext = usePackagePageContext();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewForm, setReviewForm] = useState({ drawingRevisionId: "", reason: "" });
  const [ifcForm, setIfcForm] = useState({ reviewId: "", ifcRevisionCode: "", stagedArtifactId: "", reason: "" });
  const [stageFile, setStageFile] = useState(null);
  const [staging, setStaging] = useState(false);
  const [fieldForm, setFieldForm] = useState({ drawingRevisionId: "", artifactRef: "", sha256: "", fieldReason: "" });
  const [reconcileForm, setReconcileForm] = useState({});
  const [retireReason, setRetireReason] = useState("");
  const [confirmRetire, setConfirmRetire] = useState(false);

  // Slice-7 PDF blockers: new revisions come only from a verified
  // controlled-PDF upload, never from typed references. Jump to the
  // intake section on the Documents tab and scroll it into view once
  // it mounts.
  function navigateToIntake() {
    if (!onNavigateToTab) return;
    onNavigateToTab("documents");
    requestAnimationFrame(() => {
      document.getElementById("controlled-drawing-intake")?.scrollIntoView({ block: "start" });
    });
  }

  const drawingId = row.drawingId;
  const { data: revisionsData, refresh: refreshRevisions } = useStaleWhileRevalidate(
    expanded ? scopedSWRKey(pageContext, "work-packages", packageId, "drawings", drawingId, "revisions") : null,
    () => api(pageQuery, `/api/work-packages/${packageId}/drawings/${drawingId}/revisions`),
    { ttlMs: 10_000 },
  );
  const { data: reviewsData, refresh: refreshReviews } = useStaleWhileRevalidate(
    expanded ? scopedSWRKey(pageContext, "work-packages", packageId, "drawings", drawingId, "reviews") : null,
    () => api(pageQuery, `/api/work-packages/${packageId}/drawings/${drawingId}/reviews`),
    { ttlMs: 10_000 },
  );
  const { data: releasesData, refresh: refreshReleases } = useStaleWhileRevalidate(
    expanded ? scopedSWRKey(pageContext, "work-packages", packageId, "drawings", drawingId, "ifc-releases") : null,
    () => api(pageQuery, `/api/work-packages/${packageId}/drawings/${drawingId}/ifc-releases`),
    { ttlMs: 10_000 },
  );
  const { data: fieldData, refresh: refreshField } = useStaleWhileRevalidate(
    expanded ? scopedSWRKey(pageContext, "work-packages", packageId, "drawings", drawingId, "field-redlines") : null,
    () => api(pageQuery, `/api/work-packages/${packageId}/drawings/${drawingId}/field-redlines`),
    { ttlMs: 10_000 },
  );
  // Slice-7 PDF blockers: the drawing's stored artifacts — issued IFA
  // bytes plus staged IFC candidates for the release picker.
  const { data: artifactsData, refresh: refreshArtifacts } = useStaleWhileRevalidate(
    expanded ? scopedSWRKey(pageContext, "work-packages", packageId, "drawings", drawingId, "artifacts") : null,
    () => api(pageQuery, `/api/work-packages/${packageId}/drawings/${drawingId}/artifacts`),
    { ttlMs: 10_000 },
  );

  const revisions = revisionsData?.revisions || [];
  const reviews = reviewsData?.reviews || [];
  const releases = releasesData?.releases || [];
  const fieldRedlines = fieldData?.fieldRedlines || [];
  const artifacts = artifactsData?.artifacts || [];
  const stagedCandidates = artifacts.filter((a) => a.purpose === "ifc_candidate" && !a.retiredAt);
  const latestRevision = row.latestRevision;
  const openReview = reviews.find((r) => r.state === "OPEN")
    || (row.latestReview?.state === "OPEN" ? row.latestReview : null);
  const approvedReview = reviews.find((r) => r.state === "APPROVED" || r.state === "APPROVED_WITH_REDLINES");

  async function refreshAll() {
    await Promise.all([refreshRevisions(), refreshReviews(), refreshReleases(), refreshField(), refreshArtifacts()]);
    if (onChanged) onChanged();
  }

  async function submitStage(event) {
    event.preventDefault();
    if (!stageFile) return;
    setStaging(true); setError(""); setNotice("");
    try {
      const body = new FormData();
      body.append("file", stageFile);
      body.append("requestId", crypto.randomUUID());
      const response = await fetch(
        pageQuery(`/api/work-packages/${packageId}/drawings/${drawingId}/ifc-stage`),
        { method: "POST", body },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not stage the IFC PDF.");
      setStageFile(null);
      event.target.reset();
      setNotice("IFC PDF staged — it stays pending until the release below attaches it.");
      await refreshArtifacts();
    } catch (e) {
      setError(e.message);
    } finally { setStaging(false); }
  }

  async function submitReview(event) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      await api(pageQuery, `/api/work-packages/${packageId}/drawings/${drawingId}/reviews`, {
        method: "POST",
        body: JSON.stringify({
          drawingRevisionId: reviewForm.drawingRevisionId,
          ...(reviewForm.reason.trim() ? { reason: reviewForm.reason.trim() } : {}),
          idempotencyKey: newIdempotencyKey(),
        }),
      });
      setReviewForm({ drawingRevisionId: "", reason: "" });
      setNotice("Review round opened.");
      await refreshAll();
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function submitIfc(event) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      // Slice-7 PDF blockers: the IFC bytes come from a staged artifact,
      // never from typed references. The release RPC takes the staged
      // file's stored bytes as authoritative.
      await api(pageQuery, `/api/work-packages/${packageId}/drawings/${drawingId}/ifc-releases`, {
        method: "POST",
        body: JSON.stringify({
          reviewId: ifcForm.reviewId,
          ifcRevisionCode: ifcForm.ifcRevisionCode.trim(),
          stagedArtifactId: ifcForm.stagedArtifactId,
          ...(ifcForm.reason.trim() ? { reason: ifcForm.reason.trim() } : {}),
        }),
      });
      setIfcForm({ reviewId: "", ifcRevisionCode: "", stagedArtifactId: "", reason: "" });
      setNotice(`IFC revision ${ifcForm.ifcRevisionCode.trim()} issued for construction.`);
      await refreshAll();
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function submitField(event) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      await api(pageQuery, `/api/work-packages/${packageId}/drawings/${drawingId}/field-redlines`, {
        method: "POST",
        body: JSON.stringify({
          drawingRevisionId: fieldForm.drawingRevisionId,
          artifactRef: fieldForm.artifactRef.trim(),
          sha256: fieldForm.sha256.trim(),
          fieldReason: fieldForm.fieldReason.trim(),
        }),
      });
      setFieldForm({ drawingRevisionId: "", artifactRef: "", sha256: "", fieldReason: "" });
      setNotice("Field hand-redline captured as a historical record. It is not an issued IFC revision.");
      await refreshAll();
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function submitReconcile(event, fieldRedline) {
    event.preventDefault();
    const form = reconcileForm[fieldRedline.id] || {};
    setBusy(true); setError(""); setNotice("");
    try {
      await api(pageQuery, `/api/work-packages/${packageId}/drawings/${drawingId}/field-redlines/${fieldRedline.id}/reconcile`, {
        method: "POST",
        body: JSON.stringify({
          ...(form.reconciledRevisionId ? { reconciledRevisionId: form.reconciledRevisionId } : {}),
          ...(form.reason ? { reason: form.reason.trim() } : {}),
        }),
      });
      setNotice("Field hand-redline reconciled.");
      await refreshAll();
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function submitRetire(event) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      await api(pageQuery, `/api/work-packages/${packageId}/drawings/${drawingId}/retire`, {
        method: "POST",
        body: JSON.stringify({ reason: retireReason.trim() }),
      });
      setConfirmRetire(false);
      setNotice("Drawing retired. Its review history is kept.");
      await refreshAll();
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  const title = row.title ? ` — ${row.title}` : "";
  return (
    <li className="rounded border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="text-left font-medium text-slate-900 underline decoration-slate-300 underline-offset-2" onClick={() => setExpanded((v) => !v)}>
          {row.drawingNumber} ({row.drawingType}){title}
        </button>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${badgeClass(row.badge)}`}>{row.badge}</span>
        {row.openRequiredRedlines > 0 && (
          <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
            {row.openRequiredRedlines} open required redline{row.openRequiredRedlines === 1 ? "" : "s"}
          </span>
        )}
        {row.pendingFieldRedlines > 0 && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            {row.pendingFieldRedlines} field hand-redline{row.pendingFieldRedlines === 1 ? "" : "s"} awaiting reconciliation
          </span>
        )}
        {latestRevision && <span className="text-xs text-slate-500">Rev {latestRevision.revisionCode} · {latestRevision.issuedAs}</span>}
      </div>
      {expanded && (
        <div className="mt-3 space-y-4">
          {error && <p className="text-xs text-red-600">{error}</p>}
          {notice && <p className="text-xs text-green-700">{notice}</p>}
          <div>
            <p className="text-xs font-medium text-slate-700">Revisions</p>
            {revisions.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">No revisions recorded yet.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-xs text-slate-600">
                {revisions.map((revision) => (
                  <li key={revision.id}>
                    Rev {revision.revisionCode} · {revision.issuedAs} · {formatWhen(revision.createdAt)}
                  </li>
                ))}
              </ul>
            )}
            {!row.retiredAt && (
              <div className="mt-2 rounded border border-slate-100 p-3">
                <p className="text-xs font-medium text-slate-700">Add an IFA revision</p>
                <p className="mt-1 text-xs text-slate-500">
                  New revisions come only from a verified controlled-PDF upload — references and hashes are never typed in by hand.
                </p>
                <button type="button" className={`${btnPrimary} mt-2`} onClick={navigateToIntake}>
                  Upload a controlled PDF
                </button>
              </div>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-slate-700">Review rounds</p>
            {reviews.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">No review rounds yet.</p>
            ) : (
              <ul className="mt-1 space-y-2">
                {reviews.map((review) => (
                  <ReviewRound key={review.id} packageId={packageId} drawingId={drawingId} review={review} onChanged={refreshAll} />
                ))}
              </ul>
            )}
            {!row.retiredAt && !openReview && latestRevision && (
              <form className="mt-2 space-y-2 rounded border border-slate-100 p-3" onSubmit={submitReview}>
                <p className="text-xs font-medium text-slate-700">Open a review round</p>
                <div>
                  <label className={label} htmlFor={`review-rev-${drawingId}`}>Revision to review</label>
                  <select id={`review-rev-${drawingId}`} className={input} value={reviewForm.drawingRevisionId}
                    onChange={(e) => setReviewForm((f) => ({ ...f, drawingRevisionId: e.target.value }))} required>
                    <option value="">Select a revision…</option>
                    {revisions.filter((r) => r.issuedAs === "IFA").map((revision) => (
                      <option key={revision.id} value={revision.id}>Rev {revision.revisionCode}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor={`review-reason-${drawingId}`}>Reason (optional)</label>
                  <input id={`review-reason-${drawingId}`} className={input} value={reviewForm.reason}
                    onChange={(e) => setReviewForm((f) => ({ ...f, reason: e.target.value }))} />
                </div>
                <button type="submit" className={btnPrimary} disabled={busy || !reviewForm.drawingRevisionId}>Open review</button>
              </form>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-slate-700">IFC releases</p>
            {releases.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">No IFC release yet — this drawing is not issued for construction.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-xs text-slate-600">
                {releases.map((release) => (
                  <li key={release.id}>
                    IFC revision {release.ifcRevisionCode} · released {formatWhen(release.releasedAt)}
                    {release.isActive ? " · active" : " · superseded"}
                  </li>
                ))}
              </ul>
            )}
            {!row.retiredAt && approvedReview && (
              <form className="mt-2 space-y-2 rounded border border-slate-100 p-3" onSubmit={submitStage}>
                <p className="text-xs font-medium text-slate-700">Stage an IFC PDF</p>
                <p className="text-xs text-slate-500">
                  Upload the drafter-issued IFC file here. It stays pending — a different file from the approved IFA revision — until the release below attaches it.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input type="file" className={`${input} flex-1`} accept="application/pdf,.pdf"
                    onChange={(e) => setStageFile(e.target.files?.[0] || null)} required />
                  <button type="submit" className={btnPrimary} disabled={staging || !stageFile}>
                    {staging ? "Staging…" : "Stage IFC PDF"}
                  </button>
                </div>
                {stagedCandidates.length > 0 && (
                  <ul className="mt-1 space-y-1 text-xs text-slate-600">
                    {stagedCandidates.map((artifact) => (
                      <li key={artifact.id}>
                        Staged: {artifact.originalFilename || "IFC PDF"} · SHA-256 {artifact.contentSha256.slice(0, 12)}… · {formatWhen(artifact.createdAt)}
                      </li>
                    ))}
                  </ul>
                )}
              </form>
            )}
            {!row.retiredAt && approvedReview && (
              <form className="mt-2 space-y-2 rounded border border-slate-100 p-3" onSubmit={submitIfc}>
                <p className="text-xs font-medium text-slate-700">Issue an IFC revision</p>
                <p className="text-xs text-slate-500">
                  Issues a distinct uploaded IFC revision against the accepted review. Approval alone does not make this drawing construction-usable.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className={label} htmlFor={`ifc-rev-${drawingId}`}>Accepted review</label>
                    <select id={`ifc-rev-${drawingId}`} className={input} value={ifcForm.reviewId}
                      onChange={(e) => setIfcForm((f) => ({ ...f, reviewId: e.target.value }))} required>
                      <option value="">Select a review…</option>
                      {reviews.filter((r) => r.state === "APPROVED" || r.state === "APPROVED_WITH_REDLINES").map((review) => (
                        <option key={review.id} value={review.id}>Round {review.roundNo} — {review.state}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={label} htmlFor={`ifc-code-${drawingId}`}>IFC revision code</label>
                    <input id={`ifc-code-${drawingId}`} className={input} value={ifcForm.ifcRevisionCode}
                      onChange={(e) => setIfcForm((f) => ({ ...f, ifcRevisionCode: e.target.value }))} required />
                  </div>
                  <div>
                    <label className={label} htmlFor={`ifc-file-${drawingId}`}>Staged IFC file</label>
                    <select id={`ifc-file-${drawingId}`} className={input} value={ifcForm.stagedArtifactId}
                      onChange={(e) => setIfcForm((f) => ({ ...f, stagedArtifactId: e.target.value }))} required>
                      <option value="">Select a staged IFC PDF…</option>
                      {stagedCandidates.map((artifact) => (
                        <option key={artifact.id} value={artifact.id}>
                          {artifact.originalFilename || "IFC PDF"} · {artifact.contentSha256.slice(0, 12)}…
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {stagedCandidates.length === 0 && (
                  <p className="text-xs text-amber-700">No IFC PDF staged yet — stage one in the form above first.</p>
                )}
                <button type="submit" className={btnPrimary} disabled={busy || !ifcForm.reviewId || !ifcForm.stagedArtifactId}>Issue IFC revision</button>
              </form>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-slate-700">Field hand-redline history</p>
            <p className="mt-1 text-xs text-slate-500">
              A field hand-redline is a historical record of what was marked up on site. It never changes the controlled drawing and never makes an IFA drawing construction-usable.
            </p>
            {fieldRedlines.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">No field hand-redlines captured.</p>
            ) : (
              <ul className="mt-1 space-y-2">
                {fieldRedlines.map((field) => (
                  <li key={field.id} className="rounded border border-slate-100 p-2 text-xs text-slate-600">
                    <span className="font-medium text-slate-900">Field hand-redline — historical record; not an issued IFC revision</span>
                    <span className="block">{field.fieldReason}</span>
                    <span className="text-slate-500">
                      {field.recordState} · {formatWhen(field.createdAt)} · {shortId(field.artifactRef)}
                    </span>
                    {field.recordState === "HISTORICAL_PENDING_RECONCILIATION" && (
                      <form className="mt-2 space-y-2" onSubmit={(e) => submitReconcile(e, field)}>
                        <div>
                          <label className={label} htmlFor={`recon-rev-${field.id}`}>Reconciled by revision (optional)</label>
                          <select id={`recon-rev-${field.id}`} className={input}
                            value={(reconcileForm[field.id] || {}).reconciledRevisionId || ""}
                            onChange={(e) => setReconcileForm((f) => ({ ...f, [field.id]: { ...(f[field.id] || {}), reconciledRevisionId: e.target.value } }))}>
                            <option value="">Retire without a new revision</option>
                            {revisions.map((revision) => (
                              <option key={revision.id} value={revision.id}>Rev {revision.revisionCode} ({revision.issuedAs})</option>
                            ))}
                          </select>
                        </div>
                        <button type="submit" className={btnPrimary} disabled={busy}>Reconcile</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!row.retiredAt && latestRevision && (
              <form className="mt-2 space-y-2 rounded border border-slate-100 p-3" onSubmit={submitField}>
                <p className="text-xs font-medium text-slate-700">Capture a field hand-redline</p>
                <div>
                  <label className={label} htmlFor={`field-rev-${drawingId}`}>Revision marked up</label>
                  <select id={`field-rev-${drawingId}`} className={input} value={fieldForm.drawingRevisionId}
                    onChange={(e) => setFieldForm((f) => ({ ...f, drawingRevisionId: e.target.value }))} required>
                    <option value="">Select a revision…</option>
                    {revisions.map((revision) => (
                      <option key={revision.id} value={revision.id}>Rev {revision.revisionCode} ({revision.issuedAs})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor={`field-ref-${drawingId}`}>Scan/photo reference</label>
                  <input id={`field-ref-${drawingId}`} className={input} value={fieldForm.artifactRef}
                    onChange={(e) => setFieldForm((f) => ({ ...f, artifactRef: e.target.value }))} required />
                </div>
                <div>
                  <label className={label} htmlFor={`field-sha-${drawingId}`}>File SHA-256</label>
                  <input id={`field-sha-${drawingId}`} className={input} value={fieldForm.sha256}
                    onChange={(e) => setFieldForm((f) => ({ ...f, sha256: e.target.value }))} required />
                </div>
                <div>
                  <label className={label} htmlFor={`field-reason-${drawingId}`}>Why was this marked up in the field?</label>
                  <input id={`field-reason-${drawingId}`} className={input} value={fieldForm.fieldReason}
                    onChange={(e) => setFieldForm((f) => ({ ...f, fieldReason: e.target.value }))} required />
                </div>
                <button type="submit" className={btnPrimary} disabled={busy}>Capture field hand-redline</button>
              </form>
            )}
          </div>
          {!row.retiredAt && (
            <div>
              {confirmRetire ? (
                <form className="space-y-2 rounded border border-red-200 p-3" onSubmit={submitRetire}>
                  <p className="text-xs font-medium text-red-700">Retire this drawing? Open reviews are cancelled and the active IFC release is retired. Review history is kept.</p>
                  <div>
                    <label className={label} htmlFor={`retire-reason-${drawingId}`}>Reason</label>
                    <input id={`retire-reason-${drawingId}`} className={input} value={retireReason}
                      onChange={(e) => setRetireReason(e.target.value)} required />
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" className={btnDanger} disabled={busy || !retireReason.trim()}>Retire drawing</button>
                    <button type="button" className={btnGhost} onClick={() => setConfirmRetire(false)}>Cancel</button>
                  </div>
                </form>
              ) : (
                <button type="button" className={btnDanger} onClick={() => setConfirmRetire(true)}>Retire drawing</button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function WorkPackageDrawingReadiness({ packageId, onNavigateToTab = null }) {
  const pageQuery = usePageQuery();
  const pageContext = usePackagePageContext();
  const { data, error, isLoading, refresh } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "drawing-readiness"),
    () => api(pageQuery, `/api/work-packages/${packageId}/drawings/readiness`),
    { ttlMs: 10_000 },
  );
  const drawings = data?.drawings || [];
  const counts = data?.counts || {
    drawingsTotal: 0, ifcReleased: 0, pendingReview: 0,
    returned: 0, openRequiredRedlines: 0, pendingFieldRedlines: 0,
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Drawing readiness</h2>
      <p className="mt-1 text-xs text-slate-500">
        Which controlled drawings are issued for construction, and which are still in review.
        An approved IFA review is not an issued IFC drawing — only an IFC release makes a drawing construction-usable.
      </p>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {isLoading ? (
        <p className="mt-2 text-xs text-slate-500">Loading drawing readiness…</p>
      ) : drawings.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">No drawings on this package yet.</p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded border border-slate-100 p-2">
              <dt className="text-slate-500">Drawings</dt>
              <dd className="text-base font-semibold text-slate-900">{counts.drawingsTotal}</dd>
            </div>
            <div className="rounded border border-slate-100 p-2">
              <dt className="text-slate-500">IFC issued</dt>
              <dd className="text-base font-semibold text-green-700">{counts.ifcReleased}</dd>
            </div>
            <div className="rounded border border-slate-100 p-2">
              <dt className="text-slate-500">Pending review</dt>
              <dd className="text-base font-semibold text-amber-700">{counts.pendingReview}</dd>
            </div>
            <div className="rounded border border-slate-100 p-2">
              <dt className="text-slate-500">Returned</dt>
              <dd className="text-base font-semibold text-red-700">{counts.returned}</dd>
            </div>
            <div className="rounded border border-slate-100 p-2">
              <dt className="text-slate-500">Open required redlines</dt>
              <dd className="text-base font-semibold text-red-700">{counts.openRequiredRedlines}</dd>
            </div>
            <div className="rounded border border-slate-100 p-2">
              <dt className="text-slate-500">Field redlines pending</dt>
              <dd className="text-base font-semibold text-amber-700">{counts.pendingFieldRedlines}</dd>
            </div>
          </dl>
          <ul className="mt-3 space-y-2">
            {drawings.map((row) => (
              <DrawingReviewWorkspace key={row.drawingId} packageId={packageId} row={row} onChanged={refresh} onNavigateToTab={onNavigateToTab} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
