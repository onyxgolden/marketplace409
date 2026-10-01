"use client";

/**
 * The canvas area for all three view modes: "2d", "3d", "split".
 *
 * Both PlanCanvas and DesignerViewport3D are ALWAYS mounted here, in every
 * mode — only their CSS visibility and width change. That is deliberate,
 * not an implementation detail: DesignerViewport3D owns an expensive-to-
 * recreate WebGL renderer/camera/controls, and switching 2D → Split → 3D
 * must never lose the user's orbit position or force a scene rebuild. The
 * only way to guarantee that with React is to never unmount it. The 2D
 * canvas's own pan/zoom state is kept alive by the same rule, for the same
 * reason (it is local component state, not reducer state).
 *
 * The split ratio (left pane's share of the width) is local UI state, not
 * design-document state — it persists per browser via splitViewLayout.js,
 * the same way the Designer already persists tool favorites and collapsed
 * categories.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Upload } from "lucide-react";
import PlanCanvas from "./PlanCanvas";
import { readSplitRatio, saveSplitRatio, clampSplitRatio } from "./splitViewLayout";
import { classifyDroppedFile } from "@/domains/roomDesigner/importers/dropRouter";

/** How long a drop refusal/unsupported-format notice stays on screen. */
const DROP_NOTICE_MS = 7000;

// Three.js pulls in a sizable, browser-only renderer; kept out of the SSR
// bundle exactly as it was before this component existed, just relocated
// here now that this is where DesignerViewport3D is actually mounted.
const DesignerViewport3D = dynamic(() => import("./DesignerViewport3D"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#0b1220] text-gray-400">
      Loading 3D view…
    </div>
  ),
});

