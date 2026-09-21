"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCatalogEntry } from "@/domains/roomDesigner/furnitureCatalog";
import { findSymbol } from "@/domains/roomDesigner/symbolRegistry";
import {
  DEFAULT_GRID_IN,
  GRID_SPACING_OPTIONS,
  MAJOR_GRID_EVERY,
  dimensionGeometry,
  distancePointToSegment,
  feetInchesLabel,
  gridSpacingLabel,
  offsetAlongWall,
  rotatedFootprintCorners,
  rotatePoint,
  snapPoint,
  snapScalar,
  underlayContainsPoint,
  wallLength,
} from "@/domains/roomDesigner/designerGeometry";
import {
  applyOrthoSnap,
  longestPipeSegment,
  pipeRunLengthIn,
} from "@/domains/roomDesigner/pipingGeometry";
import { splitWallByOpenings } from "@/domains/roomDesigner/designerThreeModel";
import { renderSymbol2D, drawOrgChart } from "./symbolDrawRoutines";
import { ORG_CHART_METRICS, layoutOrgChart } from "@/domains/roomDesigner/orgChartLayout";
import {
  FURNITURE_MAX_SIZE_IN,
  FURNITURE_MIN_SIZE_IN,
  fitScaleLabel,
  pieceSize,
  sheetPlanBounds,
} from "@/domains/roomDesigner/designerDocument";
import { getSheetSize } from "@/domains/roomDesigner/sheetCatalog";

const MIN_SCALE = 0.35;
const MAX_SCALE = 12;
const HIT_TOLERANCE_PX = 10;

/**
 * SVG 2D floor-plan editor. All plan math is inches; the component maps
 * plan <-> screen with a pan/zoom transform kept in local state.
 */
