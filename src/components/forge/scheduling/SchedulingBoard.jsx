"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import SchedulingHelpModal from "./SchedulingHelpModal";
import {
  CATEGORY_NAMES, LANE_LABEL_WIDTH_PX, MAX_ZOOM_PX, MIN_ZOOM_PX, MILESTONE_COLOR, RELATIONSHIP_TYPES, ROW_HEIGHT_PX,
  TEXT_COLOR_OPTIONS, TEXT_SIZE_OPTIONS,
  addBlock, addCustomChip, addDependency, addLane, blockToChip, chipsByCategory, clampIndex, colorForCategory,
  computeWeeks, criticalPath, defaultBoardState, dependenciesForBlock, dependencyArrowPoints, deserializeBoardState,
  deleteLane, emptyHistory, fitBlockFontSizePx, fitWeekWidthPx, laneIndexOf, linkBlocksInOrder, moveBlock,
  moveBlocksBy, pixelToIndex, projectStorageKey, recordHistory, redoHistory, removeBlock, removeDependency,
  renameBlock, renameLane, resizeBlock, resizeBlockFromStart, serializeBoardState, setBlockTextStyle,
  setProjectDates, suggestPredecessors, suggestSuccessors, undoHistory, visibleWeekIndices,
} from "./schedulingBoardState";

function isTypingTarget(el) {
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

const PALETTE_COLLAPSE_STORAGE_KEY = "forge-scheduling-palette-collapsed";

function loadStoredBoard(projectId) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(projectStorageKey(projectId));
    return raw ? deserializeBoardState(raw) : null;
  } catch {
    return null;
  }
}

