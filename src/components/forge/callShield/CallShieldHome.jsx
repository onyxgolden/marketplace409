"use client";

// Call Shield home (Slice A): case list, new-case form, and the Android
// call-log import review queue. Staged imports never touch the timeline
// until the user picks a case and confirms; confirming calls the atomic
// confirm endpoint, which appends the call event and marks the import
// matched in one idempotent request.

import { useEffect, useMemo, useState } from "react";
import { findPossibleDuplicateCalls } from "@/domains/callShield/callShieldImport";
import { fetchNativeCallRecords, isNativeShell } from "@/lib/callShield/callShieldNative";

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

export default function CallShieldHome() {
  const [cases, setCases] = useState([]);
  const [imports, setImports] = useState([]);
  const [caseDetail, setCaseDetail] = useState(null);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [explainPermission, setExplainPermission] = useState(false);
  const native = useMemo(() => isNativeShell(), []);

  async function refresh() {
    const [caseData, importData] = await Promise.all([
      api("/api/call-shield/cases"),
      api("/api/call-shield/imports"),
    ]);
    setCases(caseData.items || []);
    setImports(importData.items || []);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [caseData, importData] = await Promise.all([
          api("/api/call-shield/cases"),
          api("/api/call-shield/imports"),
        ]);
        if (cancelled) return;
        setCases(caseData.items || []);
        setImports(importData.items || []);
        if (caseData.items?.length) {
          setSelectedCaseId((current) => current || caseData.items[0].id);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedCaseId) return;
    let cancelled = false;
    api(`/api/call-shield/cases/${encodeURIComponent(selectedCaseId)}`)
      .then((data) => {
        if (!cancelled) setCaseDetail(data.item);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCaseId]);

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
      await refresh();
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
      await refresh();
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
      const detail = await api(`/api/call-shield/cases/${encodeURIComponent(selectedCaseId)}`);
      setCaseDetail(detail.item);
      setNotice(`Call from ${importRow.phone_number} logged on the case.`);
      await refresh();
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
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  const existingCalls = caseDetail?.calls || [];

  return (
    <div className="space-y-8">
      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {notice}
        </p>
      )}

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
        {cases.length > 0 && (
          <label className="mt-4 flex flex-col text-sm">
            <span className="mb-1 font-medium">Working case</span>
            <select
              value={selectedCaseId}
              onChange={(e) => setSelectedCaseId(e.target.value)}
              className="w-64 rounded border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            >
              {cases.map((c) => (
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

        <div className="mt-4 space-y-2">
          {imports.length === 0 && (
            <p className="text-sm text-slate-500">No staged imports. Nothing waiting for review.</p>
          )}
          {imports.map((row) => {
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
                  <span className="font-semibold">{row.phone_number}</span>
                  {row.caller_name && <span className="ml-2 text-slate-500">({row.caller_name})</span>}
                  <span className="ml-2 text-slate-500">
                    {formatStartedAt(row.started_at)} · {formatDuration(row.duration_seconds)} · {row.call_type}
                  </span>
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
    </div>
  );
}
