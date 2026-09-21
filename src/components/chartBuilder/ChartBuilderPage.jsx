"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  canRedoChart,
  canUndoChart,
  chartReducer,
  commitChartAction,
  contentBounds,
  createChartDocument,
  createEdge,
  createNode,
  emptyChartHistory,
  getChartTemplate,
  layoutChart,
  LAYOUT_NODE_ORG,
  LAYOUT_NODE_WORKFLOW,
  LINE_WIDTHS,
  NODE_CARD_STYLES,
  NODE_TEXT_ALIGNS,
  NODE_TEXT_SIZES,
  nodeSupervisor,
  redoChart,
  resolveCanvasDrop,
  resolveDocSettings,
  resolveNodeStyle,
  seedChartFromTemplate,
  undoChart,
  validateOrgDocument,
  validateWorkflowDocument,
  withParts,
} from "@/domains/chartBuilder";
import TemplatePicker from "./TemplatePicker.jsx";
import BackgroundPicker from "./BackgroundPicker.jsx";
import ChartCanvas from "./ChartCanvas.jsx";
import ChartImportWizard from "./import/ChartImportWizard.jsx";
import ChartPersistenceControls from "./ChartPersistenceControls.jsx";
import ChartExportMenu from "./ChartExportMenu.jsx";
import {
  getGridPreference,
  GRID_PREFERENCES,
  setGridPreference,
} from "./gridPreference.js";

function useNotice() {
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  return [notice, setNotice];
}

