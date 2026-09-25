"use client";

// Call Shield home (Slice A): case list, new-case form, and the Android
// call-log import review queue. Staged imports never touch the timeline
// until the user picks a case and confirms; confirming calls the atomic
// confirm endpoint, which appends the call event and marks the import
// matched in one idempotent request.

import { useEffect, useMemo, useState } from "react";
import { findPossibleDuplicateCalls } from "@/domains/callShield/callShieldImport";
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

// "Now" for the Excel-style date buckets, captured once when this module
// loads so the buckets stay stable while the review list is open (and so
// render stays pure — the hooks purity rule forbids Date.now() in render).
const COLUMN_FILTER_NOW = Date.now();

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
      const [caseData, importData] = await Promise.all([
        api("/api/call-shield/cases"),
        api("/api/call-shield/imports"),
      ]);
      return { cases: caseData.items || [], imports: importData.items || [] };
    },
    { ttlMs: 60_000 },
  );
  const cases = homeData?.cases ?? null;
  const imports = homeData?.imports ?? null;
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
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [explainPermission, setExplainPermission] = useState(false);
  const native = useMemo(() => isNativeShell(), []);

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

  async function handleImportFromPhone() {
    // The OS permission dialog appears only after the user taps Continue in
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
    now: COLUMN_FILTER_NOW,
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
          />
        )}

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
