"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  BookOpen,
  Box,
  DoorOpen,
  Eraser,
  Hand,
  Home,
  Lock,
  LockOpen,
  MousePointer2,
  Network,
  RotateCw,
  Ruler,
  Save,
  Shapes,
  Sofa,
  Spline,
  Square,
  SquareDashed,
  Trash2,
  Upload,
} from "lucide-react";
import PlanCanvas from "./PlanCanvas";
import HousePlansPanel from "./HousePlansPanel";
import { isHousePlansEnabled } from "@/lib/housePlans/housePlansFlags";
import { createSaveScheduler } from "./saveScheduler";
import OrgChartPanel from "./OrgChartPanel";
import FurnitureCatalogPanel from "./FurnitureCatalogPanel";
import { createInitialState, designerReducer } from "./designerReducer";
import { getCatalogEntry } from "@/domains/roomDesigner/furnitureCatalog";
import { getSymbolSet, findSymbol } from "@/domains/roomDesigner/symbolRegistry";
import { ROOM_TEMPLATES, pieceSize } from "@/domains/roomDesigner/designerDocument";
import { feetInchesLabel, parseDimensionInput, wallLength } from "@/domains/roomDesigner/designerGeometry";
import {
  PIPE_DIAMETERS_IN,
  PIPE_LAYERS,
  PIPE_MATERIALS,
  PIPE_SERVICES,
  pipeRunLengthIn,
} from "@/domains/roomDesigner/pipingGeometry";
import { summarizeDesignForEstimating } from "@/domains/roomDesigner/designerExports";
import { orderToolbarTools } from "@/domains/roomDesigner/designerToolbar";

const DesignerViewport3D = dynamic(() => import("./DesignerViewport3D"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#0b1220] text-gray-400">
      Loading 3D view…
    </div>
  ),
});

const TOOL_DEFS = [
  { id: "select", label: "Select", icon: MousePointer2, hint: "Click to select · drag endpoints & furniture · double-click furniture to rotate" },
  { id: "wall", label: "Wall", icon: Square, hint: "Drag on the plan to draw a wall (snaps to the grid)" },
  { id: "wallrect", label: "Wall rect", icon: SquareDashed, hint: "Drag on the plan to draw a rectangular wall outline (snaps to the grid)" },
  { id: "room", label: "Room", icon: Home, hint: "Click to drop a pre-shaped room" },
  { id: "door", label: "Door", icon: DoorOpen, hint: "Click a wall to cut a door opening" },
  { id: "window", label: "Window", icon: Box, hint: "Click a wall to cut a window opening" },
  { id: "furniture", label: "Furniture", icon: Sofa, hint: "Pick a piece, then click the plan to place it" },
  { id: "pipe", label: "Pipe", icon: Spline, hint: "Click to add pipe vertices · double-click or Enter to finish · Esc cancels" },
  { id: "piping", label: "Piping", icon: Shapes, hint: "Pick a valve, fitting, or equipment symbol, then click the plan to place it" },
  { id: "orgchart", label: "Org chart", icon: Network, hint: "Click the plan to place an org chart, then add people and reporting lines" },
  { id: "erase", label: "Erase", icon: Eraser, hint: "Click anything to delete it" },
  { id: "pan", label: "Pan", icon: Hand, hint: "Drag to pan · scroll to zoom (or hold Space anytime)" },
  { id: "calibrate", label: "Calibrate", icon: Ruler, hint: "Set the background image scale: click two points on it, then enter the real distance", needsUnderlay: true },
];

// Select, Erase and Pan are pinned as the first three palette entries, in
// that order, regardless of where they (or future tools) sit in TOOL_DEFS.
const ORDERED_TOOL_DEFS = orderToolbarTools(TOOL_DEFS);

