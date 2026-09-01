"use client";
import { useCallback, useEffect, useState } from "react";

const SEVERITY_CLASS = {
  critical: "border-rose-400 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200",
  high: "border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-200",
  medium: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200",
  low: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

const STATUS_LABEL = {
  new: "New", reviewed: "Reviewed", rejected: "Rejected",
  revision_requested: "Revision requested", preview_approved: "Preview approved",
};

const CATEGORY_LABEL = {
  horizontal_overflow: "Horizontal overflow", clipped_or_truncated_control: "Clipped/truncated control",
  unreadable_contrast: "Unreadable contrast", missing_dark_mode_foreground: "Missing dark-mode foreground",
  overlapping_content: "Overlapping content", empty_state_layout_defect: "Empty-state layout defect",
  inconsistent_spacing: "Inconsistent spacing", undersized_touch_target: "Undersized touch target",
  missing_accessible_name: "Missing accessible name", keyboard_focus_visibility: "Keyboard focus visibility",
  breakpoint_regression: "Breakpoint regression", loading_error_status_communication: "Loading/error status communication",
  misleading_chart: "Misleading chart",
};

const ACTIONS = [
  { action: "review", label: "Review" },
  { action: "reject", label: "Reject" },
  { action: "request_revision", label: "Request revision" },
  { action: "approve_preview", label: "Approve preview" },
];

function Detail({ label, children }) {
  return (
    <div className="mt-3">
      <div className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-700 dark:text-slate-300">{children}</div>
    </div>
  );
}

function DetailList({ label, items }) {
  return (
    <div className="mt-3">
      <div className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</div>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-300">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function FindingCard({ finding, onAction, actionPending }) {
  const [expanded, setExpanded] = useState(false);
  const isSubjective = finding.findingClass === "subjective";

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-950 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-black uppercase tracking-wide text-slate-500">
              {isSubjective ? "Subjective suggestion" : "Deterministic finding"}
            </span>
            {!isSubjective ? (
              <span className={`rounded-full border px-2 py-0.5 text-xs font-black ${SEVERITY_CLASS[finding.severity] || SEVERITY_CLASS.low}`}>
                {finding.severity}
              </span>
            ) : null}
            <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
              confidence: {finding.confidence}
            </span>
            <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {STATUS_LABEL[finding.status] || finding.status}
            </span>
          </div>
          <h3 className="mt-2 text-lg font-black">{CATEGORY_LABEL[finding.category] || finding.category}</h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {finding.application} — {finding.routePath} — {finding.viewport}
            {finding.affectedComponent ? ` — ${finding.affectedComponent}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="shrink-0 rounded-xl border border-slate-300 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {expanded ? "Hide detail" : "Show detail"}
        </button>
      </div>

      {expanded ? (
        <div className="mt-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <Detail label="Screenshot evidence">
            <code className="break-all text-xs">{finding.screenshotHash}</code>
          </Detail>
          <Detail label="Plain-language explanation">{finding.explanation}</Detail>
          <Detail label="Proposed improvement">{finding.proposedImprovement}</Detail>
          <DetailList label="Probable source files" items={finding.probableSourceFiles} />
          <DetailList label="Validation requirements" items={finding.validationRequirements} />
          <DetailList label="Prohibited scope" items={finding.prohibitedScope} />
          <Detail label="Rollback description">{finding.rollbackDescription}</Detail>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
        {ACTIONS.map(({ action, label }) => (
          <button
            key={action}
            type="button"
            disabled={actionPending}
            onClick={() => onAction(finding.findingId, action)}
            className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {label}
          </button>
        ))}
      </div>
    </article>
  );
}

export default function UiImprovementManagerPanel() {
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingFindingId, setPendingFindingId] = useState(null);

  const load = useCallback(() => {
    // No setLoading(true) here: `loading` already initializes true, and this is only ever invoked
    // once, from the mount effect below -- an explicit reset would be a synchronous setState call
    // inside that effect's body, which is exactly what react-hooks/set-state-in-effect disallows.
    return fetch("/api/forge/developer/ui-improvement-manager/proposals")
      .then((res) => res.json().then((payload) => ({ res, payload })))
      .then(({ res, payload }) => {
        if (!res.ok) throw new Error(payload.error || "Unable to load UI improvement proposals.");
        setFindings(payload.findings);
        setError("");
      })
      .catch((loadError) => setError(loadError.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const onAction = useCallback((findingId, action) => {
    setPendingFindingId(findingId);
    fetch("/api/forge/developer/ui-improvement-manager/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ findingId, action }),
    })
      .then((res) => res.json().then((payload) => ({ res, payload })))
      .then(({ res, payload }) => {
        if (!res.ok) throw new Error(payload.error || "Unable to update this proposal.");
        setFindings((current) => current.map((finding) => (finding.findingId === findingId ? payload.finding : finding)));
      })
      .catch((actionError) => setError(actionError.message))
      .finally(() => setPendingFindingId(null));
  }, []);

  const deterministic = findings.filter((finding) => finding.findingClass === "deterministic");
  const subjective = findings.filter((finding) => finding.findingClass === "subjective");

  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">Private Programmer Tools</div>
      <h1 className="mt-2 text-2xl font-black">UI Improvement Manager — proposals</h1>
      <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600 dark:text-slate-400">
        Every item below was detected deterministically from measured page structure (layout geometry,
        computed styles, accessible names) against approved screenshot evidence — never a visual guess.
        &ldquo;Approve preview&rdquo; only marks a proposal for further owner action; it does not commit,
        push, open a pull request, merge, deploy, migrate, or touch Production by itself.
      </p>

      {loading ? <p role="status" className="mt-6 text-sm font-semibold text-slate-500">Loading proposals…</p> : null}
      {error ? <p role="alert" className="mt-6 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm font-bold text-rose-900 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200">{error}</p> : null}

      {!loading && !error && findings.length === 0 ? (
        <p className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          No findings yet. Run the FB-UI-1 screenshot-evidence CLI, then the FB-UI-2 finding-engine CLI,
          against <code>ui-improvement-manager/evidence/latest</code> to populate this list.
        </p>
      ) : null}

      {deterministic.length > 0 ? (
        <section className="mt-6 space-y-4">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Deterministic findings ({deterministic.length})</h2>
          {deterministic.map((finding) => (
            <FindingCard key={finding.findingId} finding={finding} onAction={onAction} actionPending={pendingFindingId === finding.findingId} />
          ))}
        </section>
      ) : null}

      {subjective.length > 0 ? (
        <section className="mt-8 space-y-4">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Subjective suggestions ({subjective.length}) — not defects</h2>
          {subjective.map((finding) => (
            <FindingCard key={finding.findingId} finding={finding} onAction={onAction} actionPending={pendingFindingId === finding.findingId} />
          ))}
        </section>
      ) : null}
    </main>
  );
}