export default function DesignerCanvasArea({
  view,
  design,
  tool,
  selection,
  multiSelection,
  calibration,
  pendingCatalogId,
  pendingRoomTemplate,
  pendingPipe,
  pendingSymbol,
  pendingCustomShape,
  orthoSnap,
  layerVisibility,
  dispatch,
  zoomRequest,
  onPlanCenterChange = null,
  onFloorCenterChange = null,
  onFileImport = null,
}) {
  const [ratio, setRatio] = useState(readSplitRatio);
  const containerRef = useRef(null);
  const draggingRef = useRef(false);
  const [dropActive, setDropActive] = useState(false);
  const [dropNotice, setDropNotice] = useState(null);
  const dragDepthRef = useRef(0);
  const noticeTimerRef = useRef(null);

  const showDropNotice = useCallback((notice) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setDropNotice(notice);
    noticeTimerRef.current = setTimeout(() => setDropNotice(null), DROP_NOTICE_MS);
  }, []);

  useEffect(() => () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
  }, []);

  const hasFiles = useCallback((e) => {
    const types = e.dataTransfer?.types;
    return !!types && Array.from(types).includes("Files");
  }, []);

  const onDragEnter = useCallback(
    (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setDropActive(true);
    },
    [hasFiles],
  );

  const onDragOver = useCallback(
    (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
    },
    [hasFiles],
  );

  const onDragLeave = useCallback((e) => {
    if (!hasFiles(e)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDropActive(false);
  }, [hasFiles]);

  const onDrop = useCallback(
    (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setDropActive(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const result = classifyDroppedFile(file.name);
      if (result.kind === "refused") {
        showDropNotice({ kind: "error", text: `${result.label}: ${result.message}` });
        return;
      }
      if (result.kind === "unknown") {
        showDropNotice({
          kind: "error",
          text: `Can't import ".${result.extension || "?"}" files. Supported: PDF, DXF, VSDX.`,
        });
        return;
      }
      onFileImport?.(file, result.kind);
    },
    [hasFiles, onFileImport, showDropNotice],
  );

  const show2d = view !== "3d";
  const show3d = view !== "2d";
  const isSplit = view === "split";

  const applyRatioFromClientX = useCallback((clientX) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    setRatio(clampSplitRatio((clientX - rect.left) / rect.width));
  }, []);

  const onDividerPointerDown = useCallback(
    (e) => {
      e.preventDefault();
      draggingRef.current = true;
      // Capture is best-effort: it can throw (a pointer id the browser
      // doesn't consider active, a device quirk) without the drag itself
      // being invalid, and that throw must never skip the ratio update
      // right after it — a silent no-op divider would be worse than a
      // divider that occasionally skips the capture optimization.
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // Dragging still works via document-level bubbling; capture just
        // makes it survive the pointer leaving the divider's own bounds.
      }
      applyRatioFromClientX(e.clientX);
    },
    [applyRatioFromClientX],
  );

  const onDividerPointerMove = useCallback(
    (e) => {
      if (!draggingRef.current) return;
      applyRatioFromClientX(e.clientX);
    },
    [applyRatioFromClientX],
  );

  const endDrag = useCallback(
    (e) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      // Same reasoning as the capture call: releasing can throw (e.g. a
      // pointer id the browser no longer considers captured) and that must
      // never skip the persist below it — this exact ordering bug shipped
      // once already (the release call threw, so the setRatio/save two
      // lines down silently never ran, and the divider position was lost
      // on every single drag) before this try/catch, caught only by
      // exercising the real drag end-to-end rather than trusting the code.
      try {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      } catch {
        // Not fatal: the drag already completed, only the capture cleanup failed.
      }
      // Persisted once, on release — not on every pointermove, so a drag
      // doesn't hammer localStorage.
      setRatio((current) => {
        saveSplitRatio(current);
        return current;
      });
    },
    [],
  );

  const onDividerKeyDown = useCallback((e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setRatio((r) => {
        const next = clampSplitRatio(r - step);
        saveSplitRatio(next);
        return next;
      });
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setRatio((r) => {
        const next = clampSplitRatio(r + step);
        saveSplitRatio(next);
        return next;
      });
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full"
      data-testid="designer-canvas-area"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dropActive && (
        <div
          data-testid="canvas-drop-affordance"
          className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-emerald-400 bg-gray-950/80 text-center"
        >
          <Upload className="text-emerald-300" size={28} />
          <p className="text-sm font-semibold text-white">Drop to import</p>
          <p className="text-xs text-gray-400">PDF, DXF, or VSDX</p>
        </div>
      )}
      {dropNotice && (
        <div
          data-testid="canvas-drop-notice"
          role="alert"
          className={`absolute left-1/2 top-3 z-40 max-w-md -translate-x-1/2 rounded px-3 py-2 text-xs shadow-lg ${
            dropNotice.kind === "error" ? "bg-red-900/90 text-red-100" : "bg-gray-900/90 text-gray-200"
          }`}
        >
          {dropNotice.text}
        </div>
      )}
      <div
        data-testid="canvas-pane-2d"
        className="relative h-full min-w-0"
        hidden={!show2d}
        style={{ width: isSplit ? `${ratio * 100}%` : "100%" }}
      >
        <PlanCanvas
          design={design}
          tool={tool}
          selection={selection}
          multiSelection={multiSelection}
          calibration={calibration}
          pendingCatalogId={pendingCatalogId}
          pendingRoomTemplate={pendingRoomTemplate}
          pendingPipe={pendingPipe}
          pendingSymbol={pendingSymbol}
          pendingCustomShape={pendingCustomShape}
          orthoSnap={orthoSnap}
          layerVisibility={layerVisibility}
          dispatch={dispatch}
          zoomRequest={zoomRequest}
          onViewCenterChange={onPlanCenterChange}
        />
      </div>

      {isSplit && (
        <div
          data-testid="split-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the 2D and 3D panes"
          tabIndex={0}
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onDividerKeyDown}
          className="relative z-10 w-1.5 shrink-0 cursor-col-resize touch-none bg-gray-800 hover:bg-emerald-600 focus:bg-emerald-600 focus:outline-none"
        />
      )}

      <div data-testid="canvas-pane-3d" className="relative h-full min-w-0 flex-1" hidden={!show3d}>
        <DesignerViewport3D
          design={design}
          selection={selection}
          multiSelection={multiSelection}
          dispatch={dispatch}
          onFloorCenterChange={onFloorCenterChange}
        />
      </div>
    </div>
  );
}