export default function DesignerScreen({ projectId, initialName }) {
  const [state, dispatch] = useReducer(designerReducer, undefined, () => createInitialState());
  const [name, setName] = useState(initialName || "Untitled design");
  const [status, setStatus] = useState({ kind: "loading", message: "Loading design…" });
  const [saving, setSaving] = useState(false);
  // HOUSE PLANS (HP-L0): docked reference panel, gated behind the feature flag.
  const [housePlansOpen, setHousePlansOpen] = useState(false);
  const housePlansEnabled = isHousePlansEnabled();

  // Latest snapshots for saves: a queued save must capture the document and
  // name at the moment it actually sends, not when save() was invoked.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const nameRef = useRef(name);
  useEffect(() => { nameRef.current = name; }, [name]);
  const saveSchedulerRef = useRef(null);
  if (saveSchedulerRef.current === null) saveSchedulerRef.current = createSaveScheduler();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/forge/designer/${projectId}`);
        if (!res.ok) throw new Error(`Load failed (${res.status})`);
        const body = await res.json();
        if (cancelled) return;
        dispatch({ type: "LOAD_DESIGN", design: body.project.design });
        setName(body.project.name);
        setStatus({ kind: "ready" });
      } catch (error) {
        if (!cancelled) setStatus({ kind: "error", message: error.message });
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const save = useCallback(() => {
    // Serialize saves: only one PUT may be in flight at a time, so a slow
    // earlier save can never persist a stale revision over a newer one. A
    // save requested while another is in flight waits its turn and snapshots
    // the latest document and revision when it starts; the revision-guarded
    // MARK_SAVED below still clears dirty only for the revision that was
    // actually persisted.
    return saveSchedulerRef.current(async () => {
      const { design: designToSave, designRevision: savedRevision } = stateRef.current;
      setSaving(true);
      try {
        const res = await fetch(`/api/forge/designer/${projectId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: nameRef.current, design: designToSave }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Save failed (${res.status})`);
        dispatch({ type: "MARK_SAVED", savedRevision });
        setStatus({ kind: "saved", message: "Saved." });
        setTimeout(() => setStatus((s) => (s.kind === "saved" ? { kind: "ready" } : s)), 2500);
      } catch (error) {
        setStatus({ kind: "error", message: error.message });
      } finally {
        setSaving(false);
      }
    });
  }, [projectId]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const { design, tool, selection, multiSelection, pendingCatalogId, pendingRoomTemplate, pendingPipe, pendingSymbol, orthoSnap, layerVisibility, view, dirty } = state;
  const summary = summarizeDesignForEstimating(design);
  const activeTool = TOOL_DEFS.find((t) => t.id === tool);

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-gray-100">
      {/* top bar */}
      <header className="flex items-center gap-3 border-b border-gray-800 bg-gray-900 px-4 py-2">
        <Link href="/forge/designer" className="text-sm text-gray-400 hover:text-white">← Designs</Link>
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); dispatch({ type: "RENAME", name: e.target.value }); }}
          className="w-64 rounded bg-gray-800 px-2 py-1 text-sm font-semibold text-white outline-none focus:ring-2 focus:ring-emerald-500"
          aria-label="Design name"
        />
        {dirty && <span className="text-xs text-amber-400">● unsaved</span>}
        <div className="ml-auto flex items-center gap-2">
          {housePlansEnabled && (
            <button
              onClick={() => setHousePlansOpen((open) => !open)}
              aria-pressed={housePlansOpen}
              title="Open the HOUSE PLANS reference library"
              className={`flex items-center gap-1 rounded px-3 py-1 text-sm font-semibold ${
                housePlansOpen
                  ? "bg-emerald-600 text-white"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              <BookOpen size={15} /> House Plans
            </button>
          )}
          <div className="flex overflow-hidden rounded border border-gray-700">
            {(["2d", "3d"]).map((v) => (
              <button
                key={v}
                onClick={() => dispatch({ type: "SET_VIEW", view: v })}
                className={`px-3 py-1 text-sm ${view === v ? "bg-emerald-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
              >
                {v === "2d" ? "2D Plan" : "3D View"}
              </button>
            ))}
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-1 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <Save size={15} /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>
      {status.kind === "error" && (
        <div className="bg-red-900/60 px-4 py-2 text-sm text-red-200">{status.message}</div>
      )}
      {status.kind === "saved" && (
        <div className="bg-emerald-900/60 px-4 py-1 text-sm text-emerald-200">{status.message}</div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* tool palette */}
        <nav className="flex w-24 flex-col gap-1 border-r border-gray-800 bg-gray-900 p-2" aria-label="Tools">
          {ORDERED_TOOL_DEFS.map((t) => {
            const Icon = t.icon;
            const active = tool === t.id;
            const disabled = t.needsUnderlay && !design.underlay;
            return (
              <button
                key={t.id}
                onClick={() => dispatch({ type: "SET_TOOL", tool: t.id })}
                title={disabled ? "Import a background image first" : t.hint}
                disabled={disabled}
                className={`flex flex-col items-center gap-1 rounded px-1 py-2 text-xs ${
                  active ? "bg-emerald-600 text-white" : "text-gray-300 hover:bg-gray-800"
                } ${disabled ? "cursor-not-allowed opacity-40 hover:bg-transparent" : ""}`}
              >
                <Icon size={20} />
                {t.label}
              </button>
            );
          })}
        </nav>

        {/* canvas */}
        <main className="relative min-w-0 flex-1">
          {status.kind === "loading" ? (
            <div className="flex h-full items-center justify-center text-gray-400">Loading design…</div>
          ) : view === "2d" ? (
            <PlanCanvas
              design={design}
              tool={tool}
              selection={selection}
              multiSelection={multiSelection}
              calibration={state.calibration}
              pendingCatalogId={pendingCatalogId}
              pendingRoomTemplate={pendingRoomTemplate}
              pendingPipe={pendingPipe}
              pendingSymbol={pendingSymbol}
              orthoSnap={orthoSnap}
              layerVisibility={layerVisibility}
              dispatch={dispatch}
            />
          ) : (
            <DesignerViewport3D design={design} />
          )}
          {activeTool && (
            <div className="absolute left-3 top-3 max-w-md rounded bg-gray-900/85 px-3 py-1.5 text-xs text-gray-300">
              <span className="font-semibold text-white">{activeTool.label}:</span> {activeTool.hint}
            </div>
          )}
        </main>

        {/* right panel */}
        <aside className="w-72 overflow-y-auto border-l border-gray-800 bg-gray-900 p-3">
          <RightPanel state={state} dispatch={dispatch} summary={summary} />
        </aside>

        {/* HOUSE PLANS (HP-L0): docked reference panel. The canvas stays
            primary; this rail only exists behind the feature flag. */}
        {housePlansEnabled && housePlansOpen && (
          <aside
            className="w-80 shrink-0 overflow-hidden border-l border-gray-800 bg-gray-900"
            aria-label="House Plans reference library"
          >
            <HousePlansPanel onClose={() => setHousePlansOpen(false)} />
          </aside>
        )}
      </div>
    </div>
  );
}

function RightPanel({ state, dispatch, summary }) {
  const { design, tool, selection, multiSelection, pendingCatalogId, pendingRoomTemplate } = state;

  // Scale calibration for the background underlay (Visio trace-over workflow).
  if (tool === "calibrate") {
    return <CalibrationPanel state={state} dispatch={dispatch} />;
  }

  // Phase 2: piping mode — run defaults, symbol palette, ortho + layers.
  if (tool === "pipe" || tool === "piping") {
    return <PipingPanel state={state} dispatch={dispatch} />;
  }

  // Phase 3: people org charts — tool panel while placing, person editor
  // once a chart is selected.
  if (tool === "orgchart" || selection?.kind === "orgchart") {
    return <OrgChartPanel state={state} dispatch={dispatch} />;
  }

  // Visio-style arrange: shift-click 2+ furniture pieces on the plan.
  if (multiSelection.length >= 2) {
    return <ArrangePanel state={state} dispatch={dispatch} />;
  }

  if (tool === "furniture") {
    return <FurnitureCatalogPanel pendingCatalogId={pendingCatalogId} dispatch={dispatch} />;
  }

  if (tool === "room") {
    return (
      <div>
        <h2 className="mb-2 text-sm font-semibold text-white">Room shapes</h2>
        <p className="mb-3 text-xs text-gray-400">Pick a shape, then click the plan to drop it.</p>
        <div className="grid grid-cols-1 gap-1">
          {ROOM_TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => dispatch({ type: "SET_PENDING_ROOM", templateId: t.id })}
              className={`rounded border p-2 text-left text-xs ${
                pendingRoomTemplate === t.id
                  ? "border-emerald-500 bg-emerald-900/40 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500"
              }`}
            >
              <span className="font-semibold">{t.label}</span>
              <span className="block text-[10px] text-gray-500">
                {feetInchesLabel(t.widthIn)} × {feetInchesLabel(t.depthIn)}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (selection) {
    return <SelectionPanel state={state} dispatch={dispatch} />;
  }

  // default: design summary + settings
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-white">Design summary</h2>
      <dl className="mb-4 space-y-1 text-xs text-gray-300">
        <div className="flex justify-between"><dt>Rooms</dt><dd>{summary.roomCount} ({summary.totalRoomAreaSqFt} sq ft)</dd></div>
        <div className="flex justify-between"><dt>Walls</dt><dd>{summary.wallCount} ({feetInchesLabel(summary.totalWallLengthIn)} total)</dd></div>
        <div className="flex justify-between"><dt>Doors / windows</dt><dd>{summary.doorCount} / {summary.windowCount}</dd></div>
        <div className="flex justify-between"><dt>Furniture</dt><dd>{summary.furnitureCount}</dd></div>
        <div className="flex justify-between"><dt>Pipe runs</dt><dd>{summary.pipeRunCount}</dd></div>
        {Object.entries(summary.pipeLengthByDiameterIn).map(([diameter, lengthIn]) => (
          <div key={diameter} className="flex justify-between pl-3 text-gray-400">
            <dt>⌀{diameter}″ pipe</dt>
            <dd>{feetInchesLabel(lengthIn)}</dd>
          </div>
        ))}
        <div className="flex justify-between"><dt>Piping symbols</dt><dd>{summary.pipingSymbolCount}</dd></div>
      </dl>
      <LayerToggles state={state} dispatch={dispatch} />
      <h2 className="mb-2 text-sm font-semibold text-white">Settings</h2>
      <label className="mb-2 block text-xs text-gray-400">
        Wall height
        <select
          value={design.settings.wallHeightIn}
          onChange={(e) => dispatch({ type: "UPDATE_SETTINGS", settings: { wallHeightIn: Number(e.target.value) } })}
          className="mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-white"
        >
          {[96, 108, 120].map((h) => (
            <option key={h} value={h}>{h / 12} ft ({h}″)</option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-gray-400">
        Wall thickness
        <select
          value={design.settings.wallThicknessIn}
          onChange={(e) => dispatch({ type: "UPDATE_SETTINGS", settings: { wallThicknessIn: Number(e.target.value) } })}
          className="mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-white"
        >
          {[3.5, 4.5, 5.5, 7.5].map((t) => (
            <option key={t} value={t}>{t}″</option>
          ))}
        </select>
      </label>
      <p className="mt-4 text-[11px] leading-relaxed text-gray-500">
        Rooms, areas, and wall lengths are available as plain data for future
        scheduling and cost tools — nothing is locked inside the editor.
      </p>
      <UnderlaySection design={design} dispatch={dispatch} />
    </div>
  );
}

// Phase 2: piping mode panel — defaults for new pipe runs, the piping
// symbol palette, orthogonal snapping, and discipline layer visibility.
function PipingPanel({ state, dispatch }) {
  const { pendingPipe, pendingSymbol, orthoSnap, tool } = state;
  const set = getSymbolSet("piping");
  const symbols = set ? set.symbols : [];
  const selectClass = "mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-white";

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-white">Piping</h2>
      <div className="mb-3 flex gap-1">
        <button
          onClick={() => dispatch({ type: "SET_TOOL", tool: "pipe" })}
          className={`flex-1 rounded px-2 py-1.5 text-xs font-semibold ${
            tool === "pipe" ? "bg-sky-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"
          }`}
        >
          Draw pipe
        </button>
        <button
          onClick={() => dispatch({ type: "SET_TOOL", tool: "piping" })}
          className={`flex-1 rounded px-2 py-1.5 text-xs font-semibold ${
            tool === "piping" ? "bg-sky-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"
          }`}
        >
          Symbols
        </button>
      </div>

      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">New pipe runs</h3>
      <div className="mb-3 space-y-2">
        <label className="block text-xs text-gray-400">
          Diameter
          <select
            value={pendingPipe.diameterIn}
            onChange={(e) => dispatch({ type: "SET_PENDING_PIPE", pipe: { diameterIn: Number(e.target.value) } })}
            className={selectClass}
          >
            {PIPE_DIAMETERS_IN.map((d) => (
              <option key={d} value={d}>⌀{d}″</option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-gray-400">
          Material
          <select
            value={pendingPipe.material}
            onChange={(e) => dispatch({ type: "SET_PENDING_PIPE", pipe: { material: e.target.value } })}
            className={selectClass}
          >
            {PIPE_MATERIALS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-gray-400">
          Service
          <input
            type="text"
            value={pendingPipe.service}
            onChange={(e) => dispatch({ type: "SET_PENDING_PIPE", pipe: { service: e.target.value } })}
            placeholder="e.g. Process"
            className={`${selectClass} placeholder:text-gray-600`}
          />
        </label>
        <label className="block text-xs text-gray-400">
          Layer for new objects
          <select
            value={pendingPipe.layer}
            onChange={(e) => dispatch({ type: "SET_PENDING_PIPE", pipe: { layer: e.target.value } })}
            className={selectClass}
          >
            <option value="auto">Auto (symbol default)</option>
            {PIPE_LAYERS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
        <button
          onClick={() => dispatch({ type: "TOGGLE_ORTHO_SNAP" })}
          title="Lock each new pipe vertex to horizontal/vertical from the previous one"
          className={`w-full rounded px-2 py-1.5 text-xs font-semibold ${
            orthoSnap ? "bg-sky-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"
          }`}
        >
          Ortho 90° snap {orthoSnap ? "on" : "off"}
        </button>
      </div>

      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Symbols</h3>
      <p className="mb-2 text-[11px] text-gray-500">Pick a symbol, then click the plan to place it.</p>
      <div className="mb-3 grid grid-cols-2 gap-1">
        {symbols.map((s) => (
          <button
            key={s.id}
            onClick={() => dispatch({ type: "SET_PENDING_SYMBOL", domain: "piping", symbolId: s.id })}
            className={`rounded border p-1.5 text-left text-xs ${
              pendingSymbol?.symbolId === s.id
                ? "border-sky-500 bg-sky-900/40 text-white"
                : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500"
            }`}
          >
            {s.label}
            <span className="block text-[10px] text-gray-500">
              {s.widthIn}″ × {s.depthIn}″ · {s.defaultLayer}
            </span>
          </button>
        ))}
      </div>

      <LayerToggles state={state} dispatch={dispatch} />

      <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
        Pipe tool: click to add vertices, double-click or press Enter to finish,
        Esc cancels. Select a run to drag its vertices or edit its diameter,
        material, and service.
      </p>
    </div>
  );
}

// Discipline layers, Visio-style seed: toggle visibility of the piping,
// equipment, and annotation layers on the plan.
function LayerToggles({ state, dispatch }) {
  const { layerVisibility } = state;
  return (
    <div className="mb-4">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Layers</h2>
      <div className="flex gap-1">
        {PIPE_LAYERS.map((layer) => {
          const visible = layerVisibility[layer] !== false;
          return (
            <button
              key={layer}
              onClick={() => dispatch({ type: "TOGGLE_LAYER", layer })}
              title={visible ? `Hide the ${layer} layer` : `Show the ${layer} layer`}
              className={`flex-1 rounded px-1 py-1 text-[11px] font-semibold capitalize ${
                visible ? "bg-sky-600 text-white" : "bg-gray-800 text-gray-500 hover:bg-gray-700"
              }`}
            >
              {layer}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Background underlay: import a PNG/JPG plot plan as a trace-over image,
// with opacity, lock, scale calibration, and removal. Stored in the design
// document as a data URL (Phase 1); a Supabase Storage migration is the
// follow-up if images get large.
function UnderlaySection({ design, dispatch }) {
  const u = design.underlay;
  const [importError, setImportError] = useState(null);

  const onFile = (file) => {
    setImportError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImportError("Please choose a PNG or JPG image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onload = () => {
        dispatch({
          type: "SET_UNDERLAY",
          underlay: {
            name: file.name,
            mimeType: file.type,
            dataUrl,
            widthPx: img.naturalWidth,
            heightPx: img.naturalHeight,
          },
        });
      };
      img.onerror = () => setImportError("Could not read that image.");
      img.src = dataUrl;
    };
    reader.onerror = () => setImportError("Could not read that file.");
    reader.readAsDataURL(file);
  };

  return (
    <div className="mt-4 border-t border-gray-800 pt-3">
      <h2 className="mb-2 text-sm font-semibold text-white">Background underlay</h2>
      {!u ? (
        <div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded bg-gray-800 px-3 py-1.5 text-xs text-white hover:bg-gray-700">
            <Upload size={14} />
            Import background
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          <p className="mt-1 text-[11px] text-gray-500">
            PNG/JPG plot plan to trace over. Calibrate its scale after importing.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="truncate text-xs text-gray-300" title={u.name}>{u.name}</p>
          <p className="text-[11px] text-gray-500">
            {u.widthPx} × {u.heightPx} px · {feetInchesLabel(u.widthPx / u.pxPerIn)} wide on the plan
          </p>
          <label className="block text-xs text-gray-400">
            Opacity
            <input
              type="range"
              min={10}
              max={100}
              value={Math.round(u.opacity * 100)}
              onChange={(e) => dispatch({ type: "UPDATE_UNDERLAY", patch: { opacity: Number(e.target.value) / 100 } })}
              className="mt-1 block w-full"
            />
          </label>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => dispatch({ type: "UPDATE_UNDERLAY", patch: { locked: !u.locked } })}
              title={u.locked ? "Unlock to drag the image into position" : "Lock the image in place"}
              className="inline-flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-xs text-white hover:bg-gray-700"
            >
              {u.locked ? <Lock size={14} /> : <LockOpen size={14} />}
              {u.locked ? "Locked" : "Unlocked"}
            </button>
            <button
              onClick={() => dispatch({ type: "SET_TOOL", tool: "calibrate" })}
              className="inline-flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-xs text-white hover:bg-gray-700"
            >
              <Ruler size={14} />
              Calibrate scale
            </button>
            <button
              onClick={() => dispatch({ type: "REMOVE_UNDERLAY" })}
              className="inline-flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-xs text-red-300 hover:bg-gray-700"
            >
              <Trash2 size={14} />
              Remove
            </button>
          </div>
          {!u.locked && (
            <p className="text-[11px] text-gray-500">Tip: drag the image on the plan to position it, then lock it.</p>
          )}
        </div>
      )}
      {importError && <p className="mt-1 text-xs text-red-400">{importError}</p>}
    </div>
  );
}

// Scale calibration: with an underlay present, click two points on the
// image and enter the real-world distance between them. The canvas scale
// factor updates so walls drawn over the image measure correctly.
function CalibrationPanel({ state, dispatch }) {
  const { calibration, design } = state;
  const [distance, setDistance] = useState("");
  const [error, setError] = useState(null);
  const points = [calibration?.a, calibration?.b].filter(Boolean);

  const apply = () => {
    const inches = parseDimensionInput(distance);
    if (!(inches > 0)) {
      setError("Enter the real distance, e.g. 12' 6\" or 150\".");
      return;
    }
    setError(null);
    dispatch({ type: "APPLY_CALIBRATION", realDistanceIn: inches });
  };

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-white">Calibrate scale</h2>
      <p className="mb-2 text-xs text-gray-400">
        Click two points on the background image, then enter the real-world distance between them.
      </p>
      <p className="mb-3 text-xs text-gray-300">
        Points set: <span className="font-semibold text-cyan-300">{points.length} / 2</span>
      </p>
      {design.underlay && (
        <p className="mb-3 text-[11px] text-gray-500">
          Current: image is {feetInchesLabel(design.underlay.widthPx / design.underlay.pxPerIn)} wide on the plan.
        </p>
      )}
      <label className="block text-xs text-gray-400">
        Real distance between the points
        <input
          value={distance}
          onChange={(e) => setDistance(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
          placeholder="e.g. 12' 6&quot;"
          className="mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-white"
        />
      </label>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      <div className="mt-3 flex gap-1">
        <button
          onClick={apply}
          disabled={points.length < 2}
          className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          Apply scale
        </button>
        <button
          onClick={() => dispatch({ type: "SET_TOOL", tool: "select" })}
          className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ArrangePanel({ state, dispatch }) {
  const { multiSelection } = state;
  const count = multiSelection.length;
  const btn = "rounded bg-gray-800 px-2 py-1 text-xs text-white hover:bg-gray-700 disabled:opacity-40";
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Arrange ({count})</h2>
        <button
          onClick={() => dispatch({ type: "CLEAR_SELECTION" })}
          className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
        >
          Deselect
        </button>
      </div>
      <p className="mb-2 text-[11px] text-gray-500">
        Shift-click furniture on the plan to add or remove pieces.
      </p>
      <div className="mb-2 grid grid-cols-3 gap-1">
        <button className={btn} onClick={() => dispatch({ type: "ALIGN_FURNITURE", mode: "left" })}>
          Align left
        </button>
        <button className={btn} onClick={() => dispatch({ type: "ALIGN_FURNITURE", mode: "center" })}>
          Center
        </button>
        <button className={btn} onClick={() => dispatch({ type: "ALIGN_FURNITURE", mode: "right" })}>
          Align right
        </button>
      </div>
      <button
        className={`${btn} w-full`}
        disabled={count < 3}
        onClick={() => dispatch({ type: "DISTRIBUTE_FURNITURE" })}
      >
        Distribute evenly
      </button>
      {count < 3 && (
        <p className="mt-1 text-[11px] text-gray-500">Select 3 or more pieces to distribute.</p>
      )}
      <button
        onClick={() => dispatch({ type: "DELETE_SELECTION" })}
        className="mt-3 flex items-center gap-1 rounded bg-red-900/60 px-2 py-1 text-xs text-red-200 hover:bg-red-800"
      >
        <Trash2 size={13} /> Delete selected
      </button>
    </div>
  );
}

function SelectionPanel({ state, dispatch }) {
  const { design, selection } = state;
  if (selection.kind === "wall") {
    const wall = design.walls.find((w) => w.id === selection.id);
    if (!wall) return null;
    return (
      <PanelShell title="Wall" onDelete={() => dispatch({ type: "DELETE_SELECTION" })}>
        <Row label="Length" value={feetInchesLabel(wallLength(wall))} />
        <label className="block text-xs text-gray-400">
          Material
          <input
            type="text"
            value={wall.material || ""}
            placeholder="e.g. 2×4 stud"
            onChange={(e) => dispatch({ type: "SET_WALL_MATERIAL", wallId: wall.id, material: e.target.value })}
            className="mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-white placeholder:text-gray-600"
          />
        </label>
        <p className="text-[11px] text-gray-500">Drag the orange endpoints on the plan to resize.</p>
      </PanelShell>
    );
  }
  if (selection.kind === "opening") {
    const opening = design.openings.find((o) => o.id === selection.id);
    if (!opening) return null;
    return (
      <PanelShell title={opening.type === "door" ? "Door" : "Window"} onDelete={() => dispatch({ type: "DELETE_SELECTION" })}>
        <label className="mb-2 block text-xs text-gray-400">
          Width ({opening.widthIn}″)
          <input
            type="range" min={18} max={96} step={2} value={opening.widthIn}
            onChange={(e) => dispatch({ type: "RESIZE_OPENING", openingId: opening.id, widthIn: Number(e.target.value) })}
            className="w-full"
          />
        </label>
        <label className="block text-xs text-gray-400">
          Position along wall ({Math.round(opening.offsetIn)}″)
          <input
            type="range" min={0} max={240} step={1} value={opening.offsetIn}
            onChange={(e) => dispatch({ type: "MOVE_OPENING", openingId: opening.id, offsetIn: Number(e.target.value) })}
            className="w-full"
          />
        </label>
      </PanelShell>
    );
  }
  if (selection.kind === "furniture") {
    const piece = design.furniture.find((f) => f.id === selection.id);
    const entry = piece && getCatalogEntry(piece.catalogId);
    if (!piece || !entry) return null;
    const size = pieceSize(piece);
    const resized = piece.widthIn !== undefined || piece.depthIn !== undefined;
    const applySize = (widthIn, depthIn) => {
      if (widthIn >= 1 && widthIn <= 480 && depthIn >= 1 && depthIn <= 480) {
        dispatch({ type: "RESIZE_FURNITURE", furnitureId: piece.id, widthIn, depthIn });
      }
    };
    return (
      <PanelShell title={entry.label} onDelete={() => dispatch({ type: "DELETE_SELECTION" })}>
        <Row label="Size" value={`${size.widthIn}″ × ${size.depthIn}″`} />
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs text-gray-400">
            Width (″)
            <input
              type="number"
              min={1}
              max={480}
              step={0.5}
              value={size.widthIn}
              onChange={(e) => applySize(Number(e.target.value), size.depthIn)}
              className="mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-white"
            />
          </label>
          <label className="block text-xs text-gray-400">
            Depth (″)
            <input
              type="number"
              min={1}
              max={480}
              step={0.5}
              value={size.depthIn}
              onChange={(e) => applySize(size.widthIn, Number(e.target.value))}
              className="mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-white"
            />
          </label>
        </div>
        {resized && (
          <button
            onClick={() => dispatch({ type: "RESET_FURNITURE_SIZE", furnitureId: piece.id })}
            className="mt-1 rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
          >
            Reset to catalog size ({entry.widthIn}″ × {entry.depthIn}″)
          </button>
        )}
        <label className="block text-xs text-gray-400">
          Unit cost ($)
          <input
            type="number"
            min={0}
            step={0.01}
            value={piece.costPerUnit ?? ""}
            placeholder="e.g. 499.99"
            onChange={(e) => dispatch({
              type: "SET_FURNITURE_COST",
              furnitureId: piece.id,
              costPerUnit: e.target.value === "" ? undefined : Number(e.target.value),
            })}
            className="mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-white placeholder:text-gray-600"
          />
        </label>
        <button
          onClick={() => dispatch({ type: "ROTATE_FURNITURE", furnitureId: piece.id, rotationDeg: piece.rotationDeg + 45 })}
          className="mt-2 flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-xs text-white hover:bg-gray-700"
        >
          <RotateCw size={13} /> Rotate 45°
        </button>
        <p className="mt-2 text-[11px] text-gray-500">Tip: double-click the piece on the plan to rotate it too, or drag its corner handles to resize.</p>
      </PanelShell>
    );
  }
  if (selection.kind === "room") {
    const room = design.rooms.find((r) => r.id === selection.id);
    if (!room) return null;
    return (
      <PanelShell title={room.label} onDelete={() => dispatch({ type: "DELETE_SELECTION" })}>
        <label className="block text-xs text-gray-400">
          Finish
          <input
            type="text"
            value={room.finish || ""}
            placeholder="e.g. hardwood, tile"
            onChange={(e) => dispatch({ type: "SET_ROOM_FINISH", roomId: room.id, finish: e.target.value })}
            className="mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-white placeholder:text-gray-600"
          />
        </label>
        <p className="text-[11px] text-gray-500">Deleting a room also removes its four walls.</p>
      </PanelShell>
    );
  }
  if (selection.kind === "pipe") {
    const run = (design.pipes || []).find((p) => p.id === selection.id);
    if (!run) return null;
    const selectClass = "mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-white";
    return (
      <PanelShell title="Pipe run" onDelete={() => dispatch({ type: "DELETE_SELECTION" })}>
        <Row label="Length" value={feetInchesLabel(pipeRunLengthIn(run.points))} />
        <Row label="Vertices" value={String((run.points || []).length)} />
        <label className="block text-xs text-gray-400">
          Diameter
          <select
            value={run.diameterIn}
            onChange={(e) => dispatch({ type: "SET_PIPE_FIELDS", pipeId: run.id, fields: { diameterIn: Number(e.target.value) } })}
            className={selectClass}
          >
            {PIPE_DIAMETERS_IN.map((d) => (
              <option key={d} value={d}>⌀{d}″</option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-gray-400">
          Material
          <select
            value={run.material || ""}
            onChange={(e) => dispatch({ type: "SET_PIPE_FIELDS", pipeId: run.id, fields: { material: e.target.value } })}
            className={selectClass}
          >
            <option value="">—</option>
            {PIPE_MATERIALS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-gray-400">
          Service
          <input
            type="text"
            value={run.service || ""}
            placeholder="e.g. Process"
            onChange={(e) => dispatch({ type: "SET_PIPE_FIELDS", pipeId: run.id, fields: { service: e.target.value } })}
            className={`${selectClass} placeholder:text-gray-600`}
          />
        </label>
        <label className="block text-xs text-gray-400">
          Layer
          <select
            value={run.layer}
            onChange={(e) => dispatch({ type: "SET_PIPE_FIELDS", pipeId: run.id, fields: { layer: e.target.value } })}
            className={selectClass}
          >
            {PIPE_LAYERS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
        <p className="text-[11px] text-gray-500">Drag the orange vertices on the plan to reshape the run.</p>
      </PanelShell>
    );
  }
  if (selection.kind === "symbol") {
    const inst = (design.symbols || []).find((s) => s.id === selection.id);
    const symbol = inst && findSymbol(inst.domain, inst.symbolId);
    if (!inst || !symbol) return null;
    const selectClass = "mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-white";
    return (
      <PanelShell title={symbol.label} onDelete={() => dispatch({ type: "DELETE_SELECTION" })}>
        <Row label="Size" value={`${symbol.widthIn}″ × ${symbol.depthIn}″`} />
        <label className="block text-xs text-gray-400">
          Equipment tag
          <input
            type="text"
            value={inst.tag || ""}
            placeholder="e.g. P-101"
            onChange={(e) => dispatch({ type: "SET_SYMBOL_TAG", symbolId: inst.id, tag: e.target.value })}
            className={`${selectClass} placeholder:text-gray-600`}
          />
        </label>
        <label className="block text-xs text-gray-400">
          Layer
          <select
            value={inst.layer}
            onChange={(e) => dispatch({ type: "SET_SYMBOL_LAYER", symbolId: inst.id, layer: e.target.value })}
            className={selectClass}
          >
            {PIPE_LAYERS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
        <button
          onClick={() => dispatch({ type: "ROTATE_SYMBOL", symbolId: inst.id, rotationDeg: inst.rotationDeg + 45 })}
          className="mt-2 flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-xs text-white hover:bg-gray-700"
        >
          <RotateCw size={13} /> Rotate 45°
        </button>
        <p className="mt-2 text-[11px] text-gray-500">Tip: double-click the symbol on the plan to rotate it too.</p>
      </PanelShell>
    );
  }
  return null;
}

function PanelShell({ title, onDelete, children }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <button
          onClick={onDelete}
          className="flex items-center gap-1 rounded bg-red-900/60 px-2 py-1 text-xs text-red-200 hover:bg-red-800"
        >
          <Trash2 size={13} /> Delete
        </button>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between text-xs text-gray-300">
      <dt>{label}</dt>
      <dd className="font-semibold text-white">{value}</dd>
    </div>
  );
}
