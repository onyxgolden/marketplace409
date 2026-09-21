"use client";

// FORGE Chart Builder — import wizard entry step (slice 3.2).
//
// File intake only: accepts .csv and .xlsx, parses 100% in the browser, and
// surfaces every failure as an explicit message. Files with more than
// LARGE_FILE_ROWS rows need an explicit confirmation before processing so a
// huge paste never freezes the UI without warning.

import { useState } from "react";
import { ImportError, parseCsv, parseXlsx } from "@/domains/chartBuilder";

const LARGE_FILE_ROWS = 10000;

function totalRows(tables) {
  return tables.reduce((sum, t) => sum + t.rows.length, 0);
}

export default function ImportFileStep({ onParsed, onBack }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null); // { tables, fileName, rows }

  async function handleFile(file) {
    setError(null);
    setPending(null);
    if (!file) return;
    const name = file.name ?? "";
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
    if (ext !== ".csv" && ext !== ".xlsx") {
      setError(
        `Unsupported file type "${ext || "(none)"}". Import accepts .csv and .xlsx files only.`
      );
      return;
    }
    setBusy(true);
    try {
      const tables =
        ext === ".csv" ? await parseCsv(file) : await parseXlsx(file);
      const rows = totalRows(tables);
      if (rows > LARGE_FILE_ROWS) {
        // Large files: show the warning and require an explicit continue
        // before anything else happens.
        setPending({ tables, fileName: name, rows });
      } else {
        onParsed({ tables, sourceKind: ext.slice(1), fileName: name });
      }
    } catch (err) {
      setError(
        err instanceof ImportError
          ? err.message
          : "That file could not be read. Please check it and try again."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 className="text-base font-semibold text-slate-900">Import from a spreadsheet</h2>
      <p className="mt-1 text-sm text-slate-600">
        Everything happens in your browser — no employee or workflow data is
        uploaded anywhere.
      </p>
      <label className="mt-4 block rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center transition hover:border-blue-400">
        <span className="block text-sm font-medium text-slate-700">
          {busy ? "Reading file…" : "Choose a .csv or .xlsx file"}
        </span>
        <span className="mt-1 block text-xs text-slate-500">
          The first non-blank row is treated as the header row.
        </span>
        <input
          type="file"
          accept=".csv,.xlsx"
          className="sr-only"
          disabled={busy}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </label>
      {pending && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            Large file: {pending.rows.toLocaleString()} rows
          </p>
          <p className="mt-1 text-sm text-amber-800">
            Processing is local, but a file this size can take a moment and the
            preview will be long. Continue anyway?
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700"
              onClick={() => {
                onParsed({
                  tables: pending.tables,
                  sourceKind: pending.fileName.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv",
                  fileName: pending.fileName,
                });
                setPending(null);
              }}
            >
              Process anyway
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-white"
              onClick={() => setPending(null)}
            >
              Pick a different file
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-between">
        <button
          type="button"
          className="text-sm font-medium text-slate-500 hover:underline"
          onClick={onBack}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