export default function ChartBuilderPage() {
  const [hist, setHist] = useState(() => emptyChartHistory());
  const [selectedId, setSelectedId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(true);
  const [bgOpen, setBgOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [gridPref, setGridPref] = useState(() => getGridPreference());
  const [notice, setNotice] = useNotice();
  const histRef = useRef(hist);
  useEffect(() => {
    histRef.current = hist;
  }, [hist]);

  const doc = hist.present;
  const template = doc ? getChartTemplate(doc.metadata?.templateId) : null;
  const nodeSize = doc?.type === "workflow" ? LAYOUT_NODE_WORKFLOW : LAYOUT_NODE_ORG;

  const validation = useMemo(() => {
    if (!doc) return { valid: true, errors: [] };
    return doc.type === "org" ? validateOrgDocument(doc) : validateWorkflowDocument(doc);
  }, [doc]);
  const errorCount = validation.errors.filter((e) => e.severity === "error").length;
  const warningCount = validation.errors.filter((e) => e.severity === "warning").length;

  function commitState(newState, label) {
    setHist((h) => commitChartAction(h, label, newState));
  }

  function applyAction(action, label) {
    const current = histRef.current.present;
    if (!current) return;
    const result = chartReducer(current, action);
    if (result.error) {
      setNotice({ text: result.error, kind: "error" });
      return;
    }
    commitState(result.state, label ?? action.type);
  }

  function stampLayoutPositions(state, tpl) {
    const positions = layoutChart(state, tpl);
    const nodes = state.nodes.map((node) =>
      Object.freeze({
        ...node,
        position: Object.freeze(positions[node.id] ?? node.position),
      })
    );
    return withParts(state, { nodes });
  }

  function pickTemplate(tpl) {
    const seed = seedChartFromTemplate(tpl);
    const draft = createChartDocument({
      id: `chart-${Date.now().toString(36)}`,
      type: tpl.type,
      nodes: seed.nodes,
      edges: seed.edges,
      metadata: { templateId: tpl.id },
    });
    commitState(stampLayoutPositions(draft, tpl), "new-chart");
    setSelectedId(null);
    setPickerOpen(false);
    setNotice({ text: `${tpl.name} ready — drag nodes to arrange them.`, kind: "info" });
  }

  function handleDrop({ nodeId, position, dropTargetId }) {
    const current = histRef.current.present;
    if (!current) return;
    const result = resolveCanvasDrop(current, { nodeId, position, dropTargetId });
    if (result.reparentError) {
      setNotice({ text: result.reparentError, kind: "error" });
    }
    if (result.error && !result.reparented) {
      if (result.state !== current) {
        setNotice({ text: result.error, kind: "error" });
      }
      return;
    }
    if (result.reparented) {
      // Preserve the user's arrangement: auto-layout stays an explicit user
      // action (the auto-layout button) and never a side effect of
      // reparenting.
      commitState(result.state, "reparent");
      setNotice({ text: "Moved under the new supervisor.", kind: "info" });
    } else if (result.state !== current) {
      commitState(result.state, "move-node");
    }
    // A rejected reparent leaves the document untouched: notice only, no
    // history entry, no position change.
  }

  function autoLayout() {
    if (!doc) return;
    commitState(stampLayoutPositions(doc, template), "auto-layout");
    setNotice({ text: "Layout refreshed.", kind: "info" });
  }

  function addNode() {
    if (!doc) return;
    const id = `node-${Date.now().toString(36)}-${doc.nodes.length}`;
    const isOrg = doc.type === "org";
    const bounds = contentBounds(
      Object.fromEntries(doc.nodes.map((n) => [n.id, n.position])),
      nodeSize
    );
    const node = createNode({
      id,
      label: isOrg ? "New person" : "New step",
      subtitle: "",
      position: { x: bounds.x + bounds.w + 48, y: bounds.y },
      style: template ? { ...template.defaultNodeStyle } : {},
    });
    let next = withParts(doc, { nodes: [...doc.nodes, node] });
    const supervisorId = isOrg ? selectedId : null;
    if (supervisorId && doc.nodes.some((n) => n.id === supervisorId)) {
      const edge = createEdge({
        id: `e-${Date.now().toString(36)}`,
        from: supervisorId,
        to: id,
        type: "supervisor",
      });
      next = withParts(next, { edges: [...next.edges, edge] });
      next = stampLayoutPositions(next, template);
    }
    commitState(next, "add-node");
    setSelectedId(id);
  }

  function deleteSelected() {
    if (!doc || !selectedId) return;
    applyAction({ type: "DELETE_NODE", id: selectedId }, "delete-node");
    setSelectedId(null);
  }

  function changeGrid(pref) {
    setGridPreference(pref);
    setGridPref(pref);
  }

  function doUndo() {
    const { history } = undoChart(histRef.current);
    setHist(history);
    setSelectedId(null);
  }

  function doRedo() {
    const { history } = redoChart(histRef.current);
    setHist(history);
    setSelectedId(null);
  }

  function handleImportComplete(doc) {
    // The wizard returns a layout-stamped document; hand it to the existing
    // canvas state exactly like a new template chart. Undo returns to the
    // previous chart — the import is one history entry.
    commitState(doc, "import");
    setSelectedId(null);
    setImportOpen(false);
    setPickerOpen(false);
    setNotice({
      text: `Imported ${doc.nodes.length} ${doc.type === "org" ? "people" : "steps"} from the spreadsheet.`,
      kind: "info",
    });
  }

  function handleLoadChart(loadedDoc) {
    // Loading starts a fresh undo stack: the saved chart becomes the only
    // history entry, so undo can never reach into a previous chart.
    setHist(commitChartAction(emptyChartHistory(), "load-chart", loadedDoc));
    setSelectedId(null);
    setPickerOpen(false);
  }

  function importWizardModal() {
    if (!importOpen) return null;
    return (
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 sm:p-8"
        role="dialog"
        aria-modal="true"
        aria-label="Import chart from spreadsheet"
      >
        <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-lg font-bold text-slate-900">Import chart</h1>
            <button
              type="button"
              onClick={() => setImportOpen(false)}
              className="rounded-lg px-2 py-1 text-sm font-medium text-slate-500 hover:bg-slate-100"
              aria-label="Close import wizard"
            >
              ✕
            </button>
          </div>
          <ChartImportWizard
            mode="org"
            onComplete={handleImportComplete}
            onCancel={() => setImportOpen(false)}
          />
        </div>
      </div>
    );
  }

  if (!doc || pickerOpen) {
    return (
      <div className="min-h-screen bg-slate-100">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <span className="text-lg font-bold text-slate-900">Chart Builder</span>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Import from spreadsheet
          </button>
        </div>
        {doc && (
          <div className="border-b border-slate-200 bg-white px-6 py-2">
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className="text-sm font-medium text-blue-700 hover:underline"
            >
              ← Back to current chart
            </button>
          </div>
        )}
        <TemplatePicker onPick={pickTemplate} />
        <div className="border-t border-slate-200 bg-white px-6 py-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Saved charts</h2>
          <ChartPersistenceControls
            doc={doc}
            onLoad={handleLoadChart}
            onNotice={setNotice}
          />
        </div>
        {importWizardModal()}
      </div>
    );
  }

  const selected = doc.nodes.find((n) => n.id === selectedId) ?? null;
  const supervisor = selected && doc.type === "org" ? nodeSupervisor(doc, selected.id) : null;

  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-900 px-4 py-2.5">
        <span className="mr-2 text-base font-bold text-white">Chart Builder</span>
        {template && (
          <span className="rounded-full bg-slate-700 px-2.5 py-1 text-xs font-medium text-slate-200">
            {template.name}
          </span>
        )}
        <div className="mx-1 h-6 w-px bg-slate-700" />
        <ToolbarButton onClick={() => setPickerOpen(true)}>New</ToolbarButton>
        <ToolbarButton onClick={() => setImportOpen(true)}>Import</ToolbarButton>
        <ToolbarButton onClick={doUndo} disabled={!canUndoChart(hist)}>Undo</ToolbarButton>
        <ToolbarButton onClick={doRedo} disabled={!canRedoChart(hist)}>Redo</ToolbarButton>
        <div className="mx-1 h-6 w-px bg-slate-700" />
        <div className="relative">
          <ToolbarButton onClick={() => setBgOpen((v) => !v)} active={bgOpen}>
            Background
          </ToolbarButton>
          {bgOpen && (
            <BackgroundPicker
              currentId={doc.background}
              onSelect={(id) => {
                applyAction({ type: "SET_BACKGROUND", background: id }, "set-background");
                setBgOpen(false);
              }}
              onClose={() => setBgOpen(false)}
            />
          )}
        </div>
        <div
          className="flex overflow-hidden rounded-lg border border-slate-600"
          role="group"
          aria-label="Drawing grid"
        >
          {GRID_PREFERENCES.map((pref) => (
            <button
              key={pref}
              type="button"
              onClick={() => changeGrid(pref)}
              aria-pressed={gridPref === pref}
              className={`px-2.5 py-1.5 text-xs font-medium capitalize transition ${
                gridPref === pref
                  ? "bg-blue-600 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {pref === "off" ? "No grid" : `${pref} grid`}
            </button>
          ))}
        </div>
        <ToolbarButton onClick={autoLayout}>Auto-layout</ToolbarButton>
        <ToolbarButton onClick={addNode}>
          {doc.type === "org" ? "Add person" : "Add step"}
        </ToolbarButton>
        <ChartPersistenceControls
          doc={doc}
          onLoad={handleLoadChart}
          onNotice={setNotice}
        />
        <ChartExportMenu doc={doc} onNotice={setNotice} />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] font-medium text-slate-500">Connector</span>
          <Segmented
            ariaLabel="Connector thickness"
            value={resolveDocSettings(doc.settings).connectorWidth}
            onPick={(w) =>
              commitState(
                withParts(doc, {
                  settings: { ...doc.settings, connectorWidth: w },
                }),
                "connector-width"
              )
            }
            options={LINE_WIDTHS.map((v) => ({ value: v, label: String(v) }))}
          />
          {errorCount > 0 && (
            <span className="rounded-full bg-red-600 px-2.5 py-1 text-xs font-semibold text-white">
              {errorCount} error{errorCount === 1 ? "" : "s"}
            </span>
          )}
          {warningCount > 0 && (
            <span className="rounded-full bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white">
              {warningCount} warning{warningCount === 1 ? "" : "s"}
            </span>
          )}
          {errorCount === 0 && warningCount === 0 && (
            <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white">
              Valid
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 gap-4 p-4">
        <div className="min-w-0 flex-1">
          <ChartCanvas
            doc={doc}
            template={template}
            nodeSize={nodeSize}
            selectedId={selectedId}
            gridPreference={gridPref}
            onSelect={setSelectedId}
            onDrop={handleDrop}
          />
          <p className="mt-2 text-xs text-slate-500">
            Drag a node to move it. In org charts, drop a person onto another
            person to change their supervisor — drops that would create a cycle
            are rejected. Double-check: click a node to edit it in the panel.
          </p>
        </div>

        {/* Inspector */}
        <aside className="w-72 shrink-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {selected ? (
            <NodeInspector
              key={selected.id}
              doc={doc}
              node={selected}
              supervisorId={supervisor?.id ?? ""}
              onPatch={(patch) =>
                applyAction({ type: "UPDATE_NODE", id: selected.id, patch }, "update-node")
              }
              onReparent={(newSupervisorId) => {
                if (!newSupervisorId) {
                  // Make it a root: drop incoming supervisor edges.
                  const edges = doc.edges.filter(
                    (e) => !(e.to === selected.id && (e.type === "supervisor" || e.type === "")
                    )
                  );
                  commitState(withParts(doc, { edges }), "unparent");
                } else {
                  applyAction(
                    { type: "REPARENT_NODE", nodeId: selected.id, newSupervisorId },
                    "reparent"
                  );
                }
              }}
              onDelete={deleteSelected}
            />
          ) : (
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Inspector</h2>
              <p className="mt-1 text-xs text-slate-500">
                Click a node on the canvas to edit its name, title, department,
                or supervisor.
              </p>
              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Chart issues
              </h3>
              {validation.errors.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">No issues found.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {validation.errors.map((err, i) => (
                    <li
                      key={i}
                      className={`rounded px-2 py-1 text-xs ${
                        err.severity === "error"
                          ? "bg-red-50 text-red-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {err.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Notice toast */}
      {notice && (
        <div
          className={`fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${
            notice.kind === "error" ? "bg-red-700 text-white" : "bg-slate-900 text-white"
          }`}
          role="status"
        >
          {notice.text}
        </div>
      )}

      {/* Import wizard modal */}
      {importWizardModal()}
    </div>
  );
}

function ToolbarButton({ children, onClick, disabled, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-blue-600 text-white"
          : "bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
      }`}
    >
      {children}
    </button>
  );
}

const fieldClass =
  "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200";

const STYLE_SWATCHES = [
  "#1f6feb",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#475569",
];

function Segmented({ options, value, onPick, ariaLabel }) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="mt-1 flex overflow-hidden rounded-lg border border-slate-300"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={opt.value === value}
          onClick={() => onPick(opt.value)}
          className={`flex-1 px-2 py-1.5 text-xs font-medium ${
            opt.value === value
              ? "bg-blue-600 text-white"
              : "bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function NodeInspector({ doc, node, supervisorId, onPatch, onReparent, onDelete }) {
  const isOrg = doc.type === "org";
  const style = resolveNodeStyle(node.style);
  const patchStyle = (key, value) =>
    onPatch({ style: { ...node.style, [key]: value } });
  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-900">Edit node</h2>
      <label className="mt-3 block text-xs font-medium text-slate-600">
        Name
        <input
          className={fieldClass}
          defaultValue={node.label}
          onBlur={(e) => {
            if (e.target.value !== node.label) onPatch({ label: e.target.value });
          }}
        />
      </label>
      <label className="mt-2 block text-xs font-medium text-slate-600">
        Subtitle
        <input
          className={fieldClass}
          defaultValue={node.subtitle}
          placeholder={isOrg ? "Title" : "Details"}
          onBlur={(e) => {
            if (e.target.value !== node.subtitle) onPatch({ subtitle: e.target.value });
          }}
        />
      </label>
      {isOrg && (
        <>
          <label className="mt-2 block text-xs font-medium text-slate-600">
            Title
            <input
              className={fieldClass}
              defaultValue={node.fields?.title ?? ""}
              onBlur={(e) => {
                if (e.target.value !== (node.fields?.title ?? ""))
                  onPatch({ fields: { title: e.target.value } });
              }}
            />
          </label>
          <label className="mt-2 block text-xs font-medium text-slate-600">
            Department
            <input
              className={fieldClass}
              defaultValue={node.fields?.department ?? ""}
              onBlur={(e) => {
                if (e.target.value !== (node.fields?.department ?? ""))
                  onPatch({ fields: { department: e.target.value } });
              }}
            />
          </label>
          <label className="mt-2 block text-xs font-medium text-slate-600">
            Supervisor
            <select
              className={fieldClass}
              value={supervisorId}
              onChange={(e) => onReparent(e.target.value)}
            >
              <option value="">— No supervisor (root) —</option>
              {doc.nodes
                .filter((n) => n.id !== node.id)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
            </select>
          </label>
        </>
      )}
      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Style
      </h3>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Accent color">
        {STYLE_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            aria-label={`Accent color ${c}`}
            aria-pressed={style.color.toLowerCase() === c.toLowerCase()}
            onClick={() => patchStyle("color", c)}
            className={`h-7 w-7 rounded-full ${
              style.color.toLowerCase() === c.toLowerCase()
                ? "ring-2 ring-slate-900 ring-offset-2"
                : "ring-1 ring-slate-300 hover:ring-2 hover:ring-slate-400"
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="mt-2 text-xs font-medium text-slate-600">Card</div>
      <Segmented
        ariaLabel="Card style"
        value={style.card}
        onPick={(v) => patchStyle("card", v)}
        options={NODE_CARD_STYLES.map((v) => ({
          value: v,
          label: v === "tint" ? "Tint" : v === "white" ? "White" : "Outline",
        }))}
      />
      <div className="mt-2 text-xs font-medium text-slate-600">Border</div>
      <Segmented
        ariaLabel="Border thickness"
        value={style.borderWidth}
        onPick={(v) => patchStyle("borderWidth", v)}
        options={LINE_WIDTHS.map((v) => ({ value: v, label: String(v) }))}
      />
      <div className="mt-2 text-xs font-medium text-slate-600">Text size</div>
      <Segmented
        ariaLabel="Text size"
        value={style.textSize}
        onPick={(v) => patchStyle("textSize", v)}
        options={NODE_TEXT_SIZES.map((v) => ({
          value: v,
          label: v === "sm" ? "S" : v === "md" ? "M" : "L",
        }))}
      />
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          aria-pressed={style.bold}
          onClick={() => patchStyle("bold", !style.bold)}
          className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-bold ${
            style.bold
              ? "border-blue-600 bg-blue-600 text-white"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          B
        </button>
        <div className="flex-[2]">
          <Segmented
            ariaLabel="Text alignment"
            value={style.align}
            onPick={(v) => patchStyle("align", v)}
            options={NODE_TEXT_ALIGNS.map((v) => ({
              value: v,
              label: v === "left" ? "Left" : "Center",
            }))}
          />
        </div>
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="mt-4 w-full rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
      >
        Delete node
      </button>
    </div>
  );
}