function loadPaletteCollapsed() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PALETTE_COLLAPSE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function formatWeek(iso) {
  const [y, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export default function SchedulingBoard({ projectId }) {
  const [board, setBoard] = useState(() => defaultBoardState(projectId));
  const [saveStatus, setSaveStatus] = useState("");
  const [clipboardStatus, setClipboardStatus] = useState("");
  // Ordered, not a Set: Ctrl/Cmd+click appends to build up a chain, and "Link in order"
  // connects consecutive pairs in exactly this order (see handleLinkSelectedInOrder).
  const [selectedBlockIds, setSelectedBlockIds] = useState([]);
  const [customChipDraft, setCustomChipDraft] = useState({ label: "", category: "gov", durationWeeks: 4, milestone: false });
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [hideEmptyWeeks, setHideEmptyWeeks] = useState(false);
  const [history, setHistory] = useState(emptyHistory);
  const [showHelp, setShowHelp] = useState(false);
  const [showCriticalPath, setShowCriticalPath] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { x, y } in viewport coords, or null when hidden
  const canvasRef = useRef(null);
  const boardScrollRef = useRef(null);
  const laneListRef = useRef(null);
  const saveTimer = useRef(null);
  const clipboardRef = useRef(null);

  // The lane-label column lives outside the horizontally-scrolling grid entirely (see the
  // render below) so it can't be affected by position:sticky failing in that nested
  // scroll context. Its vertical position is mirrored from the main scroll area directly
  // via a DOM mutation, not React state, so scrolling doesn't re-render the whole board.
  function syncLaneListScroll() {
    if (laneListRef.current && boardScrollRef.current) {
      laneListRef.current.style.transform = `translateY(-${boardScrollRef.current.scrollTop}px)`;
    }
  }

  // Routes a discrete content edit (placing/moving/resizing/deleting a block, lane or
  // dependency changes, text style, project dates, import/reset) through undo history.
  // Continuous view-only changes -- the zoom slider, typing the project name, "Fit to
  // project" -- call setBoard directly instead, so undo stays about content, not every
  // pixel of a drag or keystroke.
  function commitBoard(updater) {
    setBoard((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      if (next !== current) setHistory((h) => recordHistory(h, current));
      return next;
    });
  }
  function handleUndo() {
    setHistory((h) => {
      const result = undoHistory(h, board);
      if (result.board !== board) setBoard(result.board);
      return result.history;
    });
  }
  function handleRedo() {
    setHistory((h) => {
      const result = redoHistory(h, board);
      if (result.board !== board) setBoard(result.board);
      return result.history;
    });
  }

  useEffect(() => {
    const stored = loadStoredBoard(projectId);
    if (stored) setBoard(stored);
    setPaletteCollapsed(loadPaletteCollapsed());
  }, [projectId]);

  function togglePaletteCollapsed() {
    setPaletteCollapsed((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        try { window.localStorage.setItem(PALETTE_COLLAPSE_STORAGE_KEY, String(next)); } catch {}
      }
      return next;
    });
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSaveStatus("Saving…");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        // updatedAt reflects when the persisted copy actually changed (what the Projects
        // list shows as "Last Modified"), not every in-memory edit -- bumped only here,
        // right before the write, rather than kept in sync on `board` itself.
        const toSave = { ...board, updatedAt: new Date().toISOString() };
        window.localStorage.setItem(projectStorageKey(board.id), serializeBoardState(toSave));
        setSaveStatus("Saved");
        setTimeout(() => setSaveStatus((current) => (current === "Saved" ? "" : current)), 1800);
      } catch {
        setSaveStatus("Save failed");
      }
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [board]);

  const weeks = useMemo(() => computeWeeks(board.startDate, board.endDate), [board.startDate, board.endDate]);
  const groupedChips = useMemo(() => chipsByCategory(board), [board]);
  const selectedBlock = selectedBlockIds.length === 1
    ? board.blocks.find((block) => block.id === selectedBlockIds[0]) || null : null;

  // Which real week indices actually render as columns. Hiding empty weeks compresses the
  // timeline (no gap columns for weeks nothing is scheduled in) without touching any
  // block's real startIdx -- that stays real-week-indexed everywhere in `board`.
  const rawVisibleIndices = useMemo(() => visibleWeekIndices(board, weeks.length), [board, weeks.length]);
  const displayIndices = useMemo(() => (
    hideEmptyWeeks && rawVisibleIndices.length > 0 ? rawVisibleIndices : weeks.map((_, i) => i)
  ), [hideEmptyWeeks, rawVisibleIndices, weeks]);
  const columnForWeekIdx = useMemo(() => new Map(displayIndices.map((real, compressed) => [real, compressed])), [displayIndices]);
  const resolveColumn = (realIdx) => columnForWeekIdx.get(realIdx) ?? realIdx;

  const arrowSegments = useMemo(() => board.dependencies
    .map((dependency) => ({ dependency, points: dependencyArrowPoints(board, dependency, board.weekWidth, resolveColumn) }))
    .filter((segment) => segment.points), [board, columnForWeekIdx]);

  // Simplified stand-in for real CPM (no calendars/constraints yet) -- longest chain of
  // dependency-linked blocks by summed duration, just to eyeball the dependency graph.
  const criticalPathInfo = useMemo(() => (showCriticalPath ? criticalPath(board) : null), [board, showCriticalPath]);
  const criticalBlockIds = useMemo(() => new Set(criticalPathInfo?.blockIds || []), [criticalPathInfo]);
  const criticalDependencyIds = useMemo(() => new Set(criticalPathInfo?.dependencyIds || []), [criticalPathInfo]);

  function pixelToRealWeekIdx(px) {
    const compressed = clampIndex(pixelToIndex(px, board.weekWidth), 0, displayIndices.length - 1);
    return displayIndices[compressed];
  }
  // Same idea but snapping to the nearest column (rounding) rather than the containing one
  // (flooring) -- used when a drag ends mid-column and should settle on the closest week.
  function roundedPixelToRealWeekIdx(px) {
    const compressed = clampIndex(Math.round(px / board.weekWidth), 0, displayIndices.length - 1);
    return displayIndices[compressed];
  }

  function handleFitToProject() {
    const availableWidth = (boardScrollRef.current?.clientWidth || 0) - LANE_LABEL_WIDTH_PX;
    setBoard((current) => ({ ...current, weekWidth: fitWeekWidthPx(availableWidth, displayIndices.length, 1) }));
  }

  function dropChipOnCanvas(event) {
    event.preventDefault();
    const raw = event.dataTransfer.getData("application/json");
    if (!raw) return;
    const chip = JSON.parse(raw);
    const rect = canvasRef.current.getBoundingClientRect();
    const weekIdx = pixelToRealWeekIdx(event.clientX - rect.left);
    const laneIdx = clampIndex(pixelToIndex(event.clientY - rect.top, ROW_HEIGHT_PX), 0, board.lanes.length - 1);
    commitBoard((current) => addBlock(current, chip, weekIdx, laneIdx));
  }

  function toggleMultiSelect(blockId) {
    setSelectedBlockIds((current) => (current.includes(blockId) ? current.filter((id) => id !== blockId) : [...current, blockId]));
  }

  function startMoveBlock(event, block) {
    if (["resize-handle", "resize-handle-start", "delete"].includes(event.target.dataset.role)) return;
    // Ctrl/Cmd+click never drags -- it's purely a multi-select toggle, so the click order
    // (what "Link in order" chains through) stays exactly what the user clicked.
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      toggleMultiSelect(block.id);
      return;
    }
    event.preventDefault();
    // Dragging a block that's already part of a multi-selection moves the whole group
    // together, preserving everyone's relative offset; dragging any other block is a plain
    // single-block move and (as before) collapses the selection down to just that block.
    const isGroupDrag = selectedBlockIds.length > 1 && selectedBlockIds.includes(block.id);
    const groupIds = isGroupDrag ? selectedBlockIds : [block.id];
    const groupOrigins = groupIds
      .map((id) => canvasRef.current?.querySelector(`[data-block-id="${id}"]`))
      .filter(Boolean)
      .map((el) => { el.classList.add("opacity-75", "z-20"); return { el, left: parseFloat(el.style.left), top: parseFloat(el.style.top) }; });
    const anchor = groupOrigins.find((origin) => origin.el.dataset.blockId === block.id) || groupOrigins[0];
    const startX = event.clientX, startY = event.clientY;
    const scrollEl = boardScrollRef.current;
    const initialScrollLeft = scrollEl?.scrollLeft || 0;
    let lastDx = 0, lastDy = 0;
    let autoScrollDirection = 0;
    let autoScrollStartedAt = 0;
    let autoScrollFrame = null;

    // Canvas-relative movement = raw mouse delta plus however far auto-scroll has since
    // shifted the content -- without adding scrollDelta back in, the dragged block would
    // visually lag behind while the timeline scrolls out from under a stationary cursor.
    function applyPositions() {
      const scrollDelta = (scrollEl?.scrollLeft || 0) - initialScrollLeft;
      for (const origin of groupOrigins) {
        origin.el.style.left = `${origin.left + lastDx + scrollDelta}px`;
        origin.el.style.top = `${origin.top + lastDy}px`;
      }
    }
    function stepAutoScroll(now) {
      if (autoScrollDirection === 0 || !scrollEl) { autoScrollFrame = null; return; }
      // Slow to start, ramping up to full speed after ~2s of continuous edge-holding.
      const speed = now - autoScrollStartedAt < 2000 ? 3 : 14;
      scrollEl.scrollLeft += autoScrollDirection * speed;
      applyPositions();
      autoScrollFrame = requestAnimationFrame(stepAutoScroll);
    }
    function updateAutoScrollDirection(clientX) {
      if (!scrollEl) return;
      const rect = scrollEl.getBoundingClientRect();
      const EDGE_ZONE_PX = 48;
      let direction = 0;
      if (clientX < rect.left + EDGE_ZONE_PX) direction = -1;
      else if (clientX > rect.right - EDGE_ZONE_PX) direction = 1;
      if (direction === autoScrollDirection) return;
      autoScrollDirection = direction;
      autoScrollStartedAt = performance.now();
      if (direction !== 0 && autoScrollFrame === null) autoScrollFrame = requestAnimationFrame(stepAutoScroll);
    }
    function onMove(ev) {
      lastDx = ev.clientX - startX;
      lastDy = ev.clientY - startY;
      applyPositions();
      updateAutoScrollDirection(ev.clientX);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (autoScrollFrame !== null) cancelAnimationFrame(autoScrollFrame);
      for (const origin of groupOrigins) origin.el.classList.remove("opacity-75", "z-20");
      const scrollDelta = (scrollEl?.scrollLeft || 0) - initialScrollLeft;
      const totalDx = lastDx + scrollDelta;
      const anchorWeekIdx = roundedPixelToRealWeekIdx(anchor.left + totalDx);
      const anchorLaneIdx = clampIndex(Math.round((anchor.top + lastDy) / ROW_HEIGHT_PX), 0, board.lanes.length - 1);
      if (isGroupDrag) {
        const weekDelta = anchorWeekIdx - block.startIdx;
        const laneDelta = anchorLaneIdx - laneIndexOf(board, block.laneId);
        commitBoard((current) => moveBlocksBy(current, groupIds, weekDelta, laneDelta));
      } else {
        commitBoard((current) => moveBlock(current, block.id, anchorWeekIdx, anchorLaneIdx));
        setSelectedBlockIds([block.id]);
      }
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function handleLinkSelectedInOrder() {
    if (selectedBlockIds.length < 2) return;
    commitBoard((current) => linkBlocksInOrder(current, selectedBlockIds));
    setSelectedBlockIds([]);
  }

  function flashClipboardStatus(text) {
    setClipboardStatus(text);
    setTimeout(() => setClipboardStatus((current) => (current === text ? "" : current)), 1200);
  }
  function copyBlockToClipboard(block) {
    clipboardRef.current = { chip: blockToChip(block), laneId: block.laneId, nextStartIdx: block.startIdx + Math.max(1, block.duration) };
    setSelectedBlockIds([block.id]);
    flashClipboardStatus("Copied");
  }
  // Right-clicking a block that's part of the current multi-selection opens a menu for
  // the whole group (currently just "Link activities"); right-clicking any other block
  // keeps the plain single-block copy behavior, same as before multi-select existed.
  function handleBlockContextMenu(event, block) {
    if (selectedBlockIds.length > 1 && selectedBlockIds.includes(block.id)) {
      setContextMenu({ x: event.clientX, y: event.clientY });
    } else {
      copyBlockToClipboard(block);
    }
  }
  function pasteFromClipboard() {
    const clip = clipboardRef.current;
    if (!clip) return;
    const laneIdx = laneIndexOf(board, clip.laneId);
    if (laneIdx < 0) return;
    commitBoard((current) => addBlock(current, clip.chip, clip.nextStartIdx, laneIdx));
    clipboardRef.current = { ...clip, nextStartIdx: clip.nextStartIdx + Math.max(1, clip.chip.durationWeeks) };
    flashClipboardStatus("Pasted");
  }

  useEffect(() => {
    function onKeyDown(event) {
      if (!(event.ctrlKey || event.metaKey) || isTypingTarget(document.activeElement)) return;
      if (event.key === "z" || event.key === "Z") {
        event.preventDefault();
        if (event.shiftKey) handleRedo(); else handleUndo();
      } else if (event.key === "y" || event.key === "Y") {
        event.preventDefault();
        handleRedo();
      } else if (event.key === "c" || event.key === "C") {
        if (selectedBlockIds.length !== 1) return; // ambiguous with a multi-selection -- use the Link button instead
        const block = board.blocks.find((b) => b.id === selectedBlockIds[0]);
        if (block) { event.preventDefault(); copyBlockToClipboard(block); }
      } else if (event.key === "v" || event.key === "V") {
        if (clipboardRef.current) { event.preventDefault(); pasteFromClipboard(); }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [board, selectedBlockIds, history]);

  function startResizeBlock(event, block) {
    event.preventDefault();
    event.stopPropagation();
    const el = event.currentTarget.parentElement;
    const startX = event.clientX;
    const origDuration = block.duration;
    function onMove(ev) {
      const proposed = Math.max(1, origDuration + Math.round((ev.clientX - startX) / board.weekWidth));
      el.style.width = `${proposed * board.weekWidth - 4}px`;
    }
    function onUp(ev) {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const proposed = Math.max(1, origDuration + Math.round((ev.clientX - startX) / board.weekWidth));
      commitBoard((current) => resizeBlock(current, block.id, proposed));
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // Left-edge resize: the finish week stays put, the start moves -- mirrors
  // startResizeBlock but grows/shrinks from the other end (see resizeBlockFromStart).
  function startResizeBlockFromStart(event, block) {
    event.preventDefault();
    event.stopPropagation();
    const el = event.currentTarget.parentElement;
    const startX = event.clientX;
    const origLeft = parseFloat(el.style.left);
    const origWidth = parseFloat(el.style.width);
    const origDuration = block.duration;
    function onMove(ev) {
      const deltaColumns = Math.round((ev.clientX - startX) / board.weekWidth);
      const proposedDuration = Math.max(1, origDuration - deltaColumns);
      const widthDelta = (origDuration - proposedDuration) * board.weekWidth;
      el.style.left = `${origLeft + widthDelta}px`;
      el.style.width = `${origWidth - widthDelta}px`;
    }
    function onUp(ev) {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const deltaColumns = Math.round((ev.clientX - startX) / board.weekWidth);
      commitBoard((current) => resizeBlockFromStart(current, block.id, block.startIdx + deltaColumns));
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function handleAddLane() {
    const name = window.prompt("New lane name", "New Lane");
    if (name) commitBoard((current) => addLane(current, name));
  }
  function handleInsertLaneBefore(lane) {
    const name = window.prompt(`New lane name (inserted above "${lane.name}")`, "New Lane");
    if (name) commitBoard((current) => addLane(current, name, laneIndexOf(current, lane.id)));
  }
  function handleRenameLane(lane) {
    const name = window.prompt("Rename lane", lane.name);
    if (name) commitBoard((current) => renameLane(current, lane.id, name));
  }
  function handleDeleteLane(lane) {
    if (window.confirm(`Delete lane "${lane.name}" and any blocks placed on it?`)) {
      const removedIds = new Set(board.blocks.filter((block) => block.laneId === lane.id).map((block) => block.id));
      commitBoard((current) => deleteLane(current, lane.id));
      setSelectedBlockIds((current) => current.filter((id) => !removedIds.has(id)));
    }
  }
  function handleRemoveBlock(block) {
    commitBoard((current) => removeBlock(current, block.id));
    setSelectedBlockIds((current) => current.filter((id) => id !== block.id));
  }
  function handleRenameBlock(block) {
    const label = window.prompt("Rename block", block.label);
    if (label) commitBoard((current) => renameBlock(current, block.id, label));
  }
  function handleApplyDates(event) {
    const form = new FormData(event.currentTarget);
    const next = setProjectDates(board, form.get("startDate"), form.get("endDate"));
    if (next === board) window.alert("End date must be after start date.");
    commitBoard(next);
  }
  function handleAddCustomChip() {
    if (!customChipDraft.label.trim()) { window.alert("Enter a label for the block."); return; }
    commitBoard((current) => addCustomChip(current, customChipDraft));
    setCustomChipDraft((current) => ({ ...current, label: "" }));
  }
  function handleExport() {
    const blob = new Blob([serializeBoardState(board)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(board.projectName || "schedule").replace(/[^a-z0-9-_]+/gi, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function handleImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        commitBoard(deserializeBoardState(reader.result));
      } catch {
        window.alert("That file could not be read as a schedule JSON export.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }
  function handleReset() {
    if (window.confirm("Reset the board? This clears all placed blocks, lanes, and custom chips.")) {
      commitBoard(defaultBoardState());
    }
  }

  return (
    <section className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-scheduling-board>
      <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 bg-slate-950 px-4 py-3 text-white">
        <div className="mr-2"><h1 className="text-base font-black">Gantt Chart</h1><span className="font-mono text-[11px] text-slate-400">drag-and-drop timeline</span></div>
        <Field label="Project"><input value={board.projectName} onChange={(e) => setBoard((c) => ({ ...c, projectName: e.target.value }))}
          className="min-w-[180px] rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-white" /></Field>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); handleApplyDates(e); }}>
          <Field label="Start date"><input name="startDate" type="date" defaultValue={board.startDate}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 font-mono text-xs text-white" /></Field>
          <Field label="End date"><input name="endDate" type="date" defaultValue={board.endDate}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 font-mono text-xs text-white" /></Field>
          <button type="submit" className="rounded bg-amber-500 px-3 py-1.5 text-sm font-bold text-slate-950">Apply dates</button>
        </form>
        <Field label="Zoom"><input type="range" min={MIN_ZOOM_PX} max={MAX_ZOOM_PX} value={board.weekWidth}
          onChange={(e) => setBoard((c) => ({ ...c, weekWidth: Number(e.target.value) }))} /></Field>
        <Field label="Project view">
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleFitToProject}
              className="rounded border border-slate-700 px-2.5 py-1 text-xs font-bold" title="Shrink the board so the whole project fits on screen">
              Fit to project
            </button>
            <label className="flex items-center gap-1 text-xs text-slate-300">
              <input type="checkbox" checked={hideEmptyWeeks} onChange={(e) => setHideEmptyWeeks(e.target.checked)} />
              Hide empty weeks
            </label>
            <label className="flex items-center gap-1 text-xs text-slate-300" title="Longest dependency-linked chain by duration -- a stand-in for real CPM, not tied to calendars/constraints yet">
              <input type="checkbox" checked={showCriticalPath} onChange={(e) => setShowCriticalPath(e.target.checked)} />
              Critical path
            </label>
          </div>
        </Field>
        <TextStyleToolbar
          disabled={selectedBlockIds.length === 0}
          activeBlock={selectedBlockIds.length ? board.blocks.find((block) => block.id === selectedBlockIds[0]) : null}
          onChange={(patch) => selectedBlockIds.length && commitBoard((current) => setBlockTextStyle(current, selectedBlockIds, patch))} />
        <div className="flex-1" />
        <span role="status" className="min-w-[60px] font-mono text-xs text-sky-400">{clipboardStatus}</span>
        <span role="status" className="min-w-[70px] font-mono text-xs text-emerald-400">{saveStatus}</span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={handleUndo} disabled={history.past.length === 0} title="Undo (Ctrl+Z)"
            className="rounded border border-slate-700 px-3 py-1.5 text-sm font-bold disabled:opacity-40">Undo</button>
          <button type="button" onClick={handleRedo} disabled={history.future.length === 0} title="Redo (Ctrl+Shift+Z)"
            className="rounded border border-slate-700 px-3 py-1.5 text-sm font-bold disabled:opacity-40">Redo</button>
        </div>
        <button type="button" onClick={handleExport} className="rounded border border-slate-700 px-3 py-1.5 text-sm font-bold">Export JSON</button>
        <label className="cursor-pointer rounded border border-slate-700 px-3 py-1.5 text-sm font-bold">
          Import JSON<input type="file" accept="application/json" className="hidden" onChange={handleImport} />
        </label>
        <details className="relative" data-scheduling-menu>
          <summary className="cursor-pointer list-none rounded border border-slate-700 px-3 py-1.5 text-sm font-bold">Menu</summary>
          <div className="absolute left-0 z-50 mt-2 w-48 rounded-xl border border-slate-200 bg-white p-2 text-slate-950 shadow-xl">
            <Link href="/forge/scheduling" className="block rounded-lg px-3 py-2 text-left text-sm font-bold hover:bg-slate-100">All Projects</Link>
          </div>
        </details>
        <button type="button" onClick={() => setShowHelp(true)} title="Help & keyboard shortcuts"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-700 text-sm font-black hover:bg-slate-800">?</button>
        <button type="button" onClick={handleReset} className="rounded border border-red-800 bg-red-950 px-3 py-1.5 text-sm font-bold">Reset board</button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-500">Starter objects — drag onto the board</h2>
            <button type="button" onClick={togglePaletteCollapsed} aria-expanded={!paletteCollapsed}
              className="shrink-0 text-xs font-bold text-slate-400 hover:text-slate-700">
              {paletteCollapsed ? "Show" : "Hide"}
            </button>
          </div>
          {!paletteCollapsed && Object.keys(CATEGORY_NAMES).map((category) => (
            <details key={category} open className="mb-1.5 overflow-hidden rounded-lg">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg bg-slate-200 px-2.5 py-2 text-xs font-bold">
                <span className="inline-block h-2.5 w-2.5 rotate-45 rounded-sm" style={{ background: colorForCategory(category) }} />
                {CATEGORY_NAMES[category]}
              </summary>
              <div className="flex flex-col gap-1.5 bg-slate-100 p-2">
                {groupedChips[category].map((chip) => (
                  <div key={chip.label} draggable
                    onDragStart={(e) => { e.dataTransfer.setData("application/json", JSON.stringify(chip)); e.dataTransfer.effectAllowed = "copy"; }}
                    className="flex cursor-grab items-center gap-1.5 rounded px-2 py-1.5 text-xs font-bold text-slate-950"
                    style={{ background: colorForCategory(category) }}>
                    {chip.milestone && <span className="h-2 w-2 rotate-45 rounded-sm bg-black/35" />}
                    <span>{chip.label}</span>
                  </div>
                ))}
              </div>
            </details>
          ))}

          <button type="button" onClick={handleAddLane} className="mt-3 w-full rounded-lg bg-slate-950 px-3 py-2 text-sm font-bold text-white">+ Add lane</button>

          <div className="mt-4 flex flex-col gap-2 rounded-lg bg-slate-200 p-3">
            <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Add a custom block to the palette</label>
            <input value={customChipDraft.label} onChange={(e) => setCustomChipDraft((c) => ({ ...c, label: e.target.value }))}
              placeholder="Block label" className="rounded border border-slate-300 px-2 py-1.5 text-xs" />
            <div className="flex items-center gap-1.5">
              <select value={customChipDraft.category} onChange={(e) => setCustomChipDraft((c) => ({ ...c, category: e.target.value }))}
                className="rounded border border-slate-300 px-2 py-1.5 text-xs">
                {Object.entries(CATEGORY_NAMES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
              </select>
              <input type="number" min={0} max={52} value={customChipDraft.durationWeeks} title="Default duration (weeks)"
                onChange={(e) => setCustomChipDraft((c) => ({ ...c, durationWeeks: Number(e.target.value) }))}
                className="w-14 rounded border border-slate-300 px-2 py-1.5 text-xs" />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={customChipDraft.milestone} onChange={(e) => setCustomChipDraft((c) => ({ ...c, milestone: e.target.checked }))} />
              Milestone (0-duration)
            </label>
            <button type="button" onClick={handleAddCustomChip} className="rounded bg-slate-950 px-3 py-2 text-xs font-bold text-white">Add to palette</button>
          </div>
        </div>

        {/* Frozen lane-label column: a real sibling outside the horizontally-scrolling grid,
            not a sticky item inside it. position:sticky on a grid item is confined to its own
            grid track's width (170px here) -- once scrollLeft passes that, there's no room
            left for it to "stick" within and it scrolls away with everything else. Living
            outside the scroller entirely sidesteps that limit rather than fighting it. */}
        <div className="flex shrink-0 flex-col border-r border-slate-300" style={{ width: LANE_LABEL_WIDTH_PX }}>
          <div style={{ height: 40 }} className="shrink-0 border-b border-slate-800 bg-slate-950" />
          <div className="flex-1 overflow-hidden">
            <div ref={laneListRef}>
              {board.lanes.map((lane) => (
                <div key={lane.id} style={{ height: ROW_HEIGHT_PX }} className="flex items-center justify-between border-b border-slate-300 bg-slate-200 px-2.5 text-xs font-bold">
                  <span onDoubleClick={() => handleRenameLane(lane)} title="Double-click to rename">{lane.name}</span>
                  <span className="flex items-center gap-1">
                    <span onClick={() => handleInsertLaneBefore(lane)} title="Insert lane above" className="cursor-pointer px-1 text-slate-400 hover:text-emerald-600">+</span>
                    <span onClick={() => handleDeleteLane(lane)} title="Delete lane" className="cursor-pointer px-1 text-slate-400 hover:text-red-600">✕</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div ref={boardScrollRef} className="flex-1 overflow-auto bg-slate-100" onScroll={syncLaneListScroll}>
          <div style={{ display: "grid", gridTemplateColumns: `${displayIndices.map(() => `${board.weekWidth}px`).join(" ")}`, gridTemplateRows: `40px ${board.lanes.map(() => `${ROW_HEIGHT_PX}px`).join(" ")}` }}>
            {displayIndices.map((realIdx) => (
              <div key={weeks[realIdx]} className="sticky top-0 z-30 flex items-center justify-center border-r border-b border-slate-800 bg-slate-950 font-mono text-[10.5px] text-slate-300">
                {formatWeek(weeks[realIdx])}
              </div>
            ))}
            <div ref={canvasRef} data-scheduling-canvas
              style={{
                gridRow: `2 / span ${board.lanes.length}`, gridColumn: `1 / span ${displayIndices.length}`,
                width: displayIndices.length * board.weekWidth, height: board.lanes.length * ROW_HEIGHT_PX,
                backgroundImage: `repeating-linear-gradient(to right, #cbd5e1 0, #cbd5e1 1px, transparent 1px, transparent ${board.weekWidth}px), repeating-linear-gradient(to bottom, #cbd5e1 0, #cbd5e1 1px, transparent 1px, transparent ${ROW_HEIGHT_PX}px)`,
              }}
              className="relative"
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
              onDrop={dropChipOnCanvas}
              onClick={(e) => { if (e.target === e.currentTarget) setSelectedBlockIds([]); }}>
              {board.blocks.length === 0 && (
                <div className="pointer-events-none absolute top-3 left-3 rounded bg-white/85 px-2.5 py-1.5 text-xs text-slate-500">
                  Drag a block from the left panel onto the grid to place it.
                </div>
              )}
              <svg className="pointer-events-none absolute inset-0" width={displayIndices.length * board.weekWidth} height={board.lanes.length * ROW_HEIGHT_PX}>
                <defs>
                  <marker id="scheduling-dependency-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill="#64748b" />
                  </marker>
                  <marker id="scheduling-dependency-arrow-critical" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill="#dc2626" />
                  </marker>
                </defs>
                {arrowSegments.map(({ dependency, points }) => {
                  const isCritical = criticalDependencyIds.has(dependency.id);
                  return (
                    <line key={dependency.id} x1={points.x1} y1={points.y1} x2={points.x2} y2={points.y2}
                      stroke={isCritical ? "#dc2626" : "#64748b"} strokeWidth={isCritical ? "2.5" : "1.5"}
                      markerEnd={`url(#scheduling-dependency-arrow${isCritical ? "-critical" : ""})`} />
                  );
                })}
              </svg>
              {board.blocks.map((block) => {
                const selectionIndex = selectedBlockIds.indexOf(block.id);
                return (
                  <BlockElement key={block.id} block={block} weekWidth={board.weekWidth} laneIdx={laneIndexOf(board, block.laneId)}
                    startColumn={resolveColumn(block.startIdx)} onCriticalPath={criticalBlockIds.has(block.id)}
                    selected={selectionIndex !== -1} selectionOrder={selectedBlockIds.length > 1 && selectionIndex !== -1 ? selectionIndex + 1 : null}
                    onMouseDownMove={(e) => startMoveBlock(e, block)} onMouseDownResize={(e) => startResizeBlock(e, block)}
                    onMouseDownResizeStart={(e) => startResizeBlockFromStart(e, block)}
                    onRename={() => handleRenameBlock(block)} onDelete={() => handleRemoveBlock(block)}
                    onContextMenu={(event) => handleBlockContextMenu(event, block)} />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {selectedBlockIds.length > 1 && (
        <MultiSelectLinkBar board={board} selectedBlockIds={selectedBlockIds}
          onLink={handleLinkSelectedInOrder} onClear={() => setSelectedBlockIds([])} />
      )}
      {selectedBlock && (
        <DependencyDrawer board={board} block={selectedBlock} onClose={() => setSelectedBlockIds([])}
          onAddDependency={(predecessorId, successorId, relationshipType, lagDays) =>
            commitBoard((current) => addDependency(current, predecessorId, successorId, relationshipType, lagDays))}
          onRemoveDependency={(dependencyId) => commitBoard((current) => removeDependency(current, dependencyId))}
          onChangeDuration={(duration) => commitBoard((current) => resizeBlock(current, selectedBlock.id, duration))}
          onSelectBlock={(id) => setSelectedBlockIds([id])} />
      )}
      {showHelp && <SchedulingHelpModal onClose={() => setShowHelp(false)} />}
      {contextMenu && (
        <div className="fixed inset-0 z-[90]" onClick={() => setContextMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} data-scheduling-context-menu>
          <div style={{ left: contextMenu.x, top: contextMenu.y }} className="fixed z-[91] w-52 rounded-xl border border-slate-200 bg-white p-2 shadow-xl"
            onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => { handleLinkSelectedInOrder(); setContextMenu(null); }}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm font-bold text-slate-950 hover:bg-slate-100">
              Link activities ({selectedBlockIds.length})
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }) {
  return <div className="flex flex-col gap-0.5"><label className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</label>{children}</div>;
}

// Sits to the right of Zoom in the topbar. Dropdowns (not a full swatch grid or a size
// stepper) to keep it compact -- applies to every currently selected block at once.
function TextStyleToolbar({ disabled, activeBlock, onChange }) {
  const activeFontSize = activeBlock?.fontSize ?? "";
  const activeColor = activeBlock?.textColor ?? "";
  const activeBold = activeBlock?.bold ?? true;
  const selectClass = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white disabled:opacity-40";
  return (
    <Field label="Text">
      <div className="flex items-center gap-1.5">
        <select disabled={disabled} value={activeFontSize} title="Text size"
          onChange={(e) => onChange({ fontSize: e.target.value === "" ? null : Number(e.target.value) })} className={selectClass}>
          <option value="">Size…</option>
          {TEXT_SIZE_OPTIONS.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
        </select>
        <select disabled={disabled} value={activeColor} title="Text color"
          onChange={(e) => onChange({ textColor: e.target.value === "" ? null : e.target.value })} className={selectClass}>
          {TEXT_COLOR_OPTIONS.map((option) => <option key={option.label} value={option.value ?? ""}>{option.label}</option>)}
        </select>
        <button type="button" disabled={disabled} title="Toggle bold" aria-pressed={activeBold}
          onClick={() => onChange({ bold: !activeBold })}
          className={`rounded border px-2.5 py-1 text-xs font-black disabled:opacity-40 ${activeBold ? "border-amber-400 bg-amber-500 text-slate-950" : "border-slate-700 bg-slate-800 text-white"}`}>
          B
        </button>
      </div>
    </Field>
  );
}

function MultiSelectLinkBar({ board, selectedBlockIds, onLink, onClear }) {
  const blockById = (id) => board.blocks.find((candidate) => candidate.id === id);
  const chain = selectedBlockIds.map((id) => blockById(id)).filter(Boolean);
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-slate-200 bg-slate-50 px-4 py-2.5" data-scheduling-multi-select-bar>
      <span className="text-xs font-bold text-slate-600">{chain.length} blocks selected in order:</span>
      <span className="flex flex-wrap items-center gap-1 font-mono text-xs text-slate-500">
        {chain.map((block, index) => (
          <span key={block.id}>{block.taskCode}{index < chain.length - 1 ? " →" : ""}</span>
        ))}
      </span>
      <div className="flex-1" />
      <button type="button" onClick={onLink} className="rounded bg-slate-950 px-3 py-1.5 text-xs font-bold text-white">Link in order (FS)</button>
      <button type="button" onClick={onClear} className="text-xs font-bold text-slate-400 hover:text-slate-700">Clear selection</button>
    </div>
  );
}

function BlockElement({ block, weekWidth, laneIdx, startColumn, selected, selectionOrder, onCriticalPath, onMouseDownMove, onMouseDownResize, onMouseDownResizeStart, onRename, onDelete, onContextMenu }) {
  const selectedRing = selected ? "ring-2 ring-sky-500 ring-offset-1" : "";
  const criticalBorder = onCriticalPath ? "border-red-600" : "border-slate-900";
  function handleContextMenu(event) {
    event.preventDefault();
    onContextMenu(event);
  }
  if (block.milestone) {
    return (
      <div data-block-id={block.id} onMouseDown={onMouseDownMove} onContextMenu={handleContextMenu}
        className="group absolute flex cursor-grab items-center justify-center"
        style={{ left: startColumn * weekWidth, top: laneIdx * ROW_HEIGHT_PX, width: weekWidth, height: ROW_HEIGHT_PX }}>
        <div className={`h-5 w-5 rotate-45 rounded-[1px] border-2 ${criticalBorder} shadow ${selectedRing}`} style={{ background: MILESTONE_COLOR }} />
        <div onDoubleClick={onRename} className="absolute left-[26px] rounded bg-white/85 px-1 whitespace-nowrap"
          style={{ fontSize: `${block.fontSize || 11}px`, fontWeight: block.bold ? 700 : 400, color: block.textColor || "#1e293b" }}>
          <span className="mr-1 font-mono opacity-70">{block.taskCode}</span>{block.label}
        </div>
        {selectionOrder && <SelectionOrderBadge order={selectionOrder} />}
        <span data-role="delete" onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute -top-1.5 -right-1.5 hidden h-4 w-4 cursor-pointer rounded-full bg-slate-800 text-center text-[11px] leading-4 text-white group-hover:block">✕</span>
      </div>
    );
  }
  const barWidth = block.duration * weekWidth - 4;
  const barHeight = ROW_HEIGHT_PX - 10;
  const fontSize = fitBlockFontSizePx(block.label, barWidth, barHeight, block.fontSize);
  return (
    <div data-block-id={block.id} onMouseDown={onMouseDownMove} onContextMenu={handleContextMenu}
      className={`group absolute flex cursor-grab items-center rounded-md px-2 text-slate-950 shadow ${onCriticalPath ? "border-2 border-red-600" : "border border-black/15"} ${selectedRing}`}
      style={{ left: startColumn * weekWidth + 2, top: laneIdx * ROW_HEIGHT_PX + 5, width: barWidth, height: barHeight, background: colorForCategory(block.category) }}>
      {/* min-w-0 lets this flex child actually shrink below its unwrapped text width -- without it,
          flexbox's default min-width:auto keeps it at max-content size and text never wraps. */}
      <span onDoubleClick={onRename} className="min-w-0 break-words"
        style={{ fontSize: `${fontSize}px`, lineHeight: 1.15, fontWeight: block.bold ? 700 : 400, color: block.textColor || undefined }}>
        <span className="mr-1 font-mono opacity-60">{block.taskCode}</span>{block.label}
      </span>
      <div data-role="resize-handle-start" onMouseDown={onMouseDownResizeStart} className="absolute top-0 bottom-0 left-0 w-2.5 cursor-ew-resize" />
      <div data-role="resize-handle" onMouseDown={onMouseDownResize} className="absolute top-0 right-0 bottom-0 w-2.5 cursor-ew-resize" />
      {selectionOrder && <SelectionOrderBadge order={selectionOrder} />}
      <span data-role="delete" onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute -top-1.5 -right-1.5 hidden h-4 w-4 cursor-pointer rounded-full bg-slate-800 text-center text-[11px] leading-4 text-white group-hover:block">✕</span>
    </div>
  );
}

function SelectionOrderBadge({ order }) {
  return (
    <span className="absolute -top-1.5 -left-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-sky-600 text-[10px] font-black text-white">
      {order}
    </span>
  );
}

function DependencyDrawer({ board, block, onClose, onAddDependency, onRemoveDependency, onChangeDuration, onSelectBlock }) {
  const [direction, setDirection] = useState("predecessor");
  const [targetId, setTargetId] = useState("");
  const [relationshipType, setRelationshipType] = useState("FS");
  const [lagDays, setLagDays] = useState(0);
  const [durationDraft, setDurationDraft] = useState(String(block.duration));

  useEffect(() => setDurationDraft(String(block.duration)), [block.id, block.duration]);

  const { predecessors, successors } = dependenciesForBlock(board, block.id);
  const suggestions = suggestPredecessors(board, block.id);
  const successorSuggestions = suggestSuccessors(board, block.id);
  const blockById = (id) => board.blocks.find((candidate) => candidate.id === id);
  const excluded = new Set((direction === "predecessor" ? predecessors : successors)
    .map((dependency) => (direction === "predecessor" ? dependency.predecessorId : dependency.successorId)));
  const candidates = board.blocks.filter((candidate) => candidate.id !== block.id && !excluded.has(candidate.id));

  function handleAdd() {
    if (!targetId) return;
    if (direction === "predecessor") onAddDependency(targetId, block.id, relationshipType, Number(lagDays) || 0);
    else onAddDependency(block.id, targetId, relationshipType, Number(lagDays) || 0);
    setTargetId("");
  }

  function commitDuration() {
    const parsed = Math.max(1, Number(durationDraft) || 1);
    if (parsed !== block.duration) onChangeDuration(parsed);
    setDurationDraft(String(parsed));
  }

  return (
    <div className="max-h-64 shrink-0 overflow-y-auto border-t border-slate-200 bg-white p-4" data-scheduling-drawer>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-black"><span className="mr-2 font-mono text-slate-500">{block.taskCode}</span>{block.label}</h3>
          {block.milestone ? (
            <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">Milestone · 0 duration</span>
          ) : (
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
              Duration
              <input type="number" min={1} value={durationDraft} onChange={(e) => setDurationDraft(e.target.value)}
                onBlur={commitDuration}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitDuration(); e.currentTarget.blur(); } }}
                className="w-16 rounded border border-slate-300 px-2 py-1 text-xs" data-scheduling-duration-input />
              wk
            </label>
          )}
        </div>
        <button type="button" onClick={onClose} className="text-xs font-bold text-slate-400 hover:text-slate-700">Close ✕</button>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <DependencyList title="Predecessors" dependencies={predecessors} blockById={blockById} idField="predecessorId" onRemove={onRemoveDependency} onGoTo={onSelectBlock} />
        <DependencyList title="Successors" dependencies={successors} blockById={blockById} idField="successorId" onRemove={onRemoveDependency} onGoTo={onSelectBlock} />
      </div>
      {(suggestions.length > 0 || successorSuggestions.length > 0) && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {suggestions.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Suggested predecessors</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {suggestions.map((candidate) => (
                  <button key={candidate.id} type="button" onClick={() => onAddDependency(candidate.id, block.id, "FS", 0)}
                    className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800 hover:bg-emerald-100">
                    + {candidate.taskCode} {candidate.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {successorSuggestions.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Suggested successors</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {successorSuggestions.map((candidate) => (
                  <button key={candidate.id} type="button" onClick={() => onAddDependency(block.id, candidate.id, "FS", 0)}
                    className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800 hover:bg-emerald-100">
                    + {candidate.taskCode} {candidate.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2.5">
        <Field label="Add as">
          <select value={direction} onChange={(e) => setDirection(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-xs">
            <option value="predecessor">Predecessor of this</option>
            <option value="successor">Successor of this</option>
          </select>
        </Field>
        <Field label="Block">
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="min-w-[180px] rounded border border-slate-300 px-2 py-1.5 text-xs">
            <option value="">Select a block…</option>
            {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.taskCode} {candidate.label}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select value={relationshipType} onChange={(e) => setRelationshipType(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-xs">
            {RELATIONSHIP_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </Field>
        <Field label="Lag (days)">
          <input type="number" value={lagDays} onChange={(e) => setLagDays(e.target.value)} className="w-16 rounded border border-slate-300 px-2 py-1.5 text-xs" />
        </Field>
        <button type="button" onClick={handleAdd} disabled={!targetId} className="rounded bg-slate-950 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">Add link</button>
      </div>
    </div>
  );
}

function DependencyList({ title, dependencies, blockById, idField, onRemove, onGoTo }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{title}</p>
      {dependencies.length === 0 ? <p className="mt-1 text-xs text-slate-400">None yet.</p> : (
        <ul className="mt-1 flex flex-col gap-1">
          {dependencies.map((dependency) => {
            const linked = blockById(dependency[idField]);
            return (
              <li key={dependency.id} className="flex items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1 text-xs">
                {linked ? (
                  <button type="button" onClick={() => onGoTo(linked.id)} title="Go to this block" className="text-left hover:underline">
                    <span className="font-mono text-slate-500">{linked.taskCode}</span> {linked.label} · {dependency.relationshipType}{dependency.lagDays ? ` +${dependency.lagDays}d` : ""}
                  </button>
                ) : (
                  <span className="text-slate-400">Deleted block · {dependency.relationshipType}{dependency.lagDays ? ` +${dependency.lagDays}d` : ""}</span>
                )}
                <button type="button" onClick={() => onRemove(dependency.id)} title="Remove this relationship" className="font-bold text-slate-400 hover:text-red-600">✕</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
