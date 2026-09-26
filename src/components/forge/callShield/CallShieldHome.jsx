"use client";

// Call Shield home (Slice A): case list, new-case form, and the Android
// call-log import review queue. Staged imports never touch the timeline
// until the user picks a case and confirms; confirming calls the atomic
// confirm endpoint, which appends the call event and marks the import
// matched in one idempotent request.

import { useEffect, useMemo, useState } from "react";
import { fetchAllImports, findPossibleDuplicateCalls } from "@/domains/callShield/callShieldImport";
import {
  IMPORT_FILTERS,
  LABEL_OFFENDER,
  LABEL_PERSONAL,
  applyLabelFilter,
  fetchAllLabels,
  labelForNumber,
} from "@/domains/callShield/callShieldLabels";
import {
  activeColumnFilterCount,
  applyColumnFilters,
} from "@/domains/callShield/callShieldColumnFilters";
import CallShieldColumnFilters from "@/components/forge/callShield/CallShieldColumnFilters";
import { fetchNativeCallRecords, isNativeShell } from "@/lib/callShield/callShieldNative";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import {
  ForgeErrorState,
  ForgeLoadingState,
} from "@/components/forge/ForgeStates";

async function readError(response) {
  try {
    const body = await response.json();
    if (body && typeof body.error === "string" && body.error) return body.error;
  } catch {
    /* fall through */
  }
  return `Request failed (${response.status}).`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

function formatStartedAt(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatDuration(seconds) {
  const s = Number(seconds) || 0;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

// The selected case's event timeline, rendered chronologically. The client
// already fetches the full timeline (GET /api/call-shield/cases/[id]) —
// this makes it visible instead of only using it for duplicate detection.
// Rows arrive in seq order (the timeline's source of truth), which is the
// chronological order shown here.
const TIMELINE_LABELS = {
  CASE_OPENED: "Case opened",
  CALL_LOGGED: "Call logged",
  EVIDENCE_ATTACHED: "Evidence attached",
  OPT_OUT_RECORDED: "Opt-out recorded",
  DNC_REGISTRATION_RECORDED: "DNC registration recorded",
  RECORDING_CONSENT_ACKNOWLEDGED: "Recording notice acknowledged",
  DRAFT_LETTER_GENERATED: "Draft letter generated",
  EXPORT_CREATED: "Export created",
};

function timelineSummary(event) {
  const p = event?.payload || {};
  switch (event?.type) {
    case "CASE_OPENED":
      return [p.reportedBusinessName ? `Reported as ${p.reportedBusinessName}.` : "", p.notes || ""]
        .filter(Boolean)
        .join(" ");
    case "CALL_LOGGED": {
      const head = [p.numberShown, p.direction, p.occurredAt ? formatStartedAt(p.occurredAt) : ""]
        .filter(Boolean)
        .join(" · ");
      const detail = [
        p.businessNameStated ? `Claimed to represent ${p.businessNameStated}.` : "",
        p.agentName ? `Agent: ${p.agentName}.` : "",
        p.pitchNotes || "",
      ]
        .filter(Boolean)
        .join(" ");
      return [head, detail].filter(Boolean).join(" — ");
    }
    case "EVIDENCE_ATTACHED":
      return [p.kind, p.fileName].filter(Boolean).join(" · ");
    case "OPT_OUT_RECORDED":
      return [`Channel: ${p.channel}.`, p.notes || ""].filter(Boolean).join(" ");
    case "DNC_REGISTRATION_RECORDED":
      return [p.phoneNumber, p.proofNotes].filter(Boolean).join(" · ");
    case "RECORDING_CONSENT_ACKNOWLEDGED":
      return p.occurredAt ? `Acknowledged ${formatStartedAt(p.occurredAt)}.` : "";
    case "DRAFT_LETTER_GENERATED":
      return p.recipientName ? `To ${p.recipientName}.` : "";
    case "EXPORT_CREATED":
      return typeof p.itemCount === "number" ? `${p.itemCount} item${p.itemCount === 1 ? "" : "s"}.` : "";
    default:
      return "";
  }
}

export function CaseTimeline({ events }) {
  const items = Array.isArray(events) ? events : [];
  if (items.length === 0) {
    return (
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No timeline events yet.</p>
    );
  }
  return (
    <ol className="mt-2 space-y-2">
      {items.map((event) => {
        const summary = timelineSummary(event);
        return (
          <li
            key={event.id || `${event.type}-${event.recordedAt}`}
            className="rounded border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">{TIMELINE_LABELS[event.type] || event.type}</span>
              {event.recordedAt ? (
                <time className="text-xs text-slate-500 dark:text-slate-400">
                  {formatStartedAt(event.recordedAt)}
                </time>
              ) : null}
            </div>
            {summary ? (
              <p className="mt-1 text-slate-600 dark:text-slate-400">{summary}</p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

// "Showing X of Y" for the staged-call review queue. The queue is paginated
// server-side and the client pages through it all — this line keeps the
// total visible so older imports are never silently dropped.
export function ImportCountLine({ visible, total }) {
  if (typeof total !== "number") return null;
  return (
    <p role="status" className="mt-4 text-xs font-semibold text-slate-500 dark:text-slate-400">
      Showing {visible} of {total} staged call{total === 1 ? "" : "s"}.
    </p>
  );
}

export default function CallShieldHome() {
  // Cases + staged imports: stale-while-revalidate under one key. The last
  // saved lists stay on screen while a background refresh is in flight.
  const {
    data: homeData,
    error: homeError,
    isLoading: homeLoading,
    isRefreshing: homeRefreshing,
    refresh: refreshHome,
  } = useStaleWhileRevalidate(
    "call-shield:home",
    async () => {
      const [caseData, importPage] = await Promise.all([
        api("/api/call-shield/cases"),
        // Paginated server-side: page through the full queue so older
        // imports are never silently capped.
        fetchAllImports(api),
      ]);
      return {
        cases: caseData.items || [],
        imports: importPage.items,
        importTotal: importPage.total,
      };
    },
    { ttlMs: 60_000 },
  );
  const cases = homeData?.cases ?? null;
  const imports = homeData?.imports ?? null;
  const importTotal = homeData?.importTotal ?? null;
  // Contact labels live under their own key: classification needs the full
  // set and the endpoint is paginated server-side, so page through it all.
  const { data: labelsData, refresh: refreshLabels } = useStaleWhileRevalidate(
    "call-shield:labels",
    () => fetchAllLabels(api),
    { ttlMs: 60_000 },
  );
  const labels = useMemo(() => labelsData ?? [], [labelsData]);
  const [labelFilter, setLabelFilter] = useState("all");
  // Excel-style per-column filters. They stack with AND semantics and compose
  // with the label tabs above (tabs first, columns second).
  const [columnFilters, setColumnFilters] = useState({});
  // The shared "now" for the date buckets: initialized on mount and refreshed
  // every time a filter panel opens, so a tab left open past midnight still
  // buckets "Today"/"Yesterday" against the real current day.
  const [columnFilterNow, setColumnFilterNow] = useState(() => Date.now());
  const [selectedCaseId, setSelectedCaseId] = useState("");
  // Working case detail: its own key so switching cases serves the cached
  // detail instantly and revalidates behind it.
  const {
    data: caseDetailData,
    error: caseDetailError,
    isLoading: caseDetailLoading,
    refresh: refreshCaseDetail,
  } = useStaleWhileRevalidate(
    selectedCaseId ? `call-shield:case:${selectedCaseId}` : null,
    async () => {
      const data = await api(`/api/call-shield/cases/${encodeURIComponent(selectedCaseId)}`);
      return data.item;
    },
    { ttlMs: 60_000 },
  );
  const caseDetail = caseDetailData ?? null;
  const [businessName, setBusinessName] = useState("");
  const [notes, setNotes] = useState("");
  // Inline rename (name + notes) and typed-confirmation delete for the
  // working case — a typo'd business name used to be permanent.
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameNotes, setRenameNotes] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [explainPermission, setExplainPermission] = useState(false);
  const native = useMemo(() => isNativeShell(), []);

  // Escape dismisses the delete confirmation without deleting.
  useEffect(() => {
    if (!deleteArmed) return;
    const onKey = (event) => {
      if (event.key === "Escape") {
        setDeleteArmed(false);
        setDeleteTyped("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteArmed]);

  // Default the working case to the first case once the list loads, without
  // clobbering a case the user (or a mutation below) already picked.
  useEffect(() => {
    if (selectedCaseId || !cases?.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time default, guarded above so it never loops
    setSelectedCaseId(cases[0].id);
  }, [cases, selectedCaseId]);

  // A failed detail load still reads as a load error, like before (rendered
  // inline with the transient error below -- no state sync needed).
  const detailLoadError = !caseDetail && caseDetailError ? caseDetailError : "";

  async function handleCreateCase(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy("create-case");
    try {
      const data = await api("/api/call-shield/cases", {
        method: "POST",
        body: JSON.stringify({ reportedBusinessName: businessName, notes }),
      });
      setBusinessName("");
      setNotes("");
      setSelectedCaseId(data.item.id);
      setNotice(`Case opened for ${data.item.reportedBusinessName}.`);
      await refreshHome();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  function openRename() {
    setRenameValue(caseDetail?.reportedBusinessName || "");
    setRenameNotes(caseDetail?.notes || "");
    setRenaming(true);
  }

  async function handleRenameCase(event) {
    event.preventDefault();
    const name = renameValue.trim();
    if (!name) {
      setError("Give the case a name.");
      return;
    }
    setError("");
    setNotice("");
    setBusy("rename-case");
    try {
      const data = await api(`/api/call-shield/cases/${encodeURIComponent(selectedCaseId)}`, {
        method: "PATCH",
        body: JSON.stringify({ reportedBusinessName: name, notes: renameNotes }),
      });
      setRenaming(false);
      setNotice(`Case renamed to ${data.item.reportedBusinessName}.`);
      await refreshCaseDetail();
      await refreshHome();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteCase() {
    setError("");
    setNotice("");
    setBusy("delete-case");
    try {
      await api(`/api/call-shield/cases/${encodeURIComponent(selectedCaseId)}`, {
        method: "DELETE",
      });
      setDeleteArmed(false);
      setDeleteTyped("");
      setSelectedCaseId("");
      setNotice("Case deleted, along with its timeline.");
      await refreshHome();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function handleImportFromPhone() {    // The OS permission dialog appears only after the user taps Continue in
    // the explanation below — never as a surprise on first tap.
    setExplainPermission(false);
    setError("");
    setNotice("");
    setBusy("import");
    try {
      const records = await fetchNativeCallRecords({ days: 30 });
      if (!records.length) {
        setNotice("No call records came back from the phone.");
        return;
      }
      const data = await api("/api/call-shield/imports", {
        method: "POST",
        body: JSON.stringify({ records }),
      });
      setNotice(`${data.received} call record(s) received for your review. Nothing was added to any case yet.`);
      await refreshHome();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function handleConfirm(importRow) {
    if (!selectedCaseId) {
      setError("Pick a case first.");
      return;
    }
    setError("");
    setBusy(`confirm-${importRow.id}`);
    try {
      // One request: the server appends the timeline event and marks the
      // import matched atomically (idempotent on retry).
      await api(`/api/call-shield/imports/${encodeURIComponent(importRow.id)}/confirm`, {
        method: "POST",
        body: JSON.stringify({ caseId: selectedCaseId }),
      });
      await refreshCaseDetail();
      setNotice(`Call from ${importRow.phone_number} logged on the case.`);
      await refreshHome();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function handleDismiss(importRow) {
    setBusy(`dismiss-${importRow.id}`);
    try {
      await api(`/api/call-shield/imports/${encodeURIComponent(importRow.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ dismissed: true }),
      });
      await refreshHome();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function handleLabel(importRow, label) {
    setError("");
    setBusy(`label-${importRow.id}`);
    try {
      await api("/api/call-shield/labels", {
        method: "POST",
        body: JSON.stringify({ phoneNumber: importRow.phone_number, label }),
      });
      setNotice(
        label === LABEL_OFFENDER
          ? `${importRow.phone_number} marked as an offender. The symbol will stick to this number.`
          : `${importRow.phone_number} marked personal — filter it out of the review queue anytime.`,
      );
      await refreshLabels();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function handleRemoveLabel(importRow) {
    setBusy(`label-${importRow.id}`);
    try {
      await api(`/api/call-shield/labels?phoneNumber=${encodeURIComponent(importRow.phone_number)}`, {
        method: "DELETE",
      });
      await refreshLabels();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  const existingCalls = caseDetail?.calls || [];

  const tabImports = applyLabelFilter(imports ?? [], labels, labelFilter);
  const visibleImports = applyColumnFilters(tabImports, columnFilters, {
    labels,
    now: columnFilterNow,
  });
  const filterCounts = useMemo(() => {
    const list = imports ?? [];
    const counts = { all: list.length, personal: 0, offender: 0, unlabeled: 0 };
    for (const row of list) {
      const kind = labelForNumber(labels, row.phone_number)?.label;
      if (kind === LABEL_PERSONAL) counts.personal += 1;
      else if (kind === LABEL_OFFENDER) counts.offender += 1;
      else counts.unlabeled += 1;
    }
    return counts;
  }, [imports, labels]);

  return (
    <div className="space-y-8">
      {(error || detailLoadError) && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error || detailLoadError}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {notice}
        </p>
      )}

      {!homeData && homeLoading ? <ForgeLoadingState label="Loading Call Shield…" /> : null}
      {!homeData && homeError ? (
        <ForgeErrorState title={homeError || "Unable to load Call Shield."} onRetry={refreshHome} />
      ) : null}
      {homeData && homeRefreshing ? (
        <p role="status" className="text-xs font-bold text-slate-400 dark:text-slate-500">Updating…</p>
      ) : null}
      {homeData && homeError ? (
        <p role="status" className="text-xs font-bold text-slate-400 dark:text-slate-500">
          Could not refresh — showing the last saved cases and imports.
        </p>
      ) : null}

      {!homeData ? null : (
      <>
      <section className="rounded border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-lg font-semibold">Cases</h2>
        <form onSubmit={handleCreateCase} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium">Business name (as they claimed)</span>
            <input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. the name they gave on the call"
              className="w-64 rounded border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            />
          </label>
          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium">Notes (optional)</span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything you remember"
              className="w-64 rounded border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            />
          </label>
          <button
            type="submit"
            disabled={busy === "create-case"}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {busy === "create-case" ? "Opening…" : "Open case"}
          </button>
        </form>
        {(cases ?? []).length > 0 && (
          <label className="mt-4 flex flex-col text-sm">
            <span className="mb-1 font-medium">Working case</span>
            <select
              value={selectedCaseId}
              onChange={(e) => setSelectedCaseId(e.target.value)}
              className="w-64 rounded border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            >
              {(cases ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.reported_business_name}
                </option>
              ))}
            </select>
          </label>
        )}

        {selectedCaseId && (
          <div className="mt-4 rounded border border-slate-200 p-4 dark:border-slate-700">
            {caseDetailLoading && !caseDetail ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Loading case…</p>
            ) : caseDetail ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-bold">{caseDetail.reportedBusinessName}</h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Opened {formatStartedAt(caseDetail.createdAt)} · {caseDetail.callCount} logged
                      call{caseDetail.callCount === 1 ? "" : "s"}
                    </p>
                    {caseDetail.notes ? (
                      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                        {caseDetail.notes}
                      </p>
                    ) : null}
                  </div>
                  {!renaming && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={openRename}
                        className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50 dark:border-slate-600"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteTyped("");
                          setDeleteArmed(true);
                        }}
                        className="rounded border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50 dark:border-red-700 dark:text-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>

                {renaming && (
                  <form onSubmit={handleRenameCase} className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="flex flex-col text-sm">
                      <span className="mb-1 font-medium">Business name</span>
                      <input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        autoFocus
                        className="w-64 rounded border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                      />
                    </label>
                    <label className="flex flex-col text-sm">
                      <span className="mb-1 font-medium">Notes</span>
                      <input
                        value={renameNotes}
                        onChange={(e) => setRenameNotes(e.target.value)}
                        className="w-64 rounded border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={busy === "rename-case"}
                      className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                    >
                      {busy === "rename-case" ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenaming(false)}
                      className="rounded border border-slate-300 px-4 py-2 text-sm dark:border-slate-600"
                    >
                      Cancel
                    </button>
                  </form>
                )}

                <h4 className="mt-4 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  Case timeline
                </h4>
                <CaseTimeline events={caseDetail.events} />
              </>
            ) : null}
          </div>
        )}

        {deleteArmed && caseDetail && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label={`Delete case ${caseDetail.reportedBusinessName}`}
          >
            <button
              type="button"
              aria-label="Cancel delete"
              tabIndex={-1}
              onClick={() => {
                setDeleteArmed(false);
                setDeleteTyped("");
              }}
              className="absolute inset-0 cursor-default bg-slate-950/60"
            />
            <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
              <h3 className="text-lg font-bold text-red-700 dark:text-red-400">Delete this case?</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                This permanently deletes{" "}
                <span className="font-semibold">{caseDetail.reportedBusinessName}</span> and its
                entire timeline ({caseDetail.callCount} logged call
                {caseDetail.callCount === 1 ? "" : "s"}). Staged imports matched to it return to
                the review queue. This cannot be undone.
              </p>
              <label className="mt-4 flex flex-col text-sm">
                <span className="mb-1 font-medium">
                  Type <span className="font-bold">{caseDetail.reportedBusinessName}</span> to
                  confirm
                </span>
                <input
                  value={deleteTyped}
                  onChange={(e) => setDeleteTyped(e.target.value)}
                  autoFocus
                  className="rounded border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                />
              </label>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={handleDeleteCase}
                  disabled={busy === "delete-case" || deleteTyped !== caseDetail.reportedBusinessName}
                  className="rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy === "delete-case" ? "Deleting…" : "Delete case"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteArmed(false);
                    setDeleteTyped("");
                  }}
                  className="rounded border border-slate-300 px-4 py-2 text-sm dark:border-slate-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="rounded border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-lg font-semibold">Call history import</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Imports are staged for your review first — nothing is added to a case until you confirm it.
        </p>
        <div className="mt-3">
          {native ? (
            explainPermission ? (
              <div className="rounded border border-slate-300 bg-slate-50 p-4 text-sm dark:border-slate-600 dark:bg-slate-800">
                <p className="font-semibold">Before we read your call history</p>
                <p className="mt-2 text-slate-600 dark:text-slate-400">
                  Call Shield asks Android for permission to read this phone&apos;s call log so it
                  can find the calls for you automatically. It reads recent call records on this
                  device only — number, time, and duration — and stages them above for your review.
                  Nothing is added to a case until you confirm it.
                </p>
                <p className="mt-2 text-slate-600 dark:text-slate-400">
                  If you decline, you can still log calls manually — nothing else changes.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={handleImportFromPhone}
                    disabled={busy === "import"}
                    className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                  >
                    {busy === "import" ? "Reading call log…" : "Continue"}
                  </button>
                  <button
                    onClick={() => setExplainPermission(false)}
                    className="rounded border border-slate-300 px-4 py-2 text-sm dark:border-slate-600"
                  >
                    Not now
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setExplainPermission(true)}
                disabled={busy === "import"}
                className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
              >
                Import last 30 days from this phone
              </button>
            )
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Automatic import needs the Call Shield Android app — a web page is not allowed to read
              your call history. Install the app on your phone, open this page inside it, and the
              import button will appear here.
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter staged calls by contact label">
          {IMPORT_FILTERS.map((filter) => {
            const label =
              filter === "personal"
                ? "Personal"
                : filter === "offender"
                  ? "\uD83D\uDEAB Offenders"
                  : filter === "unlabeled"
                    ? "Unlabeled"
                    : "All";
            const active = labelFilter === filter;
            return (
              <button
                key={filter}
                onClick={() => setLabelFilter(filter)}
                aria-pressed={active}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  active
                    ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                    : "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"
                }`}
              >
                {label} ({filterCounts[filter]})
              </button>
            );
          })}
        </div>

        {tabImports.length > 0 && (
          <CallShieldColumnFilters
            rows={tabImports}
            labels={labels}
            filters={columnFilters}
            onChange={setColumnFilters}
            resultCount={visibleImports.length}
            now={columnFilterNow}
            onOpenColumn={() => setColumnFilterNow(Date.now())}
          />
        )}

        <ImportCountLine visible={visibleImports.length} total={importTotal} />

        <div className="mt-4 space-y-2">
          {visibleImports.length === 0 && (
            <p className="text-sm text-slate-500">
              {(imports ?? []).length === 0
                ? "No staged imports. Nothing waiting for review."
                : activeColumnFilterCount(columnFilters) > 0
                  ? "No staged calls match these column filters. Clear the filters to see every staged call."
                  : "No calls match this filter."}
            </p>
          )}
          {visibleImports.map((row) => {
            const contactLabel = labelForNumber(labels, row.phone_number);
            const isOffender = contactLabel?.label === LABEL_OFFENDER;
            const isPersonal = contactLabel?.label === LABEL_PERSONAL;
            const duplicates = findPossibleDuplicateCalls(
              {
                phoneNumber: row.phone_number,
                startedAt: row.started_at,
                durationSeconds: row.duration_seconds,
              },
              existingCalls,
            );
            return (
              <div
                key={row.id}
                className="flex flex-wrap items-center gap-3 rounded border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-semibold">
                    {isOffender && <span className="mr-1">{contactLabel.symbol || "\u26A0"}</span>}
                    {row.phone_number}
                  </span>
                  {row.caller_name && <span className="ml-2 text-slate-500">({row.caller_name})</span>}
                  <span className="ml-2 text-slate-500">
                    {formatStartedAt(row.started_at)} · {formatDuration(row.duration_seconds)} · {row.call_type}
                  </span>
                  {isOffender && (
                    <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-900 dark:text-red-200">
                      Offender
                    </span>
                  )}
                  {isPersonal && (
                    <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                      Personal
                    </span>
                  )}
                  {duplicates.length > 0 && (
                    <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      Possible duplicate
                    </span>
                  )}
                  {row.matched_case_id && (
                    <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-700">
                      Logged
                    </span>
                  )}
                </div>
                {!contactLabel ? (
                  <>
                    <button
                      onClick={() => handleLabel(row, LABEL_PERSONAL)}
                      disabled={busy === `label-${row.id}`}
                      className="rounded border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50 dark:border-slate-600"
                    >
                      Mark personal
                    </button>
                    <button
                      onClick={() => handleLabel(row, LABEL_OFFENDER)}
                      disabled={busy === `label-${row.id}`}
                      className="rounded border border-red-300 px-3 py-1.5 text-xs text-red-700 disabled:opacity-50 dark:border-red-700 dark:text-red-300"
                    >
                      🚫 Mark offender
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => handleRemoveLabel(row)}
                    disabled={busy === `label-${row.id}`}
                    className="rounded border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50 dark:border-slate-600"
                  >
                    Remove label
                  </button>
                )}
                {!row.matched_case_id && (
                  <>
                    <button
                      onClick={() => handleConfirm(row)}
                      disabled={busy === `confirm-${row.id}` || !selectedCaseId}
                      className="rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                    >
                      {busy === `confirm-${row.id}` ? "Logging…" : "Log on case"}
                    </button>
                    <button
                      onClick={() => handleDismiss(row)}
                      disabled={busy === `dismiss-${row.id}`}
                      className="rounded border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50 dark:border-slate-600"
                    >
                      Dismiss
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>
      </>
      )}
    </div>
  );
}
