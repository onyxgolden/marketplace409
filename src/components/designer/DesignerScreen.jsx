"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  BookOpen,
  Box,
  DoorOpen,
  Download,
  Eraser,
  Hand,
  Home,
  Lock,
  LockOpen,
  MousePointer2,
  Network,
  Plus,
  Printer,
  Redo2,
  RotateCw,
  Ruler,
  Save,
  Shapes,
  Sofa,
  Spline,
  Square,
  SquareDashed,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
  ZoomIn,
} from "lucide-react";
import PlanCanvas from "./PlanCanvas";
import PrintSheetOverlay from "./PrintSheetOverlay";
import { decodeUnderlayFile, UNDERLAY_ACCEPT, UNDERLAY_ACCEPT_LABEL } from "./underlayImage";
import HousePlansPanel from "./HousePlansPanel";
import { isHousePlansEnabled } from "@/lib/housePlans/housePlansFlags";
import { createSaveScheduler } from "./saveScheduler";
import DesignerErrorBoundary from "./DesignerErrorBoundary";
import {
  deleteDraft,
  isNewerDraft,
  readDraft,
  readSavedRecord,
  writeDraft,
  writeSavedRecord,
} from "./designerDraft";
import OrgChartPanel from "./OrgChartPanel";
import FurnitureCatalogPanel from "./FurnitureCatalogPanel";
import { createInitialState, designerReducer } from "./designerReducer";
// HOME DESIGNER slice 2: the screen edits the current level of a HomeProject.
// The full envelope (levels[], currentLevelId, building metadata) persists
// to designer_projects.design — see the slice 2 API. Legacy rows wrap
// transparently on load; the switcher below manages levels.
import {
  addLevel,
  ensureHomeProject,
  getCurrentDesign,
  removeLevel,
  renameLevel,
  renameProject,
  setCurrentLevel,
  switchLevel,
  updateLevelDesign,
} from "@/domains/roomDesigner/homeProject";
import { getCatalogEntry } from "@/domains/roomDesigner/furnitureCatalog";
import { getSymbolSet, findSymbol } from "@/domains/roomDesigner/symbolRegistry";
import { ROOM_TEMPLATES, SHEET_LOGO_MAX_BYTES, SHEET_PNG_DATA_URL_PREFIX, fitScaleLabel, patchSheet, pieceSize, sheetFooterOf, sheetHeaderOf, sheetPlanBounds, validateDesign } from "@/domains/roomDesigner/designerDocument";
import { SHEET_CATALOG, SHEET_ORIENTATIONS, sheetSizeLabel } from "@/domains/roomDesigner/sheetCatalog";
import { feetInchesLabel, parseDimensionInput, wallLength } from "@/domains/roomDesigner/designerGeometry";
import {
  PIPE_DIAMETERS_IN,
  PIPE_LAYERS,
  PIPE_MATERIALS,
  PIPE_SERVICES,
  pipeRunLengthIn,
} from "@/domains/roomDesigner/pipingGeometry";
import { summarizeDesignForEstimating } from "@/domains/roomDesigner/designerExports";
import {
  formatArea,
  formatLength,
  measureHomeProject,
  measureLevelDesign,
  projectWithEditedDesign,
} from "@/domains/roomDesigner/homeQuantities";
// HOME DESIGNER slice 4: remodel estimating — pure geometry -> quantities ->
// assemblies -> estimates. Unit costs are user-entered, stored as integer
// cents in the project envelope; nothing here invents prices.
import {
  estimateProject,
  formatUSD,
  parseUnitCostInput,
  setUnitCost,
  unitCostLabel,
} from "@/domains/roomDesigner/homeEstimate";
import ProposalPrintOverlay from "./ProposalPrintOverlay";
import {
  ELEVATION_DIRECTIONS,
  buildElevation,
  buildStackedElevation,
} from "@/domains/roomDesigner/homeSections";
import ElevationSvg from "./ElevationSvg";
import ElevationPrintOverlay from "./ElevationPrintOverlay";
import DxfExportDialog from "./DxfExportDialog";
import { groupToolsByCategory } from "@/domains/roomDesigner/designerToolbar";
import ToolPalette from "./ToolPalette";

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
  { id: "furniture", label: "Furniture", icon: Sofa, hint: "Pick a piece, then click the plan to place it", leftPalette: false },
  { id: "pipe", label: "Pipe", icon: Spline, hint: "Click to add pipe vertices · double-click or Enter to finish · Esc cancels" },
  { id: "piping", label: "Piping", icon: Shapes, hint: "Pick a valve, fitting, or equipment symbol, then click the plan to place it" },
  { id: "orgchart", label: "Org chart", icon: Network, hint: "Click the plan to place an org chart, then add people and reporting lines" },
  { id: "erase", label: "Erase", icon: Eraser, hint: "Click anything to delete it" },
  { id: "pan", label: "Pan", icon: Hand, hint: "Drag to pan · scroll to zoom (or hold Space anytime)" },
  { id: "calibrate", label: "Calibrate", icon: Ruler, hint: "Set the background image scale: click two points on it, then enter the real distance", needsUnderlay: true },
];

// Pinned tools first, then Visio-style collapsible categories
// (House, Mechanical, Process, Plan) in the left tool palette.
const GROUPED_TOOL_DEFS = groupToolsByCategory(TOOL_DEFS);

