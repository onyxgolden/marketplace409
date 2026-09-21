"use client";

// FORGE Chart Builder — import wizard orchestrator (slice 3.2).
//
// Step flow: file → [sheet picker, multi-sheet workbooks only] → mapping
// confirmation → validation preview → commit. The pipeline is regenerated
// from scratch every time mappings are confirmed, so going back and changing
// a mapping always rebuilds the preview — nothing is cached.
//
// Slice 3.2 covers org imports. The workflow option is shown disabled so the
// wizard has the shape slice 3.3 will fill in.

import { useState } from "react";
import { commitOrgImport, ImportError, runOrgImportPipeline } from "@/domains/chartBuilder";
import ImportFileStep from "./ImportFileStep.jsx";
import SheetPicker from "./SheetPicker.jsx";
import ColumnMappingStep from "./ColumnMappingStep.jsx";
import ImportPreviewStep from "./ImportPreviewStep.jsx";

const STEPS = ["file", "sheet", "mapping", "preview", "done"];

export default function ChartImportWizard({ mode = "org", onComplete, onCancel }) {
  const [step, setStep] = useState("file");
  const [tables, setTables] = useState(null);
  const [tableIndex, setTableIndex] = useState(0);
  const [pipeline, setPipeline] = useState(null);
  const [commitError, setCommitError] = useState(null);

  const activeTable = tables ? tables[tableIndex] : null;

  function handleParsed({ tables: parsed }) {
    setTables(parsed);
    setPipeline(null);
    setCommitError(null);
    setTableIndex(0);
    setStep(parsed.length > 1 ? "sheet" : "mapping");
  }

  function handleConfirmMapping(confirmed) {
    try {
      // Org only in slice 3.2; the workflow pipeline arrives in slice 3.3.
      const result = runOrgImportPipeline(activeTable, confirmed);
      setPipeline(result);
      setCommitError(null);
      setStep("preview");
    } catch (err) {
      setCommitError(
        err instanceof ImportError
          ? err.message
          : "The preview could not be generated. Check the mapping and try again."
      );
    }
  }

  function handleCommit() {
    try {
      const doc = commitOrgImport(pipeline);
      setStep("done");
      onComplete(doc);
    } catch (err) {
      setCommitError(
        err instanceof ImportError
          ? err.message
          : "The import could not be committed. Please try again."
      );
    }
  }

  const stepIndex = STEPS.indexOf(step);

  return (
    <div>
      {/* Stepper */}
      <ol className="mb-5 flex items-center gap-1 text-xs font-medium" aria-label="Import progress">
        {["File", "Sheet", "Mapping", "Preview"].map((label, i) => {
          const active = i === Math.min(stepIndex, 3);
          const done = i < Math.min(stepIndex, 3);
          return (
            <li key={label} className="flex items-center gap-1">
              <span
                className={`rounded-full px-2.5 py-1 ${
                  active
                    ? "bg-blue-600 text-white"
                    : done
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-slate-100 text-slate-500"
                }`}
              >
                {label}
              </span>
              {i < 3 && <span className="text-slate-300">→</span>}
            </li>
          );
        })}
      </ol>

      {commitError && step !== "file" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {commitError}
        </p>
      )}

      {step === "file" && (
        <div>
          <div className="mb-4 flex gap-2" role="radiogroup" aria-label="Chart type">
            <ModeButton selected={mode === "org"} label="Org chart" />
            <button
              type="button"
              disabled
              title="Workflow import arrives in slice 3.3"
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-400"
            >
              Workflow chart (soon)
            </button>
          </div>
          <ImportFileStep onParsed={handleParsed} onBack={onCancel} />
        </div>
      )}

      {step === "sheet" && tables && (
        <SheetPicker
          tables={tables}
          onPick={(index) => {
            setTableIndex(index);
            setPipeline(null);
            setStep("mapping");
          }}
          onBack={() => setStep("file")}
        />
      )}

      {step === "mapping" && activeTable && (
        <ColumnMappingStep
          key={tableIndex}
          rawTable={activeTable}
          mode={mode}
          onConfirm={handleConfirmMapping}
          onBack={() => setStep(tables.length > 1 ? "sheet" : "file")}
        />
      )}

      {step === "preview" && pipeline && (
        <ImportPreviewStep
          preview={pipeline.preview}
          onCommit={handleCommit}
          onBack={() => setStep("mapping")}
        />
      )}

      {step === "done" && pipeline && (
        <div className="text-center">
          <p className="text-base font-semibold text-slate-900">Import complete</p>
          <p className="mt-1 text-sm text-slate-600">
            {pipeline.preview.nodeCount.toLocaleString()} people and{" "}
            {pipeline.preview.edgeCount.toLocaleString()} reporting lines added to
            the chart.
          </p>
        </div>
      )}
    </div>
  );
}

function ModeButton({ selected, label }) {
  return (
    <span
      role="radio"
      aria-checked={selected}
      className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
        selected
          ? "border-blue-500 bg-blue-50 text-blue-800"
          : "border-slate-200 text-slate-600"
      }`}
    >
      {label}
    </span>
  );
}
