"use client";

// FORGE Chart Builder — worksheet picker (slice 3.2).
//
// Shown for multi-sheet workbooks only. The wizard never picks a sheet
// silently: selection starts empty and Continue stays disabled until the user
// chooses explicitly.

import { useState } from "react";

export default function SheetPicker({ tables, onPick, onBack }) {
  const [selected, setSelected] = useState(null);

  return (
    <div>
      <h2 className="text-base font-semibold text-slate-900">Choose a worksheet</h2>
      <p className="mt-1 text-sm text-slate-600">
        This workbook has {tables.length} sheets with data. Pick the one that
        holds the org chart rows.
      </p>
      <div className="mt-4 space-y-2" role="radiogroup" aria-label="Worksheets">
        {tables.map((table, index) => (
          <button
            key={`${table.sheetName}-${index}`}
            type="button"
            role="radio"
            aria-checked={selected === index}
            onClick={() => setSelected(index)}
            className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
              selected === index
                ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                : "border-slate-200 bg-white hover:border-slate-300"
            }`}
          >
            <span>
              <span className="block text-sm font-semibold text-slate-900">
                {table.sheetName}
              </span>
              <span className="block text-xs text-slate-500">
                {table.rows.length.toLocaleString()} rows · {table.headers.length} columns
              </span>
            </span>
            <span
              aria-hidden="true"
              className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                selected === index ? "border-blue-600" : "border-slate-300"
              }`}
            >
              {selected === index && <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-4 flex justify-between">
        <button
          type="button"
          className="text-sm font-medium text-slate-500 hover:underline"
          onClick={onBack}
        >
          ← Back to file
        </button>
        <button
          type="button"
          disabled={selected === null}
          onClick={() => onPick(selected)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