export default function DesignerScreen({ projectId, initialName }) {
  const [state, dispatch] = useReducer(designerReducer, undefined, () => createInitialState());
  const [name, setName] = useState(initialName || "Untitled design");
  const [status, setStatus] = useState({ kind: "loading", message: "Loading design…" });
  const [saving, setSaving] = useState(false);
  // HOUSE PLANS (HP-L0): docked reference panel, gated behind the feature flag.
  const [housePlansOpen, setHousePlansOpen] = useState(false);
  const housePlansEnabled = isHousePlansEnabled();
  // Printable sheets: overlay state for the single print flow.
  const [printOpen, setPrintOpen] = useState(false);
  const [printSheetId, setPrintSheetId] = useState(null);
  const openPrint = (sheetId) => {
    setPrintSheetId(sheetId || null);
    setPrintOpen(true);
  };
  // HOME DESIGNER slice 4: proposal print overlay state.
  const [proposalOpen, setProposalOpen] = useState(false);
  const [proposalEstimate, setProposalEstimate] = useState(null);
  // HOME DESIGNER slice 5: elevation print overlay state.
  const [elevationOpen, setElevationOpen] = useState(false);
  const [elevationView, setElevationView] = useState(null);
  // HOME DESIGNER slice 6: DXF export dialog state.
  const [dxfOpen, setDxfOpen] = useState(false);

  // Latest snapshots for saves: a queued save must capture the document and
  // name at the moment it actually sends, not when save() was invoked.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  // HOME DESIGNER slice 2: the in-memory HomeProject. The designer edits the
  // current level's document; `project` state mirrors projectRef so the
  // level switcher re-renders on add/rename/switch/delete.
  const projectRef = useRef(null);
  const [project, setProject] = useState(null);
  // Stable identity: only touches a ref and a setState, so callbacks and
  // effects can depend on it without re-running.
  const syncProject = useCallback((next) => {
    projectRef.current = next;
    setProject(next);
  }, []);
  // Level tab UI state: which tab is being renamed / armed for delete.
  const [renamingLevelId, setRenamingLevelId] = useState(null);
  const [confirmDeleteLevelId, setConfirmDeleteLevelId] = useState(null);
  const nameRef = useRef(name);
  useEffect(() => { nameRef.current = name; }, [name]);
  const saveSchedulerRef = useRef(null);
  if (saveSchedulerRef.current === null) saveSchedulerRef.current = createSaveScheduler();
  // Crash-resilience autosave: metadata of the last completed localStorage
  // draft write, shown in the header so it is always visible which work
  // exists only in this browser.
  const [draftInfo, setDraftInfo] = useState(null);
  // Crash recovery offer: { draft, serverProject } when an autosave draft is
  // newer than the last server save. The user chooses explicitly; nothing
  // is ever applied silently.
  const [recovery, setRecovery] = useState(null);
  // Highest designRevision covered by a completed draft write. beforeunload
  // warns only when the current revision is NOT covered.
  const lastDraftedRevisionRef = useRef(-1);

  // Load a server revision into the screen (shared by the normal load
  // path and by "discard draft" recovery).
  const loadServerProject = useCallback((serverProject) => {
    // Legacy single designs migrate transparently into a one-level
    // project ("Level 1 Floor Plan"); the reducer keeps editing the
    // current level's document exactly as before.
    const project = ensureHomeProject(serverProject.design, serverProject.name);
    syncProject(project);
    dispatch({ type: "LOAD_DESIGN", design: getCurrentDesign(project) });
    setName(serverProject.name);
    setStatus({ kind: "ready" });
  }, [syncProject]);

  // Apply the recovered autosave draft (explicit user choice only).
  const recoverDraft = () => {
    if (!recovery) return;
    const { draft, serverProject } = recovery;
    const project = ensureHomeProject(
      draft.envelope,
      draft.envelope.name || serverProject.name,
    );
    syncProject(project);
    dispatch({ type: "LOAD_DESIGN", design: getCurrentDesign(project) });
    setName(draft.envelope.name || serverProject.name);
    setRecovery(null);
    lastDraftedRevisionRef.current = draft.designRevision;
    setDraftInfo({
      savedAt: draft.savedAt,
      designRevision: draft.designRevision,
      underlayOmitted: !!draft.underlayOmitted,
    });
    setStatus({ kind: "ready" });
  };

  const discardDraftAndLoad = () => {
    if (!recovery) return;
    deleteDraft(projectId);
    const { serverProject } = recovery;
    setRecovery(null);
    setDraftInfo(null);
    loadServerProject(serverProject);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/forge/designer/${projectId}`);
        if (!res.ok) throw new Error(`Load failed (${res.status})`);
        const body = await res.json();
        if (cancelled) return;
        // Crash-resilience: recovery authority is REVISION comparison — a
        // draft newer than the last server save is offered explicitly.
        // Timestamps are display-only. Incompatible drafts are rejected by
        // readDraft and fall through to the normal load.
        const draft = readDraft(projectId);
        const serverRevision = readSavedRecord(projectId)?.designRevision ?? 0;
        if (isNewerDraft(draft, serverRevision)) {
          setRecovery({ draft, serverProject: body.project });
          setStatus({ kind: "ready" });
          return;
        }
        loadServerProject(body.project);
      } catch (error) {
        if (!cancelled) setStatus({ kind: "error", message: error.message });
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, loadServerProject]);

  // --- Level switcher (HOME DESIGNER slice 2) ---------------------------
  // Every handler syncs the currently edited document back into the envelope
  // first, so no level's edits are lost when switching/adding/removing.
  // All wrapped in try/catch: a corrupt level surfaces as a status error,
  // never an unhandled rejection or a crashed screen.
  //
  // The switch itself is centralized in the domain function
  // switchLevel(project, currentDesign, targetId): the screen keeps two
  // sources of truth (the envelope in projectRef, the edited document in
  // the reducer), and the domain function takes all three inputs explicitly
  // so the "sync-before-switch" order can never drift apart across handlers.
  const syncCurrentDocInto = (proj) =>
    updateLevelDesign(proj, proj.currentLevelId, () => stateRef.current.design);

  const requestLevelSwitch = (levelId) => {
    const current = projectRef.current;
    if (!current || current.currentLevelId === levelId) return;
    try {
      const { project: switched, design } = switchLevel(
        current,
        stateRef.current.design,
        levelId,
      );
      syncProject(switched);
      setConfirmDeleteLevelId(null);
      setRenamingLevelId(null);
      dispatch({ type: "LOAD_DESIGN", design });
    } catch (error) {
      setStatus({ kind: "error", message: error.message });
    }
  };

  const addLevelUi = () => {
    const current = projectRef.current;
    if (!current) return;
    try {
      const synced = syncCurrentDocInto(current);
      const added = addLevel(synced);
      const newId = added.levels[added.levels.length - 1].id;
      const switched = setCurrentLevel(added, newId);
      syncProject(switched);
      dispatch({ type: "LOAD_DESIGN", design: getCurrentDesign(switched) });
      dispatch({ type: "TOUCH" }); // the new empty level must persist on next save
    } catch (error) {
      setStatus({ kind: "error", message: error.message });
    }
  };

  const commitLevelRename = (levelId, rawName) => {
    setRenamingLevelId(null);
    const name = (rawName || "").trim();
    const current = projectRef.current;
    if (!current || name === "") return;
    const level = current.levels.find((l) => l.id === levelId);
    if (!level || level.name === name) return;
    try {
      syncProject(renameLevel(current, levelId, name));
      dispatch({ type: "TOUCH" });
    } catch (error) {
      setStatus({ kind: "error", message: error.message });
    }
  };

  const deleteLevelUi = (levelId) => {
    const decision = levelDeleteClick(confirmDeleteLevelId, levelId);
    if (decision.armed) {
      // First click arms the delete on THIS level only; nothing is deleted.
      // The second click must land on the same armed level to confirm.
      setConfirmDeleteLevelId(decision.armed);
      return;
    }
    const current = projectRef.current;
    if (!current) return;
    try {
      const synced = syncCurrentDocInto(current);
      const removed = removeLevel(synced, levelId);
      syncProject(removed);
      setConfirmDeleteLevelId(null);
      dispatch({ type: "LOAD_DESIGN", design: getCurrentDesign(removed) });
      dispatch({ type: "TOUCH" });
    } catch (error) {
      setStatus({ kind: "error", message: error.message });
    }
  };

  // Build the exact envelope the server PUT persists (levels[],
  // currentLevelId, building metadata, header name). Shared by the manual
  // save and the autosave draft so recovery restores byte-identical state.
  // Pure: reads refs, never mutates.
  const buildEnvelope = () => {
    const current = projectRef.current;
    let payload = stateRef.current.design;
    if (current) {
      const updated = updateLevelDesign(
        current,
        current.currentLevelId,
        () => stateRef.current.design,
      );
      const headerName = (nameRef.current || "").trim();
      payload =
        headerName !== "" && headerName !== updated.name
          ? renameProject(updated, headerName)
          : updated;
    }
    return payload;
  };

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
        // Sync the edited document back into the project envelope, then
        // persist the whole envelope (levels[], currentLevelId, building).
        // Inside try/catch so an (unexpected) invalid design surfaces as a
        // save error, never an unhandled rejection.
        const project = projectRef.current;
        let designPayload = designToSave;
        if (project) {
          const updated = updateLevelDesign(
            project,
            project.currentLevelId,
            () => designToSave,
          );
          // Keep the envelope name in step with the header input; a blank
          // header keeps the existing project name (renameProject rejects
          // blanks, and the API falls back to design.name anyway).
          const headerName = (nameRef.current || "").trim();
          const renamed =
            headerName !== "" && headerName !== updated.name
              ? renameProject(updated, headerName)
              : updated;
          syncProject(renamed);
          designPayload = renamed;
        }
        const res = await fetch(`/api/forge/designer/${projectId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: nameRef.current, design: designPayload }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Save failed (${res.status})`);
        dispatch({ type: "MARK_SAVED", savedRevision });
        // Crash-resilience race guard: delete the autosave draft ONLY when
        // the completed save covered it (savedRevision >= draft revision).
        // A save of an older revision must never nuke newer browser work.
        // The saved-record keeps the server's revision for recovery
        // comparison on the next load.
        try {
          const draft = readDraft(projectId);
          if (!draft || savedRevision >= draft.designRevision) {
            deleteDraft(projectId);
            if (draft) setDraftInfo(null);
          }
          writeSavedRecord(projectId, savedRevision);
        } catch {
          // Draft bookkeeping must never break the save flow.
        }
        setStatus({ kind: "saved", message: "Saved." });
        setTimeout(() => setStatus((s) => (s.kind === "saved" ? { kind: "ready" } : s)), 2500);
      } catch (error) {
        setStatus({ kind: "error", message: error.message });
      } finally {
        setSaving(false);
      }
    });
    // syncProject is a stable useCallback; including it keeps save() stable.
  }, [projectId, syncProject]);

  // --- Remodel estimating (HOME DESIGNER slice 4) -----------------------
  // Unit-cost edits are project-metadata ops — NOT undoable (same documented
  // rule as level management). TOUCH marks the project dirty so the cost
  // persists through the existing save flow.
  const commitUnitCost = (assemblyId, centsOrNull) => {
    const current = projectRef.current;
    if (!current) return;
    try {
      syncProject(setUnitCost(current, assemblyId, centsOrNull));
      dispatch({ type: "TOUCH" });
    } catch (error) {
      setStatus({ kind: "error", message: error.message });
    }
  };

  const openProposal = (estimate) => {
    setProposalEstimate(estimate);
    setProposalOpen(true);
  };

  // "Save and print": persist first, then print the freshly saved state.
  const saveAndPrintProposal = async () => {
    await save();
    const current = projectRef.current;
    if (!current) return;
    const result = estimateProject(current, stateRef.current.design);
    if (!result.ok) {
      setStatus({ kind: "error", message: result.error });
      return;
    }
    openProposal(result);
  };

  // HOME DESIGNER slice 5: elevation printing follows the same print the
  // live on-screen view contract as the proposal — the sheet always matches
  // what the designer is showing.
  const openElevation = (elevation) => {
    setElevationView(elevation);
    setElevationOpen(true);
  };

  // "Save and print" for elevations: persist first, then rebuild the view
  // from the saved project plus the on-screen design.
  const saveAndPrintElevation = async (direction, scope) => {
    await save();
    const current = projectRef.current;
    if (!current) return;
    const build = scope === "stacked" ? buildStackedElevation : buildElevation;
    const result = build(current, {
      direction,
      editedDesign: stateRef.current.design,
    });
    if (!result.ok) {
      setStatus({ kind: "error", message: result.error });
      return;
    }
    openElevation(result);
  };

  useEffect(() => {
    const isField = (el) =>
      el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
        return;
      }
      // Undo/redo (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y); never hijack typing.
      if ((e.ctrlKey || e.metaKey) && !isField(e.target)) {
        const key = e.key.toLowerCase();
        if (key === "z" && !e.shiftKey) {
          e.preventDefault();
          dispatch({ type: "UNDO" });
        } else if ((key === "z" && e.shiftKey) || key === "y") {
          e.preventDefault();
          dispatch({ type: "REDO" });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  // Crash-resilience autosave: ~2s after edits stop, snapshot the envelope
  // to localStorage. Client-side only — no API, no cost, no migrations.
  // The draft is the recovery source after a crash or accidental tab close.
  useEffect(() => {
    if (!state.dirty || recovery) return undefined;
    const timer = setTimeout(() => {
      const { designRevision } = stateRef.current;
      if (!stateRef.current.dirty) return;
      try {
        const envelope = buildEnvelope();
        const result = writeDraft(projectId, { designRevision, envelope });
        if (result.ok) {
          lastDraftedRevisionRef.current = designRevision;
          setDraftInfo({
            savedAt: result.savedAt,
            designRevision,
            underlayOmitted: result.underlayOmitted,
          });
        }
      } catch {
        // Autosave must never break the editor.
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [projectId, recovery, state.design, state.designRevision, state.dirty, project, name]);

  // Warn on tab close only when there is work the autosave has not captured
  // yet. After a completed draft write there is nothing to warn about.
  useEffect(() => {
    const onBeforeUnload = (e) => {
      const current = stateRef.current;
      if (current.dirty && lastDraftedRevisionRef.current < current.designRevision) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const { design, tool, selection, multiSelection, pendingCatalogId, pendingRoomTemplate, pendingPipe, pendingSymbol, orthoSnap, layerVisibility, view, dirty, past, future } = state;
  const summary = summarizeDesignForEstimating(design);
  const activeTool = TOOL_DEFS.find((t) => t.id === tool);
  // "Zoom to sheet" requests from the Paper sheets panel: consumed by PlanCanvas.
  const [zoomRequest, setZoomRequest] = useState(null);
  const zoomSeq = useRef(0);

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
        {draftInfo && (
          <span
            className="text-xs text-gray-500"
            title="Kept in this browser only — press Ctrl+S to save to the server"
          >
            Autosaved locally {new Date(draftInfo.savedAt).toLocaleTimeString()}
            {draftInfo.underlayOmitted ? " (background image omitted)" : ""}
          </span>
        )}
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
            onClick={() => dispatch({ type: "UNDO" })}
            disabled={(past || []).length === 0}
            title="Undo (Ctrl+Z)"
            className="flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-40"
          >
            <Undo2 size={15} />
          </button>
          <button
            onClick={() => dispatch({ type: "REDO" })}
            disabled={(future || []).length === 0}
            title="Redo (Ctrl+Shift+Z)"
            className="flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-40"
          >
            <Redo2 size={15} />
          </button>
          <button
            onClick={() => openPrint(selection?.kind === "sheet" ? selection.id : null)}
            disabled={(design.sheets || []).length === 0}
            title="Print a sheet…"
            className="flex items-center gap-1 rounded bg-gray-800 px-3 py-1 text-sm font-semibold text-gray-200 hover:bg-gray-700 disabled:opacity-40"
          >
            <Printer size={15} /> Print
          </button>
          <button
            onClick={() => setDxfOpen(true)}
            disabled={!project}
            title="Export the plan as DXF (CAD)…"
            className="flex items-center gap-1 rounded bg-gray-800 px-3 py-1 text-sm font-semibold text-gray-200 hover:bg-gray-700 disabled:opacity-40"
          >
            <Download size={15} /> DXF
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-1 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <Save size={15} /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {/* HOME DESIGNER slice 2: level switcher. One slim tab bar — no extra
          toolbars, no competing coordinate systems. Double-click a tab to
          rename; the × needs two clicks so geometry is never one click away
          from disappearing. Level management (add/rename/delete) is project
          metadata and is NOT undoable — see the TOUCH reducer note and the
          "Levels" label tooltip. */}
      {project && (
        <LevelTabBar
          project={project}
          renamingLevelId={renamingLevelId}
          confirmDeleteLevelId={confirmDeleteLevelId}
          onSwitchLevel={requestLevelSwitch}
          onAddLevel={addLevelUi}
          onStartRename={setRenamingLevelId}
          onCommitRename={commitLevelRename}
          onCancelRename={() => setRenamingLevelId(null)}
          onDeleteLevel={deleteLevelUi}
        />
      )}
      {status.kind === "error" && (
        <div className="bg-red-900/60 px-4 py-2 text-sm text-red-200">{status.message}</div>
      )}
      {status.kind === "saved" && (
        <div className="bg-emerald-900/60 px-4 py-1 text-sm text-emerald-200">{status.message}</div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* tool palette: pinned tools, then collapsible Visio-style categories */}
        <ToolPalette
          grouped={GROUPED_TOOL_DEFS}
          activeToolId={tool}
          hasUnderlay={Boolean(design.underlay)}
          onSelect={(toolId) => dispatch({ type: "SET_TOOL", tool: toolId })}
        />

        {/* canvas */}
        <main className="relative min-w-0 flex-1">
          <DesignerErrorBoundary projectId={projectId}>
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
              zoomRequest={zoomRequest}
            />
          ) : (
            <DesignerViewport3D design={design} />
          )}
          </DesignerErrorBoundary>
          {activeTool && (
            <div className="absolute left-3 top-3 max-w-md rounded bg-gray-900/85 px-3 py-1.5 text-xs text-gray-300">
              <span className="font-semibold text-white">{activeTool.label}:</span> {activeTool.hint}
            </div>
          )}
        </main>

        {/* right panel */}
        <aside className="w-72 overflow-y-auto border-l border-gray-800 bg-gray-900 p-3">
          <RightPanel state={state} dispatch={dispatch} summary={summary} project={project} onPrint={openPrint} onSetUnitCost={commitUnitCost} onPrintProposal={openProposal} onSaveAndPrint={saveAndPrintProposal} onPrintElevation={openElevation} onSaveAndPrintElevation={saveAndPrintElevation} onZoomToSheet={(sheet) => setZoomRequest({ rect: sheetPlanBounds(sheet), nonce: (zoomSeq.current += 1) })} />
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
      {printOpen && (design.sheets || []).length > 0 && (
        <PrintSheetOverlay
          design={design}
          sheets={design.sheets}
          initialSheetId={printSheetId}
          onClose={() => setPrintOpen(false)}
        />
      )}
      {/* HOME DESIGNER slice 4: the printable remodel proposal. */}
      {proposalOpen && proposalEstimate && (
        <ProposalPrintOverlay
          estimate={proposalEstimate}
          onClose={() => setProposalOpen(false)}
        />
      )}
      {/* HOME DESIGNER slice 5: the printable elevation sheet. */}
      {elevationOpen && elevationView && (
        <ElevationPrintOverlay
          elevation={elevationView}
          onClose={() => setElevationOpen(false)}
        />
      )}
      {/* Crash-resilience: autosave recovery offer. Explicit choice only —
          the draft is never applied silently. */}
      {recovery && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Recover unsaved work"
        >
          <div className="w-full max-w-md rounded-lg bg-gray-900 p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-white">Unsaved work found</h2>
            <p className="mt-2 text-sm text-gray-300">
              This project has autosaved work from{" "}
              {new Date(recovery.draft.savedAt).toLocaleString()} that was never
              saved to the server.
              {recovery.draft.underlayOmitted &&
                " The background image was omitted from the autosave (browser storage limit)."}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={discardDraftAndLoad}
                className="rounded bg-gray-700 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-600"
              >
                Discard and load saved version
              </button>
              <button
                type="button"
                onClick={recoverDraft}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                Recover unsaved work
              </button>
            </div>
          </div>
        </div>
      )}
      {/* HOME DESIGNER slice 6: the DXF export dialog. */}
      {dxfOpen && project && (
        <DxfExportDialog
          project={project}
          design={design}
          currentLevelId={project.currentLevelId}
          onClose={() => setDxfOpen(false)}
        />
      )}
    </div>
  );
}

function RightPanel({ state, dispatch, summary, project, onPrint, onZoomToSheet, onSetUnitCost, onPrintProposal, onSaveAndPrint, onPrintElevation, onSaveAndPrintElevation }) {
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
    return <SelectionPanel state={state} dispatch={dispatch} onPrint={onPrint} />;
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
      {/* HOME DESIGNER slice 3: construction intelligence — project-wide
          measurements derived from geometry. */}
      <MeasurementsSection project={project} design={design} />
      {/* HOME DESIGNER slice 4: remodel estimating — quantities x your unit
          costs, then a printable proposal. */}
      <EstimateSection
        project={project}
        design={design}
        dirty={state.dirty}
        onSetUnitCost={onSetUnitCost}
        onPrintProposal={onPrintProposal}
        onSaveAndPrint={onSaveAndPrint}
      />
      {/* HOME DESIGNER slice 5: read-only orthographic elevations — the
          remodel seen vertically, derived from the same plan geometry. */}
      <ElevationSection
        project={project}
        design={design}
        dirty={state.dirty}
        onPrintElevation={onPrintElevation}
        onSaveAndPrintElevation={onSaveAndPrintElevation}
      />
      <LayerToggles state={state} dispatch={dispatch} />
      <SheetsSection
        design={design}
        dispatch={dispatch}
        selection={selection}
        onPrint={onPrint}
        onZoomToSheet={onZoomToSheet}
      />
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
      <VsdxImportSection dispatch={dispatch} />
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

// Background underlay: import a PNG/JPG/WebP/GIF/TIFF/BMP plot plan as a trace-over image,
// with opacity, lock, scale calibration, and removal. Stored in the design
// document as a data URL (Phase 1); a Supabase Storage migration is the
// follow-up if images get large.
/** Printable paper sheets: add/select/print/delete sheet frames. */
function SheetsSection({ design, dispatch, selection, onPrint, onZoomToSheet }) {
  const sheets = design.sheets || [];
  const [sizeId, setSizeId] = useState("letter");
  const [orientation, setOrientation] = useState("portrait");
  return (
    <div className="mb-4">
      <h2 className="mb-2 text-sm font-semibold text-white">Paper sheets</h2>
      <p className="mb-2 text-[11px] text-gray-500">
        WYSIWYG print area. Frames snap to the grid — drag the dashed frame to
        reposition it, or zoom to a sheet to draw inside its border.
      </p>
      <div className="mb-2 flex gap-2">
        <select
          value={sizeId}
          onChange={(e) => setSizeId(e.target.value)}
          className="min-w-0 flex-1 rounded bg-gray-800 px-2 py-1 text-xs text-white"
          aria-label="Sheet size"
        >
          {SHEET_CATALOG.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} {s.widthIn}″ × {s.heightIn}″
            </option>
          ))}
        </select>
        <div className="flex shrink-0 overflow-hidden rounded border border-gray-700">
          {SHEET_ORIENTATIONS.map((o) => (
            <button
              key={o}
              onClick={() => setOrientation(o)}
              className={`px-2 py-1 text-xs capitalize ${
                orientation === o ? "bg-emerald-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              {o}
            </button>
          ))}
        </div>
      </div>
      <button
        onClick={() => dispatch({ type: "ADD_SHEET", sizeId, orientation })}
        className="mb-2 flex w-full items-center justify-center gap-1 rounded bg-gray-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700"
      >
        <SquareDashed size={14} /> Add sheet
      </button>
      {sheets.length === 0 ? (
        <p className="text-[11px] text-gray-600">No sheets yet — add one to print this design.</p>
      ) : (
        <ul className="space-y-1">
          {sheets.map((s) => {
            const active = selection?.kind === "sheet" && selection?.id === s.id;
            return (
              <li
                key={s.id}
                className={`rounded border ${
                  active ? "border-cyan-500 bg-cyan-900/30" : "border-gray-700 bg-gray-800"
                }`}
              >
                <div className="flex items-center gap-1 px-2 py-1">
                <button
                  onClick={() => dispatch({ type: "SELECT", selection: { kind: "sheet", id: s.id } })}
                  className="min-w-0 flex-1 truncate text-left text-xs text-gray-200"
                  title={`${sheetSizeLabel(s.sizeId, s.orientation)} · ${fitScaleLabel(s.fitScale)}`}
                >
                  {sheetSizeLabel(s.sizeId, s.orientation)}
                  <span className="block text-[10px] text-gray-500">{fitScaleLabel(s.fitScale)}</span>
                </button>
                <button
                  onClick={() => onPrint(s.id)}
                  title="Print this sheet"
                  className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
                >
                  <Printer size={13} />
                </button>
                <button
                  onClick={() => onZoomToSheet(s)}
                  title="Zoom to sheet"
                  className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
                >
                  <ZoomIn size={13} />
                </button>
                <button
                  onClick={() =>
                    dispatch({
                      type: "UPDATE_SHEET_FORMAT",
                      sheetId: s.id,
                      orientation: s.orientation === "portrait" ? "landscape" : "portrait",
                    })
                  }
                  title="Rotate orientation"
                  className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
                >
                  <RotateCw size={13} />
                </button>
                <button
                  onClick={() => dispatch({ type: "DELETE_SHEET", sheetId: s.id })}
                  title="Delete sheet"
                  className="rounded p-1 text-gray-400 hover:bg-red-900 hover:text-red-200"
                >
                  <Trash2 size={13} />
                </button>
                </div>
                {active && (
                  <SheetHeaderFooterEditor
                    design={design}
                    sheet={s}
                    onPatch={(patch) => dispatch({ type: "UPDATE_SHEET", sheetId: s.id, patch })}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Per-sheet header/footer editor: title, subtitle, optional PNG logo, and
// left/center/right footer labels. Collapsible inside the selected sheet row.
// Label edits commit on blur (one undo step per edit); the logo is picked
// from a local PNG file, validated before it ever reaches the document.
function SheetHeaderFooterEditor({ design, sheet, onPatch }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(null); // { kind, field, value } while typing
  const fileRef = useRef(null);
  const header = sheetHeaderOf(sheet);
  const footer = sheetFooterOf(sheet);

  // Validate against the domain rules without persisting: reducer errors
  // surface during render, so check first and only dispatch valid patches.
  const applyPatch = (patch) => {
    try {
      patchSheet(design, sheet.id, patch);
    } catch (e) {
      setError(e.message);
      return;
    }
    setError(null);
    onPatch(patch);
  };

  const storedValue = (kind, field) => (kind === "header" ? header[field] : footer[field]);
  const fieldValue = (kind, field) =>
    draft && draft.kind === kind && draft.field === field
      ? draft.value
      : storedValue(kind, field);

  const commitField = (kind, field) => {
    if (!draft || draft.kind !== kind || draft.field !== field) return;
    setDraft(null);
    if (draft.value === storedValue(kind, field)) return;
    applyPatch({ [kind]: { [field]: draft.value } });
  };

  const fieldProps = (kind, field) => ({
    value: fieldValue(kind, field),
    onChange: (e) => setDraft({ kind, field, value: e.target.value }),
    onBlur: () => commitField(kind, field),
    onKeyDown: (e) => {
      if (e.key === "Enter") e.currentTarget.blur();
    },
  });

  const inputClass =
    "w-full rounded bg-gray-900 px-2 py-1 text-xs text-white placeholder-gray-600 outline-none focus:ring-1 focus:ring-cyan-600";

  const onLogoFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (file.type !== "image/png") {
      setError("Logo must be a PNG file.");
      return;
    }
    if (file.size > SHEET_LOGO_MAX_BYTES) {
      setError("Logo must be under 1.5 MB \u2014 pick a smaller PNG.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError("Couldn\u2019t read that PNG file.");
    reader.onload = () => applyPatch({ header: { logo: reader.result } });
    reader.readAsDataURL(file);
  };

  return (
    <div className="border-t border-gray-700 px-2 py-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1 text-[11px] font-semibold text-gray-300 hover:text-white"
      >
        <Type size={12} />
        Header &amp; footer
        <span className="text-gray-500">{open ? "\u25be" : "\u25b8"}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          {error && (
            <p role="alert" className="text-[11px] text-red-400">
              {error}
            </p>
          )}
          <label className="block text-[11px] text-gray-400">
            Header title
            <input
              className={inputClass}
              placeholder="e.g. Site Plan"
              maxLength={200}
              {...fieldProps("header", "title")}
            />
          </label>
          <label className="block text-[11px] text-gray-400">
            Header subtitle
            <input
              className={inputClass}
              placeholder="e.g. 123 Main St \u2014 Lot 4"
              maxLength={200}
              {...fieldProps("header", "subtitle")}
            />
          </label>
          <div>
            <div className="mb-1 text-[11px] text-gray-400">Header logo (PNG)</div>
            {header.logo ? (
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- data-URL logo cannot use the Next image optimizer */}
                <img
                  src={header.logo}
                  alt="Sheet logo"
                  className="h-8 max-w-[120px] rounded bg-white object-contain px-1"
                />
                <button
                  type="button"
                  onClick={() => applyPatch({ header: { logo: null } })}
                  className="rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-700 hover:text-white"
                >
                  Remove logo
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-700 hover:text-white"
              >
                Choose PNG\u2026
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png"
              className="hidden"
              aria-label="Upload PNG logo"
              onChange={onLogoFile}
            />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {["left", "center", "right"].map((col) => (
              <label key={col} className="block text-[11px] capitalize text-gray-400">
                Footer {col}
                <input
                  className={inputClass}
                  placeholder={col === "left" ? "Drawn by" : col === "center" ? "Page" : "Date"}
                  maxLength={200}
                  {...fieldProps("footer", col)}
                />
              </label>
            ))}
          </div>
          <p className="text-[10px] leading-relaxed text-gray-600">
            Header and footer print in the sheet margins. Empty fields keep the
            standard strips.
          </p>
        </div>
      )}
    </div>
  );
}


function UnderlaySection({ design, dispatch }) {
  const u = design.underlay;  const [importError, setImportError] = useState(null);

  const onFile = async (file) => {
    setImportError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImportError("Please choose an image file (PNG, JPG, WebP, GIF, TIFF, or BMP).");
      return;
    }
    try {
      // The single underlay import path: every format decodes to a PNG data
      // URL + pixel dimensions (TIFF via UTIF, the rest natively).
      const decoded = await decodeUnderlayFile(file);
      dispatch({
        type: "SET_UNDERLAY",
        underlay: { name: file.name, ...decoded },
      });
    } catch (err) {
      setImportError(err?.message || "Could not read that image.");
    }
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
              accept={UNDERLAY_ACCEPT}
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          <p className="mt-1 text-[11px] text-gray-500">
            {UNDERLAY_ACCEPT_LABEL} plot plan to trace over (screen-capture exports included).
            Calibrate its scale after importing.
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

// Visio import: staged .vsdx import — choose file → (page picker) →
// prepare → preview → explicit commit. Everything runs locally in the
// browser; nothing is uploaded.
const VSDX_PHASE_LABELS = {
  opening: "Opening drawing",
  "reading-pages": "Reading pages",
  "resolving-shapes": "Resolving shapes",
  "converting-geometry": "Converting geometry",
  classifying: "Classifying shapes",
  preparing: "Preparing import",
};

function summarizeVsdxImport(prepared) {
  const c = prepared.counts;
  const semantic = c.mapped - c.annotationShapes;
  return `Imported ${prepared.shapeCount} shapes from page '${prepared.page.name}': ${semantic} mapped, ${c.annotationShapes} as annotations, ${c.skipped} skipped.`;
}

// HOME DESIGNER slice 2: level switcher tab bar + delete-confirm state
// machine. Extracted as exported pieces so the two-click delete contract is
// unit-testable without mounting the whole screen.
//
// HOME DESIGNER slice 3: construction intelligence. A read-only measurements
// readout derived purely from Room Designer geometry (never pixels, never
// invented prices). The edited (possibly unsaved) design is swapped into the
// current level so the numbers reflect what is on screen. A damaged project
// renders a status line, never a crash. Defaulted construction parameters
// are surfaced as an assumptions line — never presented as measured.

function buildMeasurementView(project, design) {
  if (project) {
    const measured = measureHomeProject(projectWithEditedDesign(project, design));
    if (!measured.ok) return { error: measured.error };
    return {
      units: measured.units,
      totals: measured.totals,
      levels: measured.levels,
      levelCount: measured.levelCount,
      multi: true,
    };
  }
  if (design) {
    const level = measureLevelDesign(design);
    if (!level) return { error: "The current design could not be measured." };
    return { units: "in", totals: level, levels: null, levelCount: 1, multi: false };
  }
  return null;
}

export function MeasurementsSection({ project, design }) {
  const view = buildMeasurementView(project, design);
  if (!view) return null;
  if (view.error) {
    return (
      <div className="mb-4">
        <h2 className="mb-2 text-sm font-semibold text-white">Measurements</h2>
        <p className="rounded bg-red-900/40 px-2 py-1 text-xs text-red-200">
          Measurements unavailable: {view.error}
        </p>
      </div>
    );
  }
  const t = view.totals;
  const units = view.units;
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return (
    <div className="mb-4">
      <h2 className="mb-2 text-sm font-semibold text-white">
        Measurements{view.multi ? ` · ${view.levelCount} levels` : ""}
      </h2>
      <dl className="mb-2 space-y-1 text-xs text-gray-300">
        <div className="flex justify-between"><dt>Floor area (gross)</dt><dd>{formatArea(t.grossRoomAreaSqFt, units)}</dd></div>
        <div className="flex justify-between"><dt>Floor area (net)</dt><dd>{formatArea(t.netRoomAreaSqFt, units)}</dd></div>
        <div className="flex justify-between"><dt>Wall length</dt><dd>{formatLength(t.totalWallLengthIn, units)}</dd></div>
        <div className="flex justify-between"><dt>Wall length (net of openings)</dt><dd>{formatLength(t.netWallLengthIn, units)}</dd></div>
        <div className="flex justify-between"><dt>Wall surface (one face)</dt><dd>{formatArea(t.wallSurfaceAreaSqFt, units)}</dd></div>
        <div className="flex justify-between"><dt>Openings</dt><dd>{plural(t.doorCount, "door")} / {plural(t.windowCount, "window")}</dd></div>
      </dl>
      {view.multi &&
        view.levels.map((level) => (
          <div key={level.id} className="flex justify-between py-0.5 text-xs text-gray-400">
            <span className="truncate pr-2">{level.name}</span>
            <span className="whitespace-nowrap">
              {formatArea(level.grossRoomAreaSqFt, units)} · {formatLength(level.totalWallLengthIn, units)}
            </span>
          </div>
        ))}
      <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
        From plan geometry; net floor area subtracts wall footprints (a planning
        number, not a survey). Quantities only — no pricing.
      </p>
      {t.assumptions && t.assumptions.length > 0 && (
        <p className="mt-1 text-[11px] leading-relaxed text-amber-200/70">
          Assumptions: {t.assumptions.join("; ")}.
        </p>
      )}
    </div>
  );
}

// HOME DESIGNER slice 4: remodel estimating. One row per assembly — live
// geometry quantity, a unit-cost $ input, and the extended cost. Costs are
// user-entered only and stored as integer cents in the project envelope;
// nothing here invents prices. Unit-cost edits are project-metadata ops and
// are NOT undoable (same documented rule as level management in slice 2).
// The proposal prints the live on-screen estimate; when the project is dirty
// the print button first shows the unsaved-changes warning (print current /
// save and print / cancel) — printing is never blocked, the state is just
// made visible.

function estimateQuantityLabel(item, units) {
  if (item.unit === "each") return String(item.quantity);
  if (item.unit === "linft") return formatLength(item.quantity * 12, units);
  return formatArea(item.quantity, units);
}

function AssemblyCostRow({ item, units, onCommit }) {
  const inputRef = useRef(null);
  const [error, setError] = useState(null);
  const committed =
    item.unitCostCents === null ? "" : (item.unitCostCents / 100).toFixed(2);
  const commit = () => {
    const el = inputRef.current;
    if (!el) return;
    const parsed = parseUnitCostInput(el.value);
    if (parsed.invalid) {
      // Invalid input is never committed — revert to the stored value.
      setError("Enter a non-negative cost, or clear the field.");
      el.value = committed;
      return;
    }
    setError(null);
    onCommit(item.assemblyId, parsed.clear ? null : parsed.cents);
  };
  return (
    <div className="py-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="min-w-0 flex-1 truncate text-gray-200" title={item.name}>
          {item.name}
        </span>
        <span className="w-24 shrink-0 text-right text-gray-400">
          {estimateQuantityLabel(item, units)}
        </span>
        <span className="flex w-24 shrink-0 items-center gap-1">
          <span className="text-gray-500">$</span>
          <input
            key={`${item.assemblyId}:${item.unitCostCents === null ? "pending" : item.unitCostCents}`}
            ref={inputRef}
            defaultValue={committed}
            inputMode="decimal"
            aria-label={`Unit cost for ${item.name} (${unitCostLabel(item.unit)})`}
            placeholder="0.00"
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="w-full rounded bg-gray-800 px-1.5 py-0.5 text-right text-white placeholder:text-gray-600"
          />
        </span>
        <span className="w-20 shrink-0 text-right text-gray-200">
          {item.extendedCents === null ? (
            <span className="text-gray-600">—</span>
          ) : (
            formatUSD(item.extendedCents)
          )}
        </span>
      </div>
      <div className="text-[10px] text-gray-600">{unitCostLabel(item.unit)}</div>
      {error && <p className="text-[11px] text-red-300">{error}</p>}
    </div>
  );
}

export function EstimateSection({
  project,
  design,
  dirty,
  onSetUnitCost,
  onPrintProposal,
  onSaveAndPrint,
}) {
  const [showDirtyWarning, setShowDirtyWarning] = useState(false);
  if (!project) return null;
  const estimate = estimateProject(projectWithEditedDesign(project, design));
  if (!estimate.ok) {
    return (
      <div className="mb-4">
        <h2 className="mb-2 text-sm font-semibold text-white">Estimate</h2>
        <p className="rounded bg-red-900/40 px-2 py-1 text-xs text-red-200">
          Estimate unavailable: {estimate.error}
        </p>
      </div>
    );
  }
  const requestPrint = () => {
    if (dirty) {
      setShowDirtyWarning(true);
      return;
    }
    onPrintProposal(estimate);
  };
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Estimate</h2>
        <button
          onClick={requestPrint}
          className="rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-500"
        >
          Print proposal
        </button>
      </div>
      {estimate.pricedCount === 0 ? (
        <p className="rounded bg-gray-800/60 px-2 py-2 text-xs leading-relaxed text-gray-400">
          Enter your unit costs to price this estimate. Nothing here is priced
          until you type a cost — no placeholder prices.
        </p>
      ) : (
        <p className="mb-1 text-[11px] text-gray-500">
          {estimate.pendingCount} of {estimate.items.length} items to be priced
        </p>
      )}
      <div className="divide-y divide-gray-800">
        {estimate.items.map((item) => (
          <AssemblyCostRow
            key={item.assemblyId}
            item={item}
            units={estimate.units}
            onCommit={onSetUnitCost}
          />
        ))}
      </div>
      {estimate.pricedCount > 0 && (
        <div className="flex justify-between border-t border-gray-700 pt-1 text-xs font-semibold text-white">
          <span>Subtotal</span>
          <span>{formatUSD(estimate.subtotalCents)}</span>
        </div>
      )}
      <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
        From plan geometry; costs are yours — quantities update live as the
        plan changes.
      </p>
      {estimate.assumptions && estimate.assumptions.length > 0 && (
        <p className="mt-1 text-[11px] leading-relaxed text-amber-200/70">
          Assumptions: {estimate.assumptions.join("; ")}.
        </p>
      )}
      {showDirtyWarning && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="alertdialog"
          aria-label="Unsaved changes"
        >
          <div className="w-full max-w-sm rounded-lg bg-gray-800 p-4 shadow-xl">
            <h3 className="mb-2 text-sm font-semibold text-white">Unsaved changes</h3>
            <p className="mb-4 text-xs leading-relaxed text-gray-300">
              This proposal uses current unsaved changes. Save first if you want
              the proposal tied to the saved project.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  setShowDirtyWarning(false);
                  onPrintProposal(estimate);
                }}
                className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500"
              >
                Print current version
              </button>
              <button
                onClick={() => {
                  setShowDirtyWarning(false);
                  onSaveAndPrint();
                }}
                className="rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                Save and print
              </button>
              <button
                onClick={() => setShowDirtyWarning(false)}
                className="rounded bg-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// HOME DESIGNER slice 5: read-only orthographic elevations of the plan
// geometry. The viewer builds the elevation from the on-screen design
// (projectWithEditedDesign, like Measurements and Estimate) and renders it
// as SVG; printing goes through the shared ElevationPrintOverlay flow. The
// viewer is deliberately named "Elevations" — true cut-through sections are
// a later slice, and the UI should not imply a capability that does not
// exist yet.
export function ElevationSection({
  project,
  design,
  dirty,
  onPrintElevation,
  onSaveAndPrintElevation,
}) {
  const [direction, setDirection] = useState("N");
  const [scope, setScope] = useState("level");
  const [showDirtyWarning, setShowDirtyWarning] = useState(false);
  if (!project) return null;
  const build = scope === "stacked" ? buildStackedElevation : buildElevation;
  const elevation = build(projectWithEditedDesign(project, design), {
    direction,
  });
  if (!elevation.ok) {
    return (
      <div className="mb-4">
        <h2 className="mb-2 text-sm font-semibold text-white">Elevations</h2>
        <p className="rounded bg-red-900/40 px-2 py-1 text-xs text-red-200">
          Elevation unavailable: {elevation.error}
        </p>
      </div>
    );
  }
  const requestPrint = () => {
    if (dirty) {
      setShowDirtyWarning(true);
      return;
    }
    onPrintElevation(elevation);
  };
  const wallCount = elevation.levels.reduce((n, l) => n + l.wallCount, 0);
  const multiLevel = project.levels && project.levels.length > 1;
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Elevations</h2>
        <button
          onClick={requestPrint}
          className="rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-500"
        >
          Print elevation
        </button>
      </div>
      <p className="mb-2 text-[11px] text-gray-500">
        Read-only orthographic views from plan geometry. Sections (coming
        later).
      </p>
      <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Elevation direction">
        {ELEVATION_DIRECTIONS.map((d) => (
          <button
            key={d}
            onClick={() => setDirection(d)}
            aria-pressed={direction === d}
            className={`rounded px-2 py-1 text-xs font-semibold ${
              direction === d
                ? "bg-emerald-700 text-white"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            {d}
          </button>
        ))}
        {multiLevel && (
          <>
            <span className="mx-1 self-center text-[11px] text-gray-600">·</span>
            <button
              onClick={() => setScope("level")}
              aria-pressed={scope === "level"}
              className={`rounded px-2 py-1 text-xs font-semibold ${
                scope === "level"
                  ? "bg-emerald-700 text-white"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              Current level
            </button>
            <button
              onClick={() => setScope("stacked")}
              aria-pressed={scope === "stacked"}
              className={`rounded px-2 py-1 text-xs font-semibold ${
                scope === "stacked"
                  ? "bg-emerald-700 text-white"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              All levels stacked
            </button>
          </>
        )}
      </div>
      {wallCount === 0 ? (
        <p className="rounded bg-gray-800/60 px-2 py-2 text-xs leading-relaxed text-gray-400">
          Draw walls on the plan to see an elevation.
        </p>
      ) : (
        <div className="rounded bg-gray-950/60 px-1 py-2">
          <ElevationSvg elevation={elevation} dark={true} id="panel" />
        </div>
      )}
      {elevation.assumptions && elevation.assumptions.length > 0 && (
        <p className="mt-1 text-[11px] leading-relaxed text-amber-200/70">
          <span className="rounded bg-amber-900/50 px-1 py-0.5 font-semibold text-amber-200">
            Partial view
          </span>{" "}
          Assumptions: {elevation.assumptions.join("; ")}.
        </p>
      )}
      {showDirtyWarning && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="alertdialog"
          aria-label="Unsaved changes"
        >
          <div className="w-full max-w-sm rounded-lg bg-gray-800 p-4 shadow-xl">
            <h3 className="mb-2 text-sm font-semibold text-white">Unsaved changes</h3>
            <p className="mb-4 text-xs leading-relaxed text-gray-300">
              This elevation sheet uses current unsaved changes. Save first if
              you want the sheet tied to the saved project.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  setShowDirtyWarning(false);
                  onPrintElevation(elevation);
                }}
                className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500"
              >
                Print current version
              </button>
              <button
                onClick={() => {
                  setShowDirtyWarning(false);
                  onSaveAndPrintElevation(direction, scope);
                }}
                className="rounded bg-emerald-600 px-3 py-2 text-sm text-gray-200 hover:bg-gray-600"
              >
                Save and print
              </button>
              <button
                onClick={() => setShowDirtyWarning(false)}
                className="rounded bg-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Delete contract (enforced by levelDeleteClick, rendered by LevelTabBar):
// - The first click on a level's × only ARMS that level (shows "Sure?").
//   Nothing is deleted.
// - Only a second click on the SAME armed level deletes it.
// - Clicking × on a different level re-arms that level instead — the armed
//   level can never be deleted by clicking elsewhere.
// - The × is hidden entirely when one level remains (last level can't go).
//
// Level management (add/rename/delete) are project-metadata operations,
// not canvas edits — they bypass the undo history (see the TOUCH reducer)
// and are intentionally NOT undoable. The "Levels" label tooltip says so.

/**
 * Pure two-click delete state machine.
 * @returns {{ armed: string } | { delete: string }}
 */
export function levelDeleteClick(confirmDeleteLevelId, levelId) {
  return confirmDeleteLevelId === levelId
    ? { delete: levelId }
    : { armed: levelId };
}

export function LevelTabBar({
  project,
  renamingLevelId,
  confirmDeleteLevelId,
  onSwitchLevel,
  onAddLevel,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDeleteLevel,
}) {
  return (
    <div className="flex items-center gap-1 border-b border-gray-800 bg-gray-900 px-4 py-1.5" role="tablist" aria-label="Levels">
      <span
        className="mr-1 select-none text-[11px] font-semibold uppercase tracking-wide text-gray-500"
        title="Level management (add / rename / delete) is project metadata and is not undoable"
      >
        Levels
      </span>
      {project.levels.map((level) => {
        const active = level.id === project.currentLevelId;
        const renaming = renamingLevelId === level.id;
        const armed = confirmDeleteLevelId === level.id;
        return (
          <div
            key={level.id}
            role="tab"
            aria-selected={active}
            className={`flex items-center rounded ${
              active ? "bg-emerald-700" : "bg-gray-800 hover:bg-gray-700"
            }`}
          >
            {renaming ? (
              <input
                autoFocus
                defaultValue={level.name}
                aria-label="Level name"
                className="w-28 rounded bg-gray-950 px-2 py-1 text-sm text-white outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter") onCommitRename(level.id, e.target.value);
                  else if (e.key === "Escape") onCancelRename();
                }}
                onBlur={(e) => onCommitRename(level.id, e.target.value)}
              />
            ) : (
              <button
                onClick={() => onSwitchLevel(level.id)}
                onDoubleClick={() => onStartRename(level.id)}
                title="Switch level · double-click to rename"
                className={`px-3 py-1 text-sm font-medium ${
                  active ? "text-white" : "text-gray-300"
                }`}
              >
                {level.name}
              </button>
            )}
            {!renaming && project.levels.length > 1 && (
              <button
                onClick={() => onDeleteLevel(level.id)}
                title={armed ? "Click again to delete this level" : "Delete level"}
                aria-label={armed ? `Confirm delete ${level.name}` : `Delete ${level.name}`}
                className={`mr-1 rounded px-1.5 py-0.5 text-xs font-semibold ${
                  armed
                    ? "bg-red-600 text-white"
                    : "text-gray-500 hover:bg-gray-700 hover:text-red-300"
                }`}
              >
                {armed ? "Sure?" : <X size={12} />}
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={onAddLevel}
        title="Add a level"
        className="flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-sm text-gray-300 hover:bg-gray-700"
      >
        <Plus size={14} /> Add level
      </button>
    </div>
  );
}

export function VsdxImportSection({ dispatch }) {
  const [stage, setStage] = useState("idle");
  const [file, setFile] = useState(null);
  const [pages, setPages] = useState([]);
  const [phase, setPhase] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [error, setError] = useState(null);
  const [lastReport, setLastReport] = useState(null);
  const [lastIssues, setLastIssues] = useState([]);

  const reset = () => {
    setStage("idle");
    setFile(null);
    setPages([]);
    setPrepared(null);
    setError(null);
    setPhase(null);
  };

  const fail = (err) => {
    setError(err?.message || "Could not import that file.");
    setStage("error");
  };

  const runPrepare = async (f, pageIndex) => {
    setStage("preparing");
    setPhase(null);
    try {
      const { prepareVsdxImport } = await import("@/domains/roomDesigner/importers/vsdx/visioImporter");
      const result = await prepareVsdxImport(f, { pageIndex, onPhase: setPhase });
      setPrepared(result);
      setStage("preview");
    } catch (err) {
      fail(err);
    }
  };

  const onFile = async (f) => {
    setError(null);
    setLastReport(null);
    if (!f) return;
    if (!/\.vsdx$/i.test(f.name || "")) {
      setError("Only .vsdx files are supported — not the legacy binary .vsd format.");
      setStage("error");
      return;
    }
    setFile(f);
    setStage("reading");
    try {
      const { listVsdxPages } = await import("@/domains/roomDesigner/importers/vsdx/visioImporter");
      const list = await listVsdxPages(f);
      if (list.length <= 1) {
        await runPrepare(f, 0);
      } else {
        setPages(list);
        setStage("pages");
      }
    } catch (err) {
      fail(err);
    }
  };

  const commit = () => {
    setStage("committing");
    try {
      dispatch({ type: "IMPORT_VSDX_RESULT", importResult: prepared });
      setLastReport(summarizeVsdxImport(prepared));
      setLastIssues(prepared.issues || []);
      setPrepared(null);
      setStage("done");
    } catch (err) {
      fail(err);
    }
  };

  const recordCounts = (r) =>
    [
      ["Walls", r.walls.length],
      ["Rooms", r.rooms.length],
      ["Openings", r.openings.length],
      ["Pipes", r.pipes.length],
      ["Symbols", r.symbols.length],
      ["Furniture", r.furniture.length],
      ["Annotations", r.annotations.length],
    ].filter(([, n]) => n > 0);

  const issueList = (issues, cap = 12) => (
    <div className="mt-2">
      <p className="text-[11px] font-semibold text-amber-300">
        {issues.length} note{issues.length === 1 ? "" : "s"} — review before building on this import
      </p>
      <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-[11px] text-gray-400">
        {issues.slice(0, cap).map((issue, i) => (
          <li key={i}>
            <span className="text-gray-500">{issue.provenance}: </span>
            {issue.message}
          </li>
        ))}
        {issues.length > cap && <li className="text-gray-500">…and {issues.length - cap} more.</li>}
      </ul>
    </div>
  );

  return (
    <div className="mt-4 border-t border-gray-800 pt-3">
      <h2 className="mb-2 text-sm font-semibold text-white">Import Visio (.vsdx)</h2>

      {stage === "idle" && (
        <div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded bg-gray-800 px-3 py-1.5 text-xs text-white hover:bg-gray-700">
            <Upload size={14} />
            Choose .vsdx file
            <input
              type="file"
              accept=".vsdx"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
            One page per import. Walls, rooms, doors, pipes, and furniture map
            when the drawing gives strong evidence; everything else becomes a
            read-only annotation. Fully local — nothing is uploaded.
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
            Limits: .vsdx only (not legacy .vsd) · no formula engine · no
            macros/OLE · no exact themes or data graphics. The import is an
            approximation — review it before building on it.
          </p>
        </div>
      )}

      {stage === "reading" && (
        <p className="text-xs text-gray-400">Opening drawing…</p>
      )}

      {stage === "pages" && (
        <div>
          <p className="mb-1 text-xs text-gray-300">
            <span className="font-medium text-white">{file?.name}</span> has {pages.length} pages — which one should be imported?
          </p>
          <ul className="mb-2 max-h-40 space-y-1 overflow-y-auto">
            {pages.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => runPrepare(file, p.index)}
                  className="w-full rounded bg-gray-800 px-2 py-1.5 text-left text-xs text-white hover:bg-gray-700"
                >
                  <span className="text-gray-500">{p.index + 1}.</span> {p.name}
                </button>
              </li>
            ))}
          </ul>
          <button onClick={reset} className="text-[11px] text-gray-500 hover:text-gray-300">
            Cancel
          </button>
        </div>
      )}

      {stage === "preparing" && (
        <p className="text-xs text-gray-400">
          {VSDX_PHASE_LABELS[phase] || "Working"}…
        </p>
      )}

      {stage === "preview" && prepared && (
        <div>
          <p className="text-xs text-gray-300">
            <span className="font-medium text-white">Page &apos;{prepared.page.name}&apos;</span>
            {" "}— {prepared.shapeCount} shapes resolved.
          </p>
          <dl className="mt-2 space-y-0.5 text-xs text-gray-400">
            {recordCounts(prepared.records).map(([label, n]) => (
              <div key={label} className="flex justify-between">
                <dt>{label}</dt>
                <dd className="text-gray-200">{n}</dd>
              </div>
            ))}
          </dl>
          {prepared.issues.length > 0 && issueList(prepared.issues)}
          <div className="mt-3 flex gap-2">
            <button
              onClick={commit}
              className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
            >
              Import this page
            </button>
            <button
              onClick={reset}
              className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {stage === "committing" && (
        <p className="text-xs text-gray-400">Applying import…</p>
      )}

      {stage === "done" && (
        <div>
          <p className="text-xs text-emerald-300">{lastReport}</p>
          {lastIssues.length > 0 && issueList(lastIssues)}
          <button
            onClick={reset}
            className="mt-2 rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
          >
            Import another file
          </button>
        </div>
      )}

      {stage === "error" && (
        <div>
          <p className="text-xs text-red-400">{error}</p>
          <button
            onClick={reset}
            className="mt-2 rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
          >
            Try another file
          </button>
        </div>
      )}
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

function SelectionPanel({ state, dispatch, onPrint }) {
  const { design, selection } = state;
  if (selection.kind === "sheet") {
    const sheet = (design.sheets || []).find((s) => s.id === selection.id);
    if (!sheet) return null;
    const bounds = sheetPlanBounds(sheet);
    return (
      <PanelShell title="Paper sheet" onDelete={() => dispatch({ type: "DELETE_SELECTION" })}>
        <Row label="Size" value={sheetSizeLabel(sheet.sizeId, sheet.orientation)} />
        <Row
          label="Plan area"
          value={`${Math.round(bounds.widthIn)}″ × ${Math.round(bounds.heightIn)}″`}
        />
        <p className="text-xs text-gray-300">{fitScaleLabel(sheet.fitScale)}</p>
        <div className="flex gap-2">
          <button
            onClick={() => onPrint(sheet.id)}
            className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
          >
            <Printer size={13} /> Print sheet…
          </button>
          <button
            onClick={() =>
              dispatch({
                type: "UPDATE_SHEET_FORMAT",
                sheetId: sheet.id,
                orientation: sheet.orientation === "portrait" ? "landscape" : "portrait",
              })
            }
            className="flex items-center gap-1 rounded bg-gray-800 px-3 py-1.5 text-xs text-white hover:bg-gray-700"
          >
            <RotateCw size={13} /> Rotate
          </button>
        </div>
        <p className="text-[11px] text-gray-500">
          Drag the dashed frame on the plan to reposition it. The frame&apos;s area and scale are
          fixed — only content inside the frame prints.
        </p>
      </PanelShell>
    );
  }
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
