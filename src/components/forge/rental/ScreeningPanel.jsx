"use client";

import { useCallback, useEffect, useState } from "react";
import { SCREENING_COMPLIANCE_NOTE } from "@/domains/rental-screening/screening";

// Rentec parity R22 — screening tab for the application review (free layer).
//
// Self-contained: needs only an applicationId. Mount in R21's application
// review (see SCREENING_GATE.md). Manual results are recorded by the owner
// after running screening elsewhere; integrated providers are always
// "not connected" (gated). Approve/Deny delegates to R21's existing
// POST /api/rental/applications/[id]/decision endpoint with a
// screening-tagged reason — R22 never duplicates the decision flow.

const STATUS_LABELS = {
  not_requested: "Not requested",
  requested: "Requested",
  in_progress: "In progress",
  complete: "Complete",
};

const inputClass = "w-full rounded border border-gray-300 px-2 py-1 text-sm";
const buttonClass = "rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";
const secondaryButtonClass = "rounded border border-gray-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50";

function StatusBadge({ status }) {
  const colors = {
    not_requested: "bg-gray-200 text-gray-800",
    requested: "bg-yellow-200 text-yellow-900",
    in_progress: "bg-blue-200 text-blue-900",
    complete: "bg-green-200 text-green-900",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${colors[status] || "bg-gray-200"}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export default function ScreeningPanel({ applicationId, applicantName, onDecide }) {
  const [state, setState] = useState({ loading: true, error: null, screening: null, events: [], providers: [], suggestion: null });
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState({ creditScore: "", creditBand: "", criminalFlag: false, criminalNotes: "", evictionFlag: false, evictionNotes: "" });
  const [recommendation, setRecommendation] = useState({ recommendation: "", reasons: "" });
  const [copied, setCopied] = useState(false);
  const [applicantLink, setApplicantLink] = useState(null);

  const reload = useCallback(async () => {
    setActionError(null);
    try {
      const res = await fetch(`/api/rental/applications/${encodeURIComponent(applicationId)}/screening`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to load screening.");
      setState({ loading: false, error: null, screening: data.screening, events: data.events || [], providers: data.providers || [], suggestion: data.suggestion });
      if (data.screening) {
        setResults({
          creditScore: data.screening.creditScore ?? "",
          creditBand: data.screening.creditBand ?? "",
          criminalFlag: !!data.screening.criminalFlag,
          criminalNotes: data.screening.criminalNotes ?? "",
          evictionFlag: !!data.screening.evictionFlag,
          evictionNotes: data.screening.evictionNotes ?? "",
        });
        setRecommendation({
          recommendation: data.screening.recommendation ?? "",
          reasons: data.screening.recommendationReasons ?? "",
        });
      }
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }, [applicationId]);

  useEffect(() => { reload(); }, [reload]);

  async function callApi(method, body) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/rental/applications/${encodeURIComponent(applicationId)}/screening`, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed.");
      return data;
    } catch (error) {
      setActionError(error.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function requestScreening() {
    const data = await callApi("POST");
    if (data) await reload();
    return data;
  }

  async function runAction(action, extra = {}) {
    const data = await callApi("PATCH", { action, ...extra });
    if (data) {
      if (data.applicantLink) setApplicantLink(data.applicantLink);
      await reload();
    }
  }

  async function copyLink() {
    if (!applicantLink) return;
    try {
      await navigator.clipboard.writeText(applicantLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  // Delegates the real decision to R21's decision endpoint. reason is tagged
  // "Screening:" so the audit row shows the screening grounds.
  async function decide(action) {
    const screening = state.screening;
    const reason = `Screening: ${screening?.recommendation || "no recommendation recorded"}`
      + (screening?.recommendationReasons ? ` — ${screening.recommendationReasons}` : "");
    if (onDecide) {
      onDecide(action, reason);
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const payload = { action, reason };
      if (action === "approve") {
        const startDate = window.prompt("Lease start date (YYYY-MM-DD) required to approve:");
        if (!startDate) return;
        payload.lease = { startDate };
      }
      const res = await fetch(`/api/rental/applications/${encodeURIComponent(applicationId)}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Decision failed.");
      await reload();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy(false);
    }
  }

  if (state.loading) return <div className="text-sm text-gray-600">Loading screening…</div>;
  if (state.error) {
    return (
      <div className="text-sm text-red-700">
        {state.error}
        <button type="button" onClick={reload} className={`${secondaryButtonClass} ml-2`}>Retry</button>
      </div>
    );
  }

  const screening = state.screening;
  const open = screening && ["requested", "in_progress"].includes(screening.status);

  return (
    <div className="space-y-4 text-sm">
      {actionError ? <p className="rounded bg-red-50 p-2 text-red-700">{actionError}</p> : null}

      <div className="flex items-center gap-2">
        <h3 className="font-semibold">Screening</h3>
        {screening ? <StatusBadge status={screening.status} /> : <StatusBadge status="not_requested" />}
        {applicantName ? <span className="text-gray-600">· {applicantName}</span> : null}
      </div>

      {!screening ? (
        <div className="rounded border border-gray-200 p-3">
          <p className="text-gray-700">No screening requested yet. The request is only accepted when the
          applicant&apos;s screening consent is recorded — the application form collects it at submit time,
          or the applicant can confirm it through the screening link after you request.</p>
          <button type="button" onClick={requestScreening} disabled={busy} className={`${buttonClass} mt-2`}>
            Request screening
          </button>
        </div>
      ) : (
        <>
          {open ? (
            <div className="rounded border border-gray-200 p-3">
              <p className="font-medium">Applicant link</p>
              <p className="text-gray-600">Send this link to the applicant — they provide screening info and
              confirm consent. No login needed; the link is rate-limited.</p>
              <div className="mt-2 flex items-center gap-2">
                <input readOnly className={inputClass} value={applicantLink || "(request a new link after regenerating)"} />
                <button type="button" onClick={() => runAction("regenerate_token")} disabled={busy} className={secondaryButtonClass}>
                  {applicantLink ? "Regenerate" : "Show link"}
                </button>
                {applicantLink ? (
                  <button type="button" onClick={copyLink} disabled={busy} className={secondaryButtonClass}>
                    {copied ? "Copied!" : "Copy"}
                  </button>
                ) : null}
              </div>
              {screening.status === "requested" ? (
                <button type="button" onClick={() => runAction("mark_in_progress")} disabled={busy} className={`${secondaryButtonClass} mt-2`}>
                  Mark in progress
                </button>
              ) : null}
            </div>
          ) : null}

          {open ? (
            <div className="rounded border border-gray-200 p-3">
              <p className="font-medium">Manual results</p>
              <p className="text-gray-600">Run screening through your provider of choice, then record the outcome here.</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="block">Credit score (300–850)
                  <input className={inputClass} value={results.creditScore}
                    onChange={(e) => setResults((r) => ({ ...r, creditScore: e.target.value === "" ? "" : Number(e.target.value) }))} />
                </label>
                <label className="block">Credit band
                  <select className={inputClass} value={results.creditBand}
                    onChange={(e) => setResults((r) => ({ ...r, creditBand: e.target.value }))}>
                    <option value="">—</option>
                    <option value="poor">Poor</option>
                    <option value="fair">Fair</option>
                    <option value="good">Good</option>
                    <option value="very_good">Very good</option>
                    <option value="excellent">Excellent</option>
                  </select>
                </label>
              </div>
              <label className="mt-2 flex items-center gap-2">
                <input type="checkbox" checked={results.criminalFlag}
                  onChange={(e) => setResults((r) => ({ ...r, criminalFlag: e.target.checked }))} />
                Criminal history found
              </label>
              <textarea className={`${inputClass} mt-1`} rows={2} placeholder="Criminal history notes"
                value={results.criminalNotes} onChange={(e) => setResults((r) => ({ ...r, criminalNotes: e.target.value }))} />
              <label className="mt-2 flex items-center gap-2">
                <input type="checkbox" checked={results.evictionFlag}
                  onChange={(e) => setResults((r) => ({ ...r, evictionFlag: e.target.checked }))} />
                Eviction history found
              </label>
              <textarea className={`${inputClass} mt-1`} rows={2} placeholder="Eviction history notes"
                value={results.evictionNotes} onChange={(e) => setResults((r) => ({ ...r, evictionNotes: e.target.value }))} />
              <button type="button" disabled={busy}
                onClick={() => runAction("record_results", {
                  results: {
                    creditScore: results.creditScore === "" ? null : results.creditScore,
                    creditBand: results.creditBand || null,
                    criminalFlag: results.criminalFlag,
                    criminalNotes: results.criminalNotes,
                    evictionFlag: results.evictionFlag,
                    evictionNotes: results.evictionNotes,
                  },
                })}
                className={`${buttonClass} mt-2`}>
                Save results
              </button>
            </div>
          ) : null}

          {screening.status !== "not_requested" ? (
            <div className="rounded border border-gray-200 p-3">
              <p className="font-medium">Recommendation</p>
              {state.suggestion ? (
                <p className="text-gray-600">Suggestion from recorded results: <strong>{state.suggestion.recommendation}</strong>
                  {state.suggestion.reasons.length ? ` (${state.suggestion.reasons.join(" ")})` : null} — the decision is always yours.</p>
              ) : null}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="block">Your recommendation
                  <select className={inputClass} value={recommendation.recommendation}
                    onChange={(e) => setRecommendation((r) => ({ ...r, recommendation: e.target.value }))}>
                    <option value="">—</option>
                    <option value="approve">Approve</option>
                    <option value="conditional">Conditional</option>
                    <option value="deny">Deny</option>
                  </select>
                </label>
              </div>
              <textarea className={`${inputClass} mt-2`} rows={2} placeholder="Reasons (recorded on the audit trail)"
                value={recommendation.reasons} onChange={(e) => setRecommendation((r) => ({ ...r, reasons: e.target.value }))} />
              {open ? (
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={busy || !recommendation.recommendation}
                    onClick={() => runAction("set_recommendation", {
                      recommendationInput: { recommendation: recommendation.recommendation, reasons: recommendation.reasons },
                    })}
                    className={secondaryButtonClass}>
                    Save recommendation
                  </button>
                  <button type="button" disabled={busy}
                    onClick={() => runAction("complete")}
                    className={buttonClass}>
                    Complete screening
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {screening.status === "complete" ? (
            <div className="rounded border border-gray-200 p-3">
              <p className="font-medium">Decide the application</p>
              <p className="text-gray-600">The decision is recorded through the application&apos;s approve/deny flow with a screening-tagged reason.</p>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy} onClick={() => decide("approve")} className={buttonClass}>Approve</button>
                <button type="button" disabled={busy} onClick={() => decide("deny")} className="rounded bg-red-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Deny</button>
              </div>
            </div>
          ) : null}

          <div className="rounded border border-gray-200 p-3">
            <p className="font-medium">Integrated providers</p>
            <ul className="mt-1 list-disc pl-5 text-gray-700">
              {state.providers.map((provider) => (
                <li key={provider.providerKey}>
                  {provider.providerName}: <strong>not connected</strong> — gated. Pulling a report costs a
                  per-report fee and needs Jason&apos;s approval (provider, cost, who pays).
                </li>
              ))}
            </ul>
          </div>

          {state.events.length ? (
            <div className="rounded border border-gray-200 p-3">
              <p className="font-medium">Decision log</p>
              <ul className="mt-1 space-y-1 text-gray-700">
                {state.events.map((event) => (
                  <li key={event.id}>
                    <span className="font-medium">{event.event.replaceAll("_", " ")}</span>
                    <span className="text-gray-500"> · {new Date(event.created_at).toLocaleString()}</span>
                    {event.note ? <span> · {event.note}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">{SCREENING_COMPLIANCE_NOTE}</p>
    </div>
  );
}
