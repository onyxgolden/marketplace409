"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CATEGORY_NAMES, LANE_LABEL_WIDTH_PX, MAX_ZOOM_PX, MIN_ZOOM_PX, MILESTONE_COLOR, ROW_HEIGHT_PX,
  addBlock, addCustomChip, addLane, blockToChip, chipsByCategory, clampIndex, colorForCategory, computeWeeks,
  defaultBoardState, deserializeBoardState, deleteLane, laneIndexOf, moveBlock, pixelToIndex, removeBlock,
  renameBlock, renameLane, resizeBlock, serializeBoardState, setProjectDates,
} from "./schedulingBoardState";

function isTypingTarget(el) {
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

const STORAGE_KEY = "forge-scheduling-board-state";

function loadStoredBoard() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? deserializeBoardState(raw) : null;
  } catch {
    return null;
  }
}

function formatWeek(iso) {
  const [y, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export default function SchedulingBoard() {
  const [board, setBoard] = useState(defaultBoardState);
  const [saveStatus, setSaveStatus] = useState("");
  const [clipboardStatus, setClipboardStatus] = useState("");
  const [selectedBlockId, setSelectedBlockId] = useState(null);
  const [customChipDraft, setCustomChipDraft] = useState({ label: "", category: "gov", durationWeeks: 4, milestone: false });
  const canvasRef = useRef(null);
  const saveTimer = useRef(null);
  const clipboardRef = useRef(null);

  useEffect(() => {
    const stored = loadStoredBoard();
    if (stored) setBoard(stored);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSaveStatus("Saving…");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, serializeBoardState(board));
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

  function dropChipOnCanvas(event) {
    event.preventDefault();
    const raw = event.dataTransfer.getData("application/json");
    if (!raw) return;
    const chip = JSON.parse(raw);
    const rect = canvasRef.current.getBoundingClientRect();
    const weekIdx = clampIndex(pixelToIndex(event.clientX - rect.left, board.weekWidth), 0, weeks.length - 1);
    const laneIdx = clampIndex(pixelToIndex(event.clientY - rect.top, ROW_HEIGHT_PX), 0, board.lanes.length - 1);
    setBoard((current) => addBlock(current, chip, weekIdx, laneIdx));
  }

  function startMoveBlock(event, block) {
    if (event.target.dataset.role === "resize-handle" || event.target.dataset.role === "delete") return;
    event.preventDefault();
    const el = event.currentTarget;
    const startX = event.clientX, startY = event.clientY;
    const origLeft = parseFloat(el.style.left), origTop = parseFloat(el.style.top);
    el.classList.add("opacity-75", "z-20");
    function onMove(ev) {
      el.style.left = `${origLeft + (ev.clientX - startX)}px`;
      el.style.top = `${origTop + (ev.clientY - startY)}px`;
    }
    function onUp(ev) {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      el.classList.remove("opacity-75", "z-20");
      const weekIdx = clampIndex(Math.round((origLeft + (ev.clientX - startX)) / board.weekWidth), 0, weeks.length - 1);
      const laneIdx = clampIndex(Math.round((origTop + (ev.clientY - startY)) / ROW_HEIGHT_PX), 0, board.lanes.length - 1);
      setBoard((current) => moveBlock(current, block.id, weekIdx, laneIdx));
      setSelectedBlockId(block.id);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function flashClipboardStatus(text) {
    setClipboardStatus(text);
    setTimeout(() => setClipboardStatus((current) => (current === text ? "" : current)), 1200);
  }
  function copyBlockToClipboard(block) {
    clipboardRef.current = { chip: blockToChip(block), laneId: block.laneId, nextStartIdx: block.startIdx + Math.max(1, block.duration) };
    setSelectedBlockId(block.id);
    flashClipboardStatus("Copied");
  }
  function pasteFromClipboard() {
    const clip = clipboardRef.current;
    if (!clip) return;
    const laneIdx = laneIndexOf(board, clip.laneId);
    if (laneIdx < 0) return;
    setBoard((current) => addBlock(current, clip.chip, clip.nextStartIdx, laneIdx));
    clipboardRef.current = { ...clip, nextStartIdx: clip.nextStartIdx + Math.max(1, clip.chip.durationWeeks) };
    flashClipboardStatus("Pasted");
  }

  useEffect(() => {
    function onKeyDown(event) {
      if (!(event.ctrlKey || event.metaKey) || isTypingTarget(document.activeElement)) return;
      if (event.key === "c" || event.key === "C") {
        const block = board.blocks.find((b) => b.id === selectedBlockId);
        if (block) { event.preventDefault(); copyBlockToClipboard(block); }
      } else if (event.key === "v" || event.key === "V") {
        if (clipboardRef.current) { event.preventDefault(); pasteFromClipboard(); }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [board, selectedBlockId]);

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
      setBoard((current) => resizeBlock(current, block.id, proposed));
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function handleAddLane() {
    const name = window.prompt("New lane name", "New Lane");
    if (name) setBoard((current) => addLane(current, name));
  }
  function handleRenameLane(lane) {
    const name = window.prompt("Rename lane", lane.name);
    if (name) setBoard((current) => renameLane(current, lane.id, name));
  }
  function handleDeleteLane(lane) {
    if (window.confirm(`Delete lane "${lane.name}" and any blocks placed on it?`)) {
      setBoard((current) => deleteLane(current, lane.id));
    }
  }
  function handleRenameBlock(block) {
    const label = window.prompt("Rename block", block.label);
    if (label) setBoard((current) => renameBlock(current, block.id, label));
  }
  function handleApplyDates(event) {
    const form = new FormData(event.currentTarget);
    const next = setProjectDates(board, form.get("startDate"), form.get("endDate"));
    if (next === board) window.alert("End date must be after start date.");
    setBoard(next);
  }
  function handleAddCustomChip() {
    if (!customChipDraft.label.trim()) { window.alert("Enter a label for the block."); return; }
    setBoard((current) => addCustomChip(current, customChipDraft));
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
        setBoard(deserializeBoardState(reader.result));
      } catch {
        window.alert("That file could not be read as a schedule JSON export.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }
  function handleReset() {
    if (window.confirm("Reset the board? This clears all placed blocks, lanes, and custom chips.")) {
      setBoard(defaultBoardState());
    }
  }

  return (
    <section className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-scheduling-board>
      <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 bg-slate-950 px-4 py-3 text-white">
        <div className="mr-2"><h1 className="text-base font-black">Scheduling</h1><span className="font-mono text-[11px] text-slate-400">drag-and-drop timeline</span></div>
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
        <div className="flex-1" />
        <span role="status" className="min-w-[60px] font-mono text-xs text-sky-400">{clipboardStatus}</span>
        <span role="status" className="min-w-[70px] font-mono text-xs text-emerald-400">{saveStatus}</span>
        <button type="button" onClick={handleExport} className="rounded border border-slate-700 px-3 py-1.5 text-sm font-bold">Export JSON</button>
        <label className="cursor-pointer rounded border border-slate-700 px-3 py-1.5 text-sm font-bold">
          Import JSON<input type="file" accept="application/json" className="hidden" onChange={handleImport} />
        </label>
        <button type="button" onClick={handleReset} className="rounded border border-red-800 bg-red-950 px-3 py-1.5 text-sm font-bold">Reset board</button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-3">
          <h2 className="mb-2 px-1 text-xs font-black uppercase tracking-widest text-slate-500">Starter objects — drag onto the board</h2>
          {Object.keys(CATEGORY_NAMES).map((category) => (
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

        <div className="flex-1 overflow-auto bg-slate-100">
          <div style={{ display: "grid", gridTemplateColumns: `${LANE_LABEL_WIDTH_PX}px ${weeks.map(() => `${board.weekWidth}px`).join(" ")}`, gridTemplateRows: `40px ${board.lanes.map(() => `${ROW_HEIGHT_PX}px`).join(" ")}` }}>
            <div className="sticky top-0 left-0 z-[5] border-r border-b border-slate-800 bg-slate-950" />
            {weeks.map((week) => (
              <div key={week} className="sticky top-0 z-[4] flex items-center justify-center border-r border-b border-slate-800 bg-slate-950 font-mono text-[10.5px] text-slate-300">
                {formatWeek(week)}
              </div>
            ))}
            {board.lanes.map((lane) => (
              <div key={lane.id} style={{ gridColumn: 1 }} className="sticky left-0 z-[3] flex items-center justify-between border-r border-b border-slate-300 bg-slate-200 px-2.5 py-0 text-xs font-bold">
                <span onDoubleClick={() => handleRenameLane(lane)} title="Double-click to rename">{lane.name}</span>
                <span onClick={() => handleDeleteLane(lane)} title="Delete lane" className="cursor-pointer px-1 text-slate-400 hover:text-red-600">✕</span>
              </div>
            ))}
            <div ref={canvasRef} data-scheduling-canvas
              style={{
                gridRow: `2 / span ${board.lanes.length}`, gridColumn: `2 / span ${weeks.length}`,
                width: weeks.length * board.weekWidth, height: board.lanes.length * ROW_HEIGHT_PX,
                backgroundImage: `repeating-linear-gradient(to right, #cbd5e1 0, #cbd5e1 1px, transparent 1px, transparent ${board.weekWidth}px), repeating-linear-gradient(to bottom, #cbd5e1 0, #cbd5e1 1px, transparent 1px, transparent ${ROW_HEIGHT_PX}px)`,
              }}
              className="relative"
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
              onDrop={dropChipOnCanvas}
              onClick={(e) => { if (e.target === e.currentTarget) setSelectedBlockId(null); }}>
              {board.blocks.length === 0 && (
                <div className="pointer-events-none absolute top-3 left-3 rounded bg-white/85 px-2.5 py-1.5 text-xs text-slate-500">
                  Drag a block from the left panel onto the grid to place it.
                </div>
              )}
              {board.blocks.map((block) => (
                <BlockElement key={block.id} block={block} weekWidth={board.weekWidth} laneIdx={laneIndexOf(board, block.laneId)}
                  selected={block.id === selectedBlockId}
                  onMouseDownMove={(e) => startMoveBlock(e, block)} onMouseDownResize={(e) => startResizeBlock(e, block)}
                  onRename={() => handleRenameBlock(block)} onDelete={() => setBoard((current) => removeBlock(current, block.id))}
                  onCopy={() => copyBlockToClipboard(block)} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }) {
  return <div className="flex flex-col gap-0.5"><label className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</label>{children}</div>;
}

function BlockElement({ block, weekWidth, laneIdx, selected, onMouseDownMove, onMouseDownResize, onRename, onDelete, onCopy }) {
  const selectedRing = selected ? "ring-2 ring-sky-500 ring-offset-1" : "";
  function handleContextMenu(event) {
    event.preventDefault();
    onCopy();
  }
  if (block.milestone) {
    return (
      <div data-block-id={block.id} onMouseDown={onMouseDownMove} onContextMenu={handleContextMenu}
        className="group absolute flex cursor-grab items-center justify-center"
        style={{ left: block.startIdx * weekWidth, top: laneIdx * ROW_HEIGHT_PX, width: weekWidth, height: ROW_HEIGHT_PX }}>
        <div className={`h-5 w-5 rotate-45 rounded-[1px] border border-black/35 shadow ${selectedRing}`} style={{ background: MILESTONE_COLOR }} />
        <div onDoubleClick={onRename} className="absolute left-[26px] rounded bg-white/85 px-1 text-[11px] font-bold whitespace-nowrap text-slate-800">{block.label}</div>
        <span data-role="delete" onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute -top-1.5 -right-1.5 hidden h-4 w-4 cursor-pointer rounded-full bg-slate-800 text-center text-[11px] leading-4 text-white group-hover:block">✕</span>
      </div>
    );
  }
  return (
    <div data-block-id={block.id} onMouseDown={onMouseDownMove} onContextMenu={handleContextMenu}
      className={`group absolute flex cursor-grab items-center overflow-hidden rounded-md border border-black/15 px-2 text-[11.5px] font-bold whitespace-nowrap text-slate-950 shadow ${selectedRing}`}
      style={{ left: block.startIdx * weekWidth + 2, top: laneIdx * ROW_HEIGHT_PX + 5, width: block.duration * weekWidth - 4, height: ROW_HEIGHT_PX - 10, background: colorForCategory(block.category) }}>
      <span onDoubleClick={onRename} className="overflow-hidden text-ellipsis">{block.label}</span>
      <div data-role="resize-handle" onMouseDown={onMouseDownResize} className="absolute top-0 right-0 bottom-0 w-2.5 cursor-ew-resize" />
      <span data-role="delete" onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute -top-1.5 -right-1.5 hidden h-4 w-4 cursor-pointer rounded-full bg-slate-800 text-center text-[11px] leading-4 text-white group-hover:block">✕</span>
    </div>
  );
}
