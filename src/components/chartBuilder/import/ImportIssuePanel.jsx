"use client";

// FORGE Chart Builder — import issue list (slice 3.2).
//
// Renders the preview's issues grouped errors-then-warnings, each traced to
// its spreadsheet row when known.

export default function ImportIssuePanel({ issues }) {
  if (!issues || issues.length === 0) {
    return (
      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
        No problems found — this import is clean.
      </p>
    );
  }
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  return (
    <div className="space-y-3">
      {errors.length > 0 && (
        <IssueGroup title={`${errors.length} error${errors.length === 1 ? "" : "s"}`} tone="red" issues={errors} />
      )}
      {warnings.length > 0 && (
        <IssueGroup title={`${warnings.length} warning${warnings.length === 1 ? "" : "s"}`} tone="amber" issues={warnings} />
      )}
    </div>
  );
}

function IssueGroup({ title, tone, issues }) {
  const styles =
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-amber-200 bg-amber-50 text-amber-800";
  return (
    <div className={`rounded-xl border ${styles}`}>
      <p className="border-b border-current/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wide">
        {title}
      </p>
      <ul className="max-h-44 space-y-1 overflow-y-auto px-3 py-2">
        {issues.map((issue, i) => (
          <li key={i} className="text-xs">
            {issue.rowNumber !== null && issue.rowNumber !== undefined && (
              <span className="mr-1 font-bold">Row {issue.rowNumber}:</span>
            )}
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
