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

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import PlanCanvas from "./PlanCanvas";
import { readSplitRatio, saveSplitRatio, clampSplitRatio } from "./splitViewLayout";

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
}) {
  const [ratio, setRatio] = useState(readSplitRatio);
  const containerRef = useRef(null);
  const draggingRef = useRef(false);

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
    <div ref={containerRef} className="relative flex h-full w-full" data-testid="designer-canvas-area">
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
        <DesignerViewport3D design={design} selection={selection} dispatch={dispatch} />
      </div>
    </div>
  );
}
