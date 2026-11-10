// Work Package Planner file import dialog (SAP / Maximo / P6 / Excel
// through a file — no live connection to any of them).
//
// Pick a file and its source system → preview/mapping screen (auto-
// matched headers, manual remap per column, rows to create vs update,
// errors flagged before anything is written) → confirm applies it.
// The preview is re-run from the server whenever the mapping changes,
// so the plan on screen is always the plan that would apply.
"use client";

import { useRef, useState } from "react";
import {
  PACKAGE_IMPORT_COLUMNS,
  STEP_IMPORT_COLUMNS,
  IMPORT_SOURCE_SYSTEMS,
} from "@/domains/work-management/workPackageImport";
import { withWorkspaceQuery } from "./workspaceQuery.js";

async function postForm(path, formData) {
  const response = await fetch(withWorkspaceQuery(path), { method: "POST", body: formData });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

async function postJson(path, payload) {
  const response = await fetch(withWorkspaceQuery(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

export default function WorkPackageImportDialog({ kind, packageId, mode = null, onImported, onClose }) {
  const columns = kind === "packages" ? PACKAGE_IMPORT_COLUMNS : STEP_IMPORT_COLUMNS;
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [sourceSystem, setSourceSystem] = useState("");
  const [stage, setStage] = useState("pick");
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const label = kind === "packages" ? "packages" : "steps";

  async function runPreview(fileToUse, mappingOverride) {
    const formData = new FormData();
    formData.append("file", fileToUse);
    formData.append("kind", kind);
    if (packageId) formData.append("packageId", packageId);
    if (sourceSystem) formData.append("sourceSystem", sourceSystem);
    if (mode) formData.append("mode", mode);
    if (mappingOverride) formData.append("mapping", JSON.stringify(mappingOverride));
    const body = await postForm("/api/work-packages/import/preview", formData);
    setPreview(body);
    setMapping(body.columns.map((column) => column.fieldKey));
    setStage("preview");
  }

  async function handlePickSubmit(event) {
    event.preventDefault();
    const chosen = fileRef.current?.files?.[0];
    if (!chosen) {
      setError("Choose a file to import.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      setFile(chosen);
      await runPreview(chosen, null);
    } catch (e) {
      setError(e?.message || "Could not read this file.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemap() {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      await runPreview(file, mapping);
    } catch (e) {
      setError(e?.message || "Could not re-plan this import.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setError(null);
    setBusy(true);
    try {
      const body = await postJson("/api/work-packages/import/confirm", {
        kind,
        packageId: packageId || undefined,
        sourceSystem: sourceSystem || undefined,
        mode: mode || undefined,
        rows: preview.rows,
      });
      setResult(body);
      setStage("done");
      if (onImported) {
        onImported({
          packages: kind === "packages"
            ? [...body.created.map((c) => c.package), ...body.updated.map((u) => u.package)]
            : undefined,
          steps: kind === "steps"
            ? [...body.created.map((c) => c.step), ...body.updated.map((u) => u.step)]
            : undefined,
          message: `Import finished: ${body.summary.created} created, ${body.summary.updated} updated`
            + (body.summary.errors > 0 ? `, ${body.summary.errors} failed` : "")
            + (body.summary.warnings > 0 ? `, ${body.summary.warnings} warnings` : "") + ".",
        });
      }
    } catch (e) {
      setError(e?.message || "Could not apply this import.");
    } finally {
      setBusy(false);
    }
  }

  const plan = preview?.plan;
  const canConfirm = stage === "preview" && plan && plan.summary.errorCount === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-label={`Import ${label}`}>
      <div className="mt-10 w-full max-w-3xl rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Import {label} from a file</h2>
            <p className="mt-1 text-sm text-slate-600">
              From SAP, Maximo, P6, or Excel — through an .xlsx, .csv, .tsv, or .txt export. Nothing is written until you confirm the preview.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close import"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            Close
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        {stage === "pick" && (
          <form onSubmit={handlePickSubmit} className="mt-4 space-y-4">
            <div>
              <label htmlFor="import-file" className="block text-sm font-medium text-slate-700">File</label>
              <input id="import-file" ref={fileRef} type="file" accept=".xlsx,.csv,.tsv,.txt"
                className="mt-1 block w-full text-sm text-slate-700" />
            </div>
            <div>
              <label htmlFor="import-source" className="block text-sm font-medium text-slate-700">
                Source system <span className="font-normal text-slate-500">(optional — used to match re-imports to the same rows)</span>
              </label>
              <select id="import-source" value={sourceSystem} onChange={(e) => setSourceSystem(e.target.value)}
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900">
                <option value="">Unknown / mixed</option>
                {IMPORT_SOURCE_SYSTEMS.map((system) => (
                  <option key={system} value={system}>{system}</option>
                ))}
              </select>
            </div>
            <p className="text-sm text-slate-600">
              Columns the file should have: {columns.map((column) => column.header).join(", ")}.
              {" "}<a href={`/api/work-packages/import/template?kind=${kind}${mode ? `&mode=${mode}` : ""}`} download
                className="font-medium text-blue-700 hover:underline">Download the CSV template</a>.
            </p>
            <button type="submit" disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? "Reading file…" : "Preview import"}
            </button>
          </form>
        )}

        {stage === "preview" && preview && (
          <div className="mt-4 space-y-4">
            {preview.sourceTrackingAvailable === false && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Source record IDs cannot be saved yet — the database change for import tracking has not been applied.
                Matching still works by package # / step # / title, but importing this file again would create duplicates instead of updating the same rows.
              </p>
            )}
            <div>
              <h3 className="text-sm font-medium text-slate-700">Column mapping</h3>
              <p className="text-xs text-slate-500">Headers were matched automatically; change any column, then update the preview.</p>
              <div className="mt-2 space-y-2">
                {preview.columns.map((column, index) => (
                  <div key={`${column.header}-${index}`} className="flex items-center gap-2 text-sm">
                    <span className="w-48 truncate font-medium text-slate-700">{column.header || "(blank header)"}</span>
                    <span className="text-slate-400">→</span>
                    <select value={mapping?.[index] ?? ""} aria-label={`Map column ${column.header}`}
                      onChange={(e) => setMapping((current) => current.map((key, i) => (i === index ? (e.target.value || null) : key)))}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-900">
                      <option value="">Ignore this column</option>
                      {columns.map((target) => (
                        <option key={target.key} value={target.key}>{target.header}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <button type="button" onClick={handleRemap} disabled={busy}
                className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {busy ? "Updating preview…" : "Update preview"}
              </button>
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-700">Plan</h3>
              <p className="mt-1 text-sm text-slate-700">
                {plan.summary.createCount} to create · {plan.summary.updateCount} to update · {plan.summary.errorCount} errors
              </p>
              {plan.errors.length > 0 && (
                <ul className="mt-2 space-y-1 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {plan.errors.map((item, index) => (
                    <li key={index}>{item.message}</li>
                  ))}
                </ul>
              )}
              {plan.creates.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                  {plan.creates.slice(0, 10).map((item) => (
                    <li key={item.rowIndex}>Create: {item.fields.title}</li>
                  ))}
                  {plan.creates.length > 10 && <li>…and {plan.creates.length - 10} more to create.</li>}
                </ul>
              )}
              {plan.updates.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                  {plan.updates.slice(0, 10).map((item) => (
                    <li key={item.rowIndex}>Update: {item.fields.title} ({item.matchKind})</li>
                  ))}
                  {plan.updates.length > 10 && <li>…and {plan.updates.length - 10} more to update.</li>}
                </ul>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={handleConfirm} disabled={!canConfirm || busy}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {busy ? "Importing…" : `Import ${plan.summary.createCount + plan.summary.updateCount} rows`}
              </button>
              <button type="button" onClick={() => { setStage("pick"); setPreview(null); }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Choose a different file
              </button>
            </div>
            {!canConfirm && plan.summary.errorCount > 0 && (
              <p className="text-sm text-red-700">Fix the errors above (or ignore the offending columns) before importing.</p>
            )}
          </div>
        )}

        {stage === "done" && result && (
          <div className="mt-4 space-y-3">
            <p role="status" className="text-sm text-slate-700">
              Import finished: {result.summary.created} created, {result.summary.updated} updated
              {result.summary.errors > 0 ? `, ${result.summary.errors} failed` : ""}
              {result.summary.warnings > 0 ? `, ${result.summary.warnings} warnings` : ""}.
            </p>
            {result.warnings.length > 0 && (
              <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {result.warnings.map((warning, index) => (
                  <li key={index}>{warning.message}</li>
                ))}
              </ul>
            )}
            {result.errors.length > 0 && (
              <ul className="space-y-1 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {result.errors.map((item, index) => (
                  <li key={index}>Row {item.rowIndex + 1}: {item.message}</li>
                ))}
              </ul>
            )}
            <button type="button" onClick={onClose}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