export default function PlanCanvas({ design, tool, selection, multiSelection, calibration, pendingCatalogId, pendingRoomTemplate, pendingPipe, pendingSymbol, orthoSnap, layerVisibility, dispatch }) {
  const svgRef = useRef(null);
  const wrapRef = useRef(null);
  const [view, setView] = useState({ scale: 1.6, ox: 60, oy: 60 });
  const [drawPreview, setDrawPreview] = useState(null); // {kind: "wall"|"wall-rect", a, b} plan inches while drawing
  const [pipePreview, setPipePreview] = useState(null); // [points] plan inches while drawing a pipe run
  const [hoverPoint, setHoverPoint] = useState(null); // rubber-band cursor point for the pipe tool
  const [drag, setDrag] = useState(null); // active drag descriptor
  const [spaceDown, setSpaceDown] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });

  // Leaving the pipe tool abandons the in-progress run. React's sanctioned
  // "adjust state during render" pattern (no effect) so we don't set state
  // inside an effect body.
  const [prevTool, setPrevTool] = useState(tool);
  if (prevTool !== tool) {
    setPrevTool(tool);
    if (tool !== "pipe") {
      setPipePreview(null);
      setHoverPoint(null);
    }
  }

  // Discipline layers (Visio-style seed): pipes and piping symbols carry a
  // layer; hidden layers are skipped in rendering and hit-testing.
  const layerVisible = useCallback(
    (layer) => (layerVisibility || {})[layer] !== false,
    [layerVisibility],
  );

  // Track the visible canvas size so the rulers can track pan/zoom.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toScreen = useCallback(
    (p) => ({ x: view.ox + p.x * view.scale, y: view.oy + p.y * view.scale }),
    [view],
  );
  const toPlan = useCallback(
    (s) => ({ x: (s.x - view.ox) / view.scale, y: (s.y - view.oy) / view.scale }),
    [view],
  );

  const snapTargets = useMemo(() => {
    const pts = [];
    for (const w of design.walls) pts.push(w.a, w.b);
    return pts;
  }, [design.walls]);

  const snapTargetsExcluding = useCallback(
    (excludeIds) => snapTargets.filter((_, i) => !excludeIds.has(Math.floor(i / 2))),
    [snapTargets],
  );

  const eventPoint = useCallback(
    (e) => {
      const rect = svgRef.current.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    [],
  );

  // Visio-style grid: spacing comes from the design settings, snapping is
  // on unless the user turned it off. Documents saved before the toggle
  // existed get snap enabled via the `!== false` fallback.
  const gridIn = design.settings.gridIn > 0 ? design.settings.gridIn : DEFAULT_GRID_IN;
  const snapEnabled = design.settings.snapEnabled !== false;
  const snapOptions = useMemo(
    () => ({ gridIn, snapToGrid: snapEnabled }),
    [gridIn, snapEnabled],
  );

  // ---- hit testing (plan inches) ----
  // Point-in-rotated-rectangle test shared by furniture and symbol hits.
  const pointInFootprint = useCallback((plan, x, y, widthIn, depthIn, rotationDeg) => {
    const corners = rotatedFootprintCorners({ x, y, widthIn, depthIn, rotationDeg });
    for (let k = 0; k < 4; k += 1) {
      const p1 = corners[k];
      const p2 = corners[(k + 1) % 4];
      const cross = (p2.x - p1.x) * (plan.y - p1.y) - (p2.y - p1.y) * (plan.x - p1.x);
      if (cross < 0) return false;
    }
    return true;
  }, []);

  const hitTest = useCallback(
    (plan) => {
      const tolIn = HIT_TOLERANCE_PX / view.scale;
      // furniture first (topmost)
      for (let i = design.furniture.length - 1; i >= 0; i -= 1) {
        const f = design.furniture[i];
        const entry = getCatalogEntry(f.catalogId);
        if (!entry) continue;
        const { widthIn, depthIn } = pieceSize(f);
        if (pointInFootprint(plan, f.x, f.y, widthIn, depthIn, f.rotationDeg)) {
          return { kind: "furniture", id: f.id };
        }
      }
      // piping symbols (hidden layers are skipped)
      for (let i = (design.symbols || []).length - 1; i >= 0; i -= 1) {
        const s = design.symbols[i];
        if (!layerVisible(s.layer)) continue;
        const symbol = findSymbol(s.domain, s.symbolId);
        if (!symbol) continue;
        if (pointInFootprint(plan, s.x, s.y, symbol.widthIn, symbol.depthIn, s.rotationDeg)) {
          return { kind: "symbol", id: s.id };
        }
      }
      // pipe runs
      for (let i = (design.pipes || []).length - 1; i >= 0; i -= 1) {
        const run = design.pipes[i];
        if (!layerVisible(run.layer)) continue;
        const pts = run.points || [];
        for (let k = 1; k < pts.length; k += 1) {
          if (distancePointToSegment(plan, pts[k - 1], pts[k]) < tolIn + 4) {
            return { kind: "pipe", id: run.id };
          }
        }
      }
      // Phase 3: org charts — hit the laid-out bounding box. The anchor is
      // the top-center of the tree, so the box spans chart.x ± width/2.
      for (let i = (design.orgCharts || []).length - 1; i >= 0; i -= 1) {
        const chart = design.orgCharts[i];
        const layout = layoutOrgChart(chart.nodes);
        const w = Math.max(layout.widthIn, ORG_CHART_METRICS.boxWidthIn);
        const h = Math.max(layout.heightIn, ORG_CHART_METRICS.boxHeightIn);
        if (
          plan.x >= chart.x - w / 2 - tolIn &&
          plan.x <= chart.x + w / 2 + tolIn &&
          plan.y >= chart.y - tolIn &&
          plan.y <= chart.y + h + tolIn
        ) {
          return { kind: "orgchart", id: chart.id };
        }
      }
      // Printable sheets: hit the frame edges only (not the interior), so a
      // sheet covering the plan never swallows clicks meant for the content
      // inside it. Sheets sit below walls/openings in hit priority.
      for (let i = (design.sheets || []).length - 1; i >= 0; i -= 1) {
        const sheet = design.sheets[i];
        const b = sheetPlanBounds(sheet);
        const corners = [
          { x: b.x, y: b.y },
          { x: b.x + b.widthIn, y: b.y },
          { x: b.x + b.widthIn, y: b.y + b.heightIn },
          { x: b.x, y: b.y + b.heightIn },
        ];
        for (let k = 1; k <= 4; k += 1) {
          if (distancePointToSegment(plan, corners[k - 1], corners[k % 4]) < tolIn + 4) {
            return { kind: "sheet", id: sheet.id };
          }
        }
      }
      // openings (gaps on walls)
      for (const wall of design.walls) {
        for (const opening of design.openings.filter((o) => o.wallId === wall.id)) {
          const dir = { x: 0, y: 0 };
          const len = wallLength(wall);
          if (len > 0) {
            dir.x = (wall.b.x - wall.a.x) / len;
            dir.y = (wall.b.y - wall.a.y) / len;
          }
          const gp1 = { x: wall.a.x + dir.x * opening.offsetIn, y: wall.a.y + dir.y * opening.offsetIn };
          const gp2 = { x: wall.a.x + dir.x * (opening.offsetIn + opening.widthIn), y: wall.a.y + dir.y * (opening.offsetIn + opening.widthIn) };
          if (distancePointToSegment(plan, gp1, gp2) < tolIn + 6) {
            return { kind: "opening", id: opening.id };
          }
        }
      }
      // walls
      let best = null;
      let bestD = tolIn;
      for (const wall of design.walls) {
        const d = distancePointToSegment(plan, wall.a, wall.b);
        if (d < bestD) { bestD = d; best = wall; }
      }
      if (best) return { kind: "wall", id: best.id };
      // rooms
      for (let i = design.rooms.length - 1; i >= 0; i -= 1) {
        const room = design.rooms[i];
        if (distancePointToPolygonEdge(plan, room.polygon) < tolIn) {
          return { kind: "room", id: room.id };
        }
      }
      return null;
    },
    [design, view.scale, layerVisible, pointInFootprint],
  );

  // ---- pointer handlers ----
  // Commit the in-progress pipe run (double-click / Enter). Near-duplicate
  // consecutive vertices are collapsed by the document operation.
  const commitPipeRun = useCallback(() => {
    if (!pipePreview || pipePreview.length < 2) {
      setPipePreview(null);
      setHoverPoint(null);
      return;
    }
    try {
      dispatch({ type: "ADD_PIPE_RUN", points: pipePreview });
    } catch {
      // too short / invalid — drop it silently like short walls
    }
    setPipePreview(null);
    setHoverPoint(null);
  }, [pipePreview, dispatch]);

  const onPointerDown = (e) => {
    if (e.button === 1 || tool === "pan" || spaceDown) {
      setDrag({ kind: "pan", start: eventPoint(e), ox: view.ox, oy: view.oy });
      return;
    }
    if (e.button !== 0) return;
    const plan = toPlan(eventPoint(e));

    // Scale calibration: record raw clicks on the background image (no snapping).
    if (tool === "calibrate") {
      if (design.underlay) dispatch({ type: "ADD_CALIBRATION_POINT", point: plan });
      return;
    }
    if (tool === "wall") {
      const exclude = new Set();
      const { point } = snapPoint(plan, { ...snapOptions, snapTargets, snapRadiusIn: 9 });
      setDrag({ kind: "draw-wall", a: point, exclude });
      setDrawPreview({ kind: "wall", a: point, b: point });
      return;
    }
    if (tool === "wallrect") {
      const exclude = new Set();
      const { point } = snapPoint(plan, { ...snapOptions, snapTargets, snapRadiusIn: 9 });
      setDrag({ kind: "draw-wall-rect", a: point, exclude });
      setDrawPreview({ kind: "wall-rect", a: point, b: point });
      return;
    }
    if (tool === "room") {
      const { point } = snapPoint(plan, { ...snapOptions, snapRadiusIn: 9 });
      dispatch({ type: "ADD_ROOM", templateId: pendingRoomTemplate, at: point });
      return;
    }
    if (tool === "door" || tool === "window") {
      const tolIn = HIT_TOLERANCE_PX / view.scale + 6;
      let best = null;
      let bestD = tolIn;
      for (const wall of design.walls) {
        const d = distancePointToSegment(plan, wall.a, wall.b);
        if (d < bestD) { bestD = d; best = wall; }
      }
      if (best) {
        const rawOffset = offsetAlongWall(plan, best);
        dispatch({
          type: "ADD_OPENING",
          wallId: best.id,
          openingType: tool,
          // Visio-style: the opening's position along the wall rounds to
          // the grid when snapping is on.
          offsetIn: snapEnabled ? snapScalar(rawOffset, gridIn) : rawOffset,
        });
      }
      return;
    }
    if (tool === "furniture") {
      if (!pendingCatalogId) return;
      const { point } = snapPoint(plan, { ...snapOptions, snapRadiusIn: 9 });
      dispatch({ type: "PLACE_FURNITURE", catalogId: pendingCatalogId, x: point.x, y: point.y });
      return;
    }
    // Phase 2: piping mode — click to append polyline vertices (grid
    // snapped, then orthogonally locked to the previous vertex when the
    // ortho option is on). Double-click or Enter commits the run.
    if (tool === "pipe") {
      const { point } = snapPoint(plan, { ...snapOptions, snapRadiusIn: 9 });
      setPipePreview((prev) => {
        const next = prev ? [...prev] : [];
        const last = next[next.length - 1];
        const snapped = last && orthoSnap ? applyOrthoSnap(last, point) : point;
        return [...next, snapped];
      });
      return;
    }
    if (tool === "piping") {
      if (!pendingSymbol) return;
      const { point } = snapPoint(plan, { ...snapOptions, snapRadiusIn: 9 });
      dispatch({ type: "PLACE_SYMBOL", x: point.x, y: point.y });
      return;
    }
    // Phase 3: org chart — click to place a new chart (it starts with one
    // placeholder person; the panel edits people and reporting lines).
    if (tool === "orgchart") {
      const { point } = snapPoint(plan, { ...snapOptions, snapRadiusIn: 9 });
      dispatch({ type: "ADD_ORG_CHART", x: point.x, y: point.y });
      return;
    }
    if (tool === "erase") {
      const hit = hitTest(plan);
      if (hit) dispatch({ type: "DELETE_OBJECT", target: hit });
      return;
    }
    // select tool
    // shift-click toggles furniture in the multi-selection (Visio-style)
    if (e.shiftKey) {
      const hit = hitTest(plan);
      if (hit?.kind === "furniture") {
        dispatch({ type: "TOGGLE_MULTI_SELECT", target: hit });
      } else {
        dispatch({ type: "CLEAR_SELECTION" });
      }
      return;
    }
    // endpoint handles first
    if (selection?.kind === "wall") {
      const wall = design.walls.find((w) => w.id === selection.id);
      if (wall) {
        const tolIn = HIT_TOLERANCE_PX / view.scale;
        for (const end of ["a", "b"]) {
          if (Math.hypot(plan.x - wall[end].x, plan.y - wall[end].y) < tolIn) {
            const otherEnd = end === "a" ? wall.b : wall.a;
            setDrag({
              kind: "wall-endpoint", wallId: wall.id, end,
              exclude: new Set([design.walls.indexOf(wall)]),
              fixed: otherEnd,
            });
            return;
          }
        }
      }
    }
    // corner resize handles on the selected furniture piece (centered resize)
    if (selection?.kind === "furniture") {
      const piece = design.furniture.find((f) => f.id === selection.id);
      if (piece) {
        const { widthIn, depthIn } = pieceSize(piece);
        const corners = rotatedFootprintCorners({
          x: piece.x, y: piece.y, widthIn, depthIn, rotationDeg: piece.rotationDeg,
        });
        const tolIn = HIT_TOLERANCE_PX / view.scale;
        if (corners.some((c) => Math.hypot(plan.x - c.x, plan.y - c.y) < tolIn)) {
          setDrag({ kind: "resize-furniture", id: piece.id });
          return;
        }
      }
    }
    const hit = hitTest(plan);
    if (hit?.kind === "furniture") {
      dispatch({ type: "SELECT", selection: hit });
      setDrag({ kind: "move-furniture", id: hit.id, moved: false });
      return;
    }
    // Phase 2: piping symbol — click to select, drag to move.
    if (hit?.kind === "symbol") {
      dispatch({ type: "SELECT", selection: hit });
      setDrag({ kind: "move-symbol", id: hit.id, moved: false });
      return;
    }
    // Phase 3: org chart — click to select, drag to move the whole diagram.
    if (hit?.kind === "orgchart") {
      dispatch({ type: "SELECT", selection: hit });
      setDrag({ kind: "move-orgchart", id: hit.id, moved: false });
      return;
    }
    // Printable sheet — click to select, drag the frame edges to reposition.
    if (hit?.kind === "sheet") {
      const sheet = (design.sheets || []).find((s) => s.id === hit.id);
      dispatch({ type: "SELECT", selection: hit });
      if (sheet) {
        setDrag({ kind: "move-sheet", id: hit.id, dx: plan.x - sheet.x, dy: plan.y - sheet.y });
      }
      return;
    }
    // Phase 2: pipe vertex handles — drag a vertex of the selected run.
    if (selection?.kind === "pipe") {
      const run = (design.pipes || []).find((p) => p.id === selection.id);
      if (run) {
        const tolIn = HIT_TOLERANCE_PX / view.scale + 2;
        const index = (run.points || []).findIndex(
          (v) => Math.hypot(plan.x - v.x, plan.y - v.y) < tolIn,
        );
        if (index >= 0) {
          setDrag({ kind: "move-pipe-vertex", pipeId: run.id, index });
          return;
        }
      }
    }
    // Background underlay: drag to reposition when unlocked. The image sits
    // beneath everything, so plan objects take precedence in hit-testing.
    if (design.underlay && !design.underlay.locked && underlayContainsPoint(design.underlay, plan)) {
      dispatch({ type: "SELECT", selection: null });
      setDrag({
        kind: "move-underlay",
        dx: plan.x - design.underlay.x,
        dy: plan.y - design.underlay.y,
      });
      return;
    }
    dispatch({ type: "SELECT", selection: hit });
  };

  const onPointerMove = (e) => {
    const screen = eventPoint(e);
    // Pipe tool rubber band: track the cursor even without a drag so the
    // in-progress run previews the next segment and its length.
    if (tool === "pipe" && !drag) {
      const plan = toPlan(screen);
      const { point } = snapPoint(plan, { ...snapOptions, snapRadiusIn: 9 });
      const last = pipePreview?.[pipePreview.length - 1];
      setHoverPoint(last && orthoSnap ? applyOrthoSnap(last, point) : point);
      return;
    }
    if (!drag) return;
    if (drag.kind === "pan") {
      setView((v) => ({ ...v, ox: drag.ox + (screen.x - drag.start.x), oy: drag.oy + (screen.y - drag.start.y) }));
      return;
    }
    const plan = toPlan(screen);
    if (drag.kind === "draw-wall") {
      const { point } = snapPoint(plan, {
        ...snapOptions,
        snapTargets: snapTargetsExcluding(drag.exclude),
        snapRadiusIn: 9,
      });
      setDrawPreview({ kind: "wall", a: drag.a, b: point });
      return;
    }
    if (drag.kind === "draw-wall-rect") {
      const { point } = snapPoint(plan, {
        ...snapOptions,
        snapTargets: snapTargetsExcluding(drag.exclude),
        snapRadiusIn: 9,
      });
      setDrawPreview({ kind: "wall-rect", a: drag.a, b: point });
      return;
    }
    if (drag.kind === "wall-endpoint") {
      const { point } = snapPoint(plan, {
        ...snapOptions,
        snapTargets: snapTargetsExcluding(drag.exclude),
        snapRadiusIn: 9,
      });
      dispatch({ type: "MOVE_WALL_ENDPOINT", wallId: drag.wallId, end: drag.end, point, coalesce: `move-wall-endpoint:${drag.wallId}:${drag.end}` });
      return;
    }
    if (drag.kind === "move-furniture") {
      const { point } = snapPoint(plan, { ...snapOptions, snapRadiusIn: 9 });
      dispatch({ type: "MOVE_FURNITURE", furnitureId: drag.id, x: point.x, y: point.y, coalesce: `move-furniture:${drag.id}` });
      setDrag({ ...drag, moved: true });
    }
    // Phase 2: piping mode drags.
    if (drag.kind === "move-pipe-vertex") {
      const { point } = snapPoint(plan, { ...snapOptions, snapRadiusIn: 9 });
      dispatch({ type: "MOVE_PIPE_VERTEX", pipeId: drag.pipeId, index: drag.index, point, coalesce: `move-pipe-vertex:${drag.pipeId}:${drag.index}` });
    }
    if (drag.kind === "move-symbol") {
      const { point } = snapPoint(plan, { ...snapOptions, snapRadiusIn: 9 });
      dispatch({ type: "MOVE_SYMBOL", symbolId: drag.id, x: point.x, y: point.y, coalesce: `move-symbol:${drag.id}` });
      setDrag({ ...drag, moved: true });
    }
    // Phase 3: org chart drag — the whole diagram moves; people keep their
    // tree positions (layout is derived, never stored).
    if (drag.kind === "move-orgchart") {
      const { point } = snapPoint(plan, { ...snapOptions, snapRadiusIn: 9 });
      dispatch({ type: "MOVE_ORG_CHART", chartId: drag.id, x: point.x, y: point.y, coalesce: `move-orgchart:${drag.id}` });
      setDrag({ ...drag, moved: true });
    }
    // Printable sheet drag — free positioning (no snap); the frame's plan
    // region and fit scale stay fixed while it moves.
    if (drag.kind === "move-sheet") {
      dispatch({ type: "MOVE_SHEET", sheetId: drag.id, x: plan.x - drag.dx, y: plan.y - drag.dy, coalesce: `move-sheet:${drag.id}` });
      setDrag({ ...drag, moved: true });
    }
    if (drag.kind === "resize-furniture") {
      const piece = design.furniture.find((f) => f.id === drag.id);
      if (piece) {
        // plan point -> piece-local frame (un-rotate), then centered resize:
        // half-width / half-depth are the local |x| / |y| from the center.
        const local = rotatePoint(plan, { x: piece.x, y: piece.y }, -(piece.rotationDeg || 0));
        let widthIn = 2 * Math.abs(local.x - piece.x);
        let depthIn = 2 * Math.abs(local.y - piece.y);
        if (getCatalogEntry(piece.catalogId)?.symbol === "circle") {
          // round pieces stay round: both axes follow the larger drag
          const s = Math.max(widthIn, depthIn);
          widthIn = s;
          depthIn = s;
        }
        // A try/catch around dispatch() can't catch a reducer throw, so guard
        // the footprint bounds here: out-of-range drags are ignored until the
        // pointer returns inside 1"–480". The domain still validates as the
        // backstop for every other dispatch path.
        if (
          widthIn < FURNITURE_MIN_SIZE_IN ||
          widthIn > FURNITURE_MAX_SIZE_IN ||
          depthIn < FURNITURE_MIN_SIZE_IN ||
          depthIn > FURNITURE_MAX_SIZE_IN
        ) {
          return;
        }
        dispatch({ type: "RESIZE_FURNITURE", furnitureId: piece.id, widthIn, depthIn, coalesce: `resize-furniture:${piece.id}` });
      }
    }
    if (drag.kind === "move-underlay") {
      // Raw position (no snap) so the image can be aligned to its own features.
      dispatch({ type: "MOVE_UNDERLAY", x: plan.x - drag.dx, y: plan.y - drag.dy, coalesce: "move-underlay" });
    }
  };

  const onPointerUp = (e) => {
    if (drag?.kind === "draw-wall" && drawPreview) {
      const len = Math.hypot(drawPreview.b.x - drawPreview.a.x, drawPreview.b.y - drawPreview.a.y);
      if (len >= 1) {
        try {
          dispatch({ type: "ADD_WALL", a: drawPreview.a, b: drawPreview.b });
        } catch {
          // too short — ignore
        }
      }
    }
    if (drag?.kind === "draw-wall-rect" && drawPreview) {
      const width = Math.abs(drawPreview.b.x - drawPreview.a.x);
      const height = Math.abs(drawPreview.b.y - drawPreview.a.y);
      if (width >= 1 && height >= 1) {
        try {
          dispatch({ type: "ADD_WALL_RECT", a: drawPreview.a, b: drawPreview.b });
        } catch {
          // too small — ignore
        }
      }
    }
    setDrag(null);
    setDrawPreview(null);
  };

  const onWheel = (e) => {
    const screen = eventPoint(e);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const applied = scale / v.scale;
      return {
        scale,
        ox: screen.x - (screen.x - v.ox) * applied,
        oy: screen.y - (screen.y - v.oy) * applied,
      };
    });
  };

  const onDoubleClick = (e) => {
    // Phase 2: double-click finishes the in-progress pipe run.
    if (tool === "pipe") {
      commitPipeRun();
      return;
    }
    if (tool !== "select") return;
    const plan = toPlan(eventPoint(e));
    const hit = hitTest(plan);
    if (hit?.kind === "furniture") {
      const piece = design.furniture.find((f) => f.id === hit.id);
      if (piece) {
        dispatch({ type: "ROTATE_FURNITURE", furnitureId: hit.id, rotationDeg: piece.rotationDeg + 45 });
      }
    }
    if (hit?.kind === "symbol") {
      const inst = (design.symbols || []).find((s) => s.id === hit.id);
      if (inst) {
        dispatch({ type: "ROTATE_SYMBOL", symbolId: hit.id, rotationDeg: inst.rotationDeg + 45 });
      }
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === " ") setSpaceDown(true);
      // Delete/Backspace deletes the selection — but never while the user is
      // typing in a field (e.g. editing an org-chart person's name in the
      // panel input), or it would destroy the selection out from under them.
      if ((e.key === "Delete" || e.key === "Backspace") && tool === "select") {
        const tag = e.target?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
          dispatch({ type: "DELETE_SELECTION" });
        }
      }
      // Enter commits the in-progress pipe run (not while typing in a field).
      if (e.key === "Enter" && tool === "pipe") {
        const tag = e.target?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
          e.preventDefault();
          commitPipeRun();
        }
      }
      if (e.key === "Escape") {
        dispatch({ type: "CLEAR_SELECTION" });
        setDrawPreview(null);
        setPipePreview(null);
        setHoverPoint(null);
        setDrag(null);
      }
    };
    const onKeyUp = (e) => {
      if (e.key === " ") setSpaceDown(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [tool, dispatch, commitPipeRun]);

  // ---- rendering ----
  const thicknessPx = Math.max(3, design.settings.wallThicknessIn * view.scale);

  // Visio-style grid: light minor lines every gridIn, emphasized major
  // lines every MAJOR_GRID_EVERY minor lines (every 30″ on the 6″ default).
  const minorPx = gridIn * view.scale;
  const majorPx = minorPx * MAJOR_GRID_EVERY;
  let minorGridPath = "";
  for (let i = 1; i < MAJOR_GRID_EVERY; i += 1) {
    const p = (i * minorPx).toFixed(2);
    minorGridPath += `M ${p} 0 L ${p} ${majorPx.toFixed(2)} M 0 ${p} L ${majorPx.toFixed(2)} ${p} `;
  }

  const renderWall = (wall) => {
    const isSelected = selection?.kind === "wall" && selection?.id === wall.id;
    const segments = splitWallByOpenings(wall, design.openings, {
      wallHeightIn: design.settings.wallHeightIn,
    });
    const solids = segments.filter((s) => s.kind === "wall");
    // Architectural dimension line (Visio-style): offset past the wall face,
    // with 45° slash ticks and the measurement. Updates as the wall resizes.
    const dim = dimensionGeometry(wall, design.settings.wallThicknessIn / 2 + 10);
    return (
      <g key={wall.id}>
        {solids.map((s, i) => {
          const a = toScreen(s.a);
          const b = toScreen(s.b);
          return (
            <line
              key={i}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={isSelected ? "#f59e0b" : "#e5e7eb"}
              strokeWidth={thicknessPx}
              strokeLinecap="round"
            />
          );
        })}
        {renderOpenings(wall, isSelected)}
        {dim && (() => {
          const a = toScreen(dim.lineA);
          const b = toScreen(dim.lineB);
          const t1a = toScreen(dim.tickA.a);
          const t1b = toScreen(dim.tickA.b);
          const t2a = toScreen(dim.tickB.a);
          const t2b = toScreen(dim.tickB.b);
          const lp = toScreen(dim.labelPos);
          return (
            <g stroke="#9ca3af" strokeWidth={1}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              <line x1={t1a.x} y1={t1a.y} x2={t1b.x} y2={t1b.y} strokeWidth={1.5} />
              <line x1={t2a.x} y1={t2a.y} x2={t2b.x} y2={t2b.y} strokeWidth={1.5} />
              <text
                x={lp.x} y={lp.y}
                textAnchor="middle"
                fontSize={12}
                fill="#9ca3af"
                stroke="none"
                transform={`rotate(${dim.labelAngle} ${lp.x} ${lp.y})`}
              >
                {feetInchesLabel(dim.length)}
              </text>
            </g>
          );
        })()}
        {isSelected && ["a", "b"].map((end) => {
          const p = toScreen(wall[end]);
          return (
            <circle
              key={end} cx={p.x} cy={p.y} r={7}
              fill="#f59e0b" stroke="#fff" strokeWidth={2}
              style={{ cursor: "grab" }}
            />
          );
        })}
      </g>
    );
  };

  const renderOpenings = (wall, wallSelected) => {
    const len = wallLength(wall);
    if (len === 0) return null;
    const dir = { x: (wall.b.x - wall.a.x) / len, y: (wall.b.y - wall.a.y) / len };
    const normal = { x: dir.y, y: -dir.x };
    return design.openings
      .filter((o) => o.wallId === wall.id)
      .map((o) => {
        const isSelected = selection?.kind === "opening" && selection?.id === o.id;
        const g1 = { x: wall.a.x + dir.x * o.offsetIn, y: wall.a.y + dir.y * o.offsetIn };
        const g2 = { x: wall.a.x + dir.x * (o.offsetIn + o.widthIn), y: wall.a.y + dir.y * (o.offsetIn + o.widthIn) };
        const s1 = toScreen(g1);
        const s2 = toScreen(g2);
        const color = isSelected ? "#f59e0b" : o.type === "door" ? "#34d399" : "#60a5fa";
        if (o.type === "door") {
          // swing arc: hinge at s1, quarter circle of radius = gap width,
          // swept from the open leaf position to the closed position.
          const hinge = s1;
          const r = Math.max(8, Math.hypot(s2.x - s1.x, s2.y - s1.y));
          const aOpen = Math.atan2(normal.y, normal.x);
          const aClosed = Math.atan2(s2.y - s1.y, s2.x - s1.x);
          let sweep = aClosed - aOpen;
          while (sweep > Math.PI) sweep -= 2 * Math.PI;
          while (sweep < -Math.PI) sweep += 2 * Math.PI;
          const steps = 12;
          let arc = `M ${hinge.x + r * Math.cos(aOpen)} ${hinge.y + r * Math.sin(aOpen)}`;
          for (let i = 1; i <= steps; i += 1) {
            const a = aOpen + (sweep * i) / steps;
            arc += ` L ${hinge.x + r * Math.cos(a)} ${hinge.y + r * Math.sin(a)}`;
          }
          const leafEnd = { x: hinge.x + normal.x * r, y: hinge.y + normal.y * r };
          return (
            <g key={o.id}>
              <line x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y} stroke="#111827" strokeWidth={thicknessPx + 2} />
              <line x1={hinge.x} y1={hinge.y} x2={leafEnd.x} y2={leafEnd.y} stroke={color} strokeWidth={2} />
              <path d={arc} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="4 3" />
              <rect
                x={Math.min(s1.x, s2.x) - 8} y={Math.min(s1.y, s2.y) - 8}
                width={Math.abs(s2.x - s1.x) + 16} height={Math.abs(s2.y - s1.y) + 16}
                fill="transparent"
              />
            </g>
          );
        }
        // window: double line across the gap
        const off = (thicknessPx / 4) * 1;
        const w1a = { x: s1.x + normal.x * off, y: s1.y + normal.y * off };
        const w1b = { x: s2.x + normal.x * off, y: s2.y + normal.y * off };
        const w2a = { x: s1.x - normal.x * off, y: s1.y - normal.y * off };
        const w2b = { x: s2.x - normal.x * off, y: s2.y - normal.y * off };
        return (
          <g key={o.id}>
            <line x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y} stroke="#111827" strokeWidth={thicknessPx + 2} />
            <line x1={w1a.x} y1={w1a.y} x2={w1b.x} y2={w1b.y} stroke={color} strokeWidth={2.5} />
            <line x1={w2a.x} y1={w2a.y} x2={w2b.x} y2={w2b.y} stroke={color} strokeWidth={2.5} />
            <line x1={s1.x} y1={s1.y} x2={w1a.x} y2={w1a.y} stroke={color} strokeWidth={2} />
            <line x1={s2.x} y1={s2.y} x2={w1b.x} y2={w1b.y} stroke={color} strokeWidth={2} />
            <line x1={s1.x} y1={s1.y} x2={w2a.x} y2={w2a.y} stroke={color} strokeWidth={2} />
            <line x1={s2.x} y1={s2.y} x2={w2b.x} y2={w2b.y} stroke={color} strokeWidth={2} />
          </g>
        );
      });
  };

  // Furniture and rooms render through the domain-extensible symbol
  // registry: new symbol domains draw with zero canvas changes.
  const renderFurniture = (piece) => {
    const isSelected = selection?.kind === "furniture" && selection?.id === piece.id;
    const isMulti = (multiSelection || []).some((m) => m.id === piece.id);
    return renderSymbol2D("furniture", piece.catalogId, piece, {
      toScreen,
      scale: view.scale,
      highlighted: isSelected || isMulti,
    });
  };

  const renderRoom = (room) => renderSymbol2D("rooms", null, room, {
    toScreen,
    scale: view.scale,
    highlighted: selection?.kind === "room" && selection?.id === room.id,
  });

  // ---- Phase 2: piping mode ----
  // Pipe run: polyline with width from the nominal diameter, plus a
  // dimension label (length + diameter) on its longest segment. Selected
  // runs show draggable vertex handles.
  const renderPipe = (run) => {
    if (!layerVisible(run.layer)) return null;
    const isSelected = selection?.kind === "pipe" && selection?.id === run.id;
    const pts = (run.points || []).map(toScreen).map((p) => `${p.x},${p.y}`).join(" ");
    const widthPx = Math.max(2.5, (run.diameterIn || 2) * view.scale * 0.6);
    const seg = longestPipeSegment(run.points);
    let label = null;
    if (seg && seg.length >= 1) {
      const a = toScreen(seg.a);
      const b = toScreen(seg.b);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      label = (
        <text
          x={mid.x} y={mid.y - 8} textAnchor="middle" fontSize={11} fontWeight={600}
          fill="#e0f2fe" transform={`rotate(${angle.toFixed(1)} ${mid.x} ${mid.y})`}
        >
          {feetInchesLabel(seg.length)} ⌀{run.diameterIn}″
        </text>
      );
    }
    return (
      <g key={run.id}>
        <polyline
          points={pts}
          fill="none"
          stroke={isSelected ? "#f59e0b" : "#7dd3fc"}
          strokeWidth={widthPx}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.9}
        />
        {label}
        {isSelected &&
          (run.points || []).map((v, i) => {
            const s = toScreen(v);
            return (
              <circle key={i} cx={s.x} cy={s.y} r={6} fill="#f59e0b" stroke="#fff" strokeWidth={1.5} />
            );
          })}
      </g>
    );
  };

  const renderPipingSymbol = (inst) => {
    if (!layerVisible(inst.layer)) return null;
    const isSelected = selection?.kind === "symbol" && selection?.id === inst.id;
    return renderSymbol2D(inst.domain, inst.symbolId, inst, {
      toScreen,
      scale: view.scale,
      highlighted: isSelected,
    });
  };

  // Phase 3: org chart — people hierarchy diagram. The tree layout derives
  // from the chart's nodes at render time (see drawOrgChart).
  const renderOrgChart = (chart) => {
    const isSelected = selection?.kind === "orgchart" && selection?.id === chart.id;
    return drawOrgChart({
      chart,
      toScreen,
      scale: view.scale,
      highlighted: isSelected,
    });
  };

  // Printable paper sheet — WYSIWYG frame: dashed outline at the exact plan
  // region the sheet will print, with its size/orientation/fit-scale label.
  // pointerEvents="none": hit-testing is done manually in plan space so the
  // frame never swallows clicks meant for content inside it.
  const renderSheet = (sheet) => {
    const isSelected = selection?.kind === "sheet" && selection?.id === sheet.id;
    const b = sheetPlanBounds(sheet);
    const tl = toScreen({ x: b.x, y: b.y });
    const w = b.widthIn * view.scale;
    const h = b.heightIn * view.scale;
    const stroke = isSelected ? "#f59e0b" : "#22d3ee";
    return (
      <g key={sheet.id} pointerEvents="none">
        <rect
          x={tl.x} y={tl.y} width={w} height={h}
          fill="none" stroke={stroke} strokeWidth={isSelected ? 3 : 2}
          strokeDasharray="12 8"
        />
        <text x={tl.x + 10} y={tl.y - 10} fontSize={13} fontWeight={700} fill={stroke}>
          {`${getSheetSize(sheet.sizeId).label} · ${sheet.orientation} · ${fitScaleLabel(sheet.fitScale)}`}
        </text>
      </g>
    );
  };

  // In-progress pipe run: committed vertices, rubber band to the cursor,
  // and the running centerline length.
  // ---- VSDX import: read-only annotation paths/labels ----
  // Generic strokes Visio geometry maps to when no semantic match exists.
  // Rendered non-interactive (pointerEvents none); no editing tools in V1.
  const renderAnnotations = () => {
    const list = design.annotations || [];
    if (list.length === 0) return null;
    return (
      <g key="vsdx-annotations" pointerEvents="none">
        {list.map((a) => {
          if (!a || !Array.isArray(a.points) || a.points.length === 0) return null;
          const pts = a.points.map(toScreen);
          const strokeW = Math.max(1, (a.strokeWidthIn || 0.75) * view.scale * 0.6);
          if (a.kind === "label") {
            const p = pts[0];
            return (
              <text key={a.id} x={p.x} y={p.y} fontSize={13} fill="#94a3b8" textAnchor="middle">
                {a.text || ""}
              </text>
            );
          }
          const path = pts.map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(" ");
          return (
            <path
              key={a.id}
              d={a.closed ? `${path} Z` : path}
              fill={a.closed ? "rgba(148,163,184,0.08)" : "none"}
              stroke="#8fa3bf"
              strokeWidth={strokeW}
              strokeDasharray="7 5"
            />
          );
        })}
      </g>
    );
  };

  const renderPipePreview = () => {
    if (tool !== "pipe" || !pipePreview || pipePreview.length === 0) return null;
    const all = hoverPoint ? [...pipePreview, hoverPoint] : pipePreview;
    const pts = all.map(toScreen).map((p) => `${p.x},${p.y}`).join(" ");
    const end = toScreen(all[all.length - 1]);
    return (
      <g pointerEvents="none">
        <polyline
          points={pts} fill="none" stroke="#38bdf8" strokeWidth={3}
          strokeDasharray="10 6" strokeLinecap="round"
        />
        {pipePreview.map((v, i) => {
          const s = toScreen(v);
          return <circle key={i} cx={s.x} cy={s.y} r={4} fill="#38bdf8" />;
        })}
        <text x={end.x} y={end.y - 12} textAnchor="middle" fontSize={13} fontWeight={600} fill="#38bdf8">
          {feetInchesLabel(pipeRunLengthIn(all))} · double-click or Enter to finish
        </text>
      </g>
    );
  };

  // Corner resize handles on the selected furniture piece (screen-space
  // squares; hit-testing happens in plan space in onPointerDown).
  const renderResizeHandles = () => {
    if (selection?.kind !== "furniture") return null;
    const piece = design.furniture.find((f) => f.id === selection.id);
    if (!piece) return null;
    const { widthIn, depthIn } = pieceSize(piece);
    const corners = rotatedFootprintCorners({
      x: piece.x, y: piece.y, widthIn, depthIn, rotationDeg: piece.rotationDeg,
    }).map(toScreen);
    const s = 10;
    return (
      <g key={`handles-${piece.id}`} pointerEvents="none">
        {corners.map((c, i) => (
          <rect key={i} x={c.x - s / 2} y={c.y - s / 2} width={s} height={s}
            fill="#f59e0b" stroke="#ffffff" strokeWidth={1.5} />
        ))}
      </g>
    );
  };

  const cursorForTool = {
    select: "default", wall: "crosshair", wallrect: "crosshair", room: "copy", door: "crosshair",
    window: "crosshair", furniture: "copy", pipe: "crosshair", piping: "copy",
    orgchart: "copy",
    erase: "not-allowed", pan: spaceDown ? "grabbing" : "grab",
    calibrate: "crosshair",
  }[tool] || "default";

  // ---- Visio-style rulers: thin strips along the top and left edges,
  // showing feet/inches and tracking pan/zoom ----
  const RULER_PX = 22;

  const renderRulers = () => {
    const { w, h } = canvasSize;
    if (w < 80 || h < 80) return null;
    // Minor ticks follow the grid spacing; widen when zoomed far out.
    let minorStep = gridIn;
    while (minorStep * view.scale < 12) minorStep *= 2;
    const isFootMark = (v) => Math.abs(v / 12 - Math.round(v / 12)) < 1e-9;
    const topTicks = [];
    const firstX = Math.floor(((RULER_PX - view.ox) / view.scale) / minorStep) * minorStep;
    for (let x = firstX; ; x += minorStep) {
      const sx = view.ox + x * view.scale;
      if (sx > w) break;
      if (sx < RULER_PX - 0.5) continue;
      const isFoot = isFootMark(x);
      topTicks.push({ pos: sx, isFoot, label: isFoot ? `${Math.round(x / 12)}′` : null });
    }
    const leftTicks = [];
    const firstY = Math.floor(((RULER_PX - view.oy) / view.scale) / minorStep) * minorStep;
    for (let y = firstY; ; y += minorStep) {
      const sy = view.oy + y * view.scale;
      if (sy > h) break;
      if (sy < RULER_PX - 0.5) continue;
      const isFoot = isFootMark(y);
      leftTicks.push({ pos: sy, isFoot, label: isFoot ? `${Math.round(y / 12)}′` : null });
    }
    return (
      <g onPointerDown={(e) => e.stopPropagation()} style={{ cursor: "default" }}>
        <rect x={0} y={0} width={w} height={RULER_PX} fill="#0d1420" />
        <rect x={0} y={0} width={RULER_PX} height={h} fill="#0d1420" />
        {topTicks.map((t, i) => (
          <g key={`t${i}`}>
            <line x1={t.pos} y1={t.isFoot ? 5 : 12} x2={t.pos} y2={RULER_PX} stroke="#6b7280" strokeWidth={1} />
            {t.label && <text x={t.pos + 3} y={11} fontSize={9} fill="#9ca3af">{t.label}</text>}
          </g>
        ))}
        {leftTicks.map((t, i) => (
          <g key={`l${i}`}>
            <line x1={t.isFoot ? 5 : 12} y1={t.pos} x2={RULER_PX} y2={t.pos} stroke="#6b7280" strokeWidth={1} />
            {t.label && <text x={3} y={t.pos - 2} fontSize={9} fill="#9ca3af">{t.label}</text>}
          </g>
        ))}
        <rect x={0} y={0} width={RULER_PX} height={RULER_PX} fill="#1a2333" />
        <line x1={0} y1={RULER_PX} x2={w} y2={RULER_PX} stroke="#2b3648" strokeWidth={1} />
        <line x1={RULER_PX} y1={0} x2={RULER_PX} y2={h} stroke="#2b3648" strokeWidth={1} />
      </g>
    );
  };

  const isEmpty = design.walls.length === 0 && design.rooms.length === 0
    && (design.pipes || []).length === 0 && (design.symbols || []).length === 0
    && (design.orgCharts || []).length === 0 && (design.annotations || []).length === 0;

  // ---- Background underlay: drawn beneath the grid and the plan,
  // scaling/panning with the canvas transform ----
  const renderUnderlay = () => {
    const u = design.underlay;
    if (!u) return null;
    const topLeft = toScreen({ x: u.x, y: u.y });
    const w = (u.widthPx / u.pxPerIn) * view.scale;
    const h = (u.heightPx / u.pxPerIn) * view.scale;
    if (!(w > 0) || !(h > 0)) return null;
    return (
      <image
        href={u.dataUrl}
        x={topLeft.x}
        y={topLeft.y}
        width={w}
        height={h}
        opacity={u.opacity}
        preserveAspectRatio="none"
      />
    );
  };

  // ---- Scale-calibration markers: the two clicked points + dashed span ----
  const renderCalibrationMarkers = () => {
    if (tool !== "calibrate" || !calibration) return null;
    const pts = [calibration.a, calibration.b].filter(Boolean).map(toScreen);
    if (pts.length === 0) return null;
    return (
      <g pointerEvents="none">
        {pts.length === 2 && (
          <line
            x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y}
            stroke="#22d3ee" strokeWidth={2} strokeDasharray="6 4"
          />
        )}
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={8} fill="none" stroke="#22d3ee" strokeWidth={2.5} />
            <circle cx={p.x} cy={p.y} r={2.5} fill="#22d3ee" />
            <text x={p.x + 12} y={p.y - 10} fontSize={12} fontWeight={700} fill="#22d3ee">
              {i + 1}
            </text>
          </g>
        ))}
      </g>
    );
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-[#111827]">
      <svg
        ref={svgRef}
        className="h-full w-full touch-none select-none"
        style={{ cursor: drag?.kind === "resize-furniture" ? "nwse-resize" : drag?.kind ? "grabbing" : cursorForTool }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { setDrag(null); setDrawPreview(null); }}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
      >
        <defs>
          <pattern id="designer-grid" width={majorPx} height={majorPx} patternUnits="userSpaceOnUse">
            <path d={minorGridPath} fill="none" stroke="#1f2937" strokeWidth={1} />
            <path d={`M ${majorPx.toFixed(2)} 0 L 0 0 0 ${majorPx.toFixed(2)}`} fill="none" stroke="#3b4763" strokeWidth={1.25} />
          </pattern>
        </defs>
        {renderUnderlay()}
        <rect x={-5000} y={-5000} width={10000} height={10000} fill="url(#designer-grid)"
          transform={`translate(${view.ox % majorPx} ${view.oy % majorPx})`} />
        {design.rooms.map(renderRoom)}
        {renderAnnotations()}
        {design.walls.map(renderWall)}
        {(design.pipes || []).map(renderPipe)}
        {design.furniture.map(renderFurniture)}
        {(design.symbols || []).map(renderPipingSymbol)}
        {(design.orgCharts || []).map(renderOrgChart)}
        {(design.sheets || []).map(renderSheet)}
        {renderPipePreview()}
        {renderResizeHandles()}
        {renderCalibrationMarkers()}
        {drawPreview && (() => {
          const a = toScreen(drawPreview.a);
          const b = toScreen(drawPreview.b);
          if (drawPreview.kind === "wall-rect") {
            const x = Math.min(a.x, b.x);
            const y = Math.min(a.y, b.y);
            const w = Math.abs(b.x - a.x);
            const h = Math.abs(b.y - a.y);
            const widthIn = Math.abs(drawPreview.b.x - drawPreview.a.x);
            const heightIn = Math.abs(drawPreview.b.y - drawPreview.a.y);
            return (
              <g>
                <rect x={x} y={y} width={w} height={h} fill="none" stroke="#34d399" strokeWidth={thicknessPx} strokeDasharray="10 6" />
                <text x={(a.x + b.x) / 2} y={y - 12} textAnchor="middle" fontSize={13} fontWeight={600} fill="#34d399">
                  {feetInchesLabel(widthIn)}
                </text>
                <text x={x + w + 12} y={(a.y + b.y) / 2} textAnchor="start" fontSize={13} fontWeight={600} fill="#34d399">
                  {feetInchesLabel(heightIn)}
                </text>
              </g>
            );
          }
          return (
            <g>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#34d399" strokeWidth={thicknessPx} strokeLinecap="round" strokeDasharray="10 6" />
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 12} textAnchor="middle" fontSize={13} fontWeight={600} fill="#34d399">
                {feetInchesLabel(Math.hypot(drawPreview.b.x - drawPreview.a.x, drawPreview.b.y - drawPreview.a.y))}
              </text>
            </g>
          );
        })()}
        {renderRulers()}
      </svg>
      {isEmpty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="max-w-md rounded-lg bg-gray-900/90 p-6 text-center shadow-xl">
            <p className="text-lg font-semibold text-gray-100">Start your floor plan</p>
            <p className="mt-2 text-sm text-gray-400">
              Pick the <span className="text-emerald-300">Wall</span> tool and drag to draw walls,
              or drop a pre-shaped <span className="text-emerald-300">Room</span> to begin.
              Scroll to zoom, drag with the Pan tool (or hold Space) to move around.
            </p>
          </div>
        </div>
      )}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded bg-gray-900/85 px-2 py-1 text-xs text-gray-300">
        <button
          onClick={() => dispatch({ type: "UPDATE_SETTINGS", settings: { snapEnabled: !snapEnabled } })}
          title="Snap walls, rooms, openings, and furniture to the grid (Visio-style)"
          className={`rounded px-2 py-0.5 font-semibold ${
            snapEnabled ? "bg-emerald-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
        >
          Snap {snapEnabled ? "on" : "off"}
        </button>
        <span className="text-gray-600">|</span>
        {GRID_SPACING_OPTIONS.map((opt) => (
          <button
            key={opt}
            onClick={() => dispatch({ type: "UPDATE_SETTINGS", settings: { gridIn: opt } })}
            title={`Grid spacing ${gridSpacingLabel(opt)}`}
            className={`rounded px-2 py-0.5 ${
              gridIn === opt ? "bg-emerald-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            {gridSpacingLabel(opt)}
          </button>
        ))}
        <span className="text-gray-500">scroll to zoom &middot; double-click furniture to rotate</span>
      </div>
    </div>
  );
}

function distancePointToPolygonEdge(plan, polygon) {
  if (!polygon || polygon.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    best = Math.min(best, distancePointToSegment(plan, a, q));
  }
  return best;
}
