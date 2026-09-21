"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCatalogEntry } from "@/domains/roomDesigner/furnitureCatalog";
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
  snapPoint,
  snapScalar,
  underlayContainsPoint,
  wallLength,
} from "@/domains/roomDesigner/designerGeometry";
import { splitWallByOpenings } from "@/domains/roomDesigner/designerThreeModel";
import { renderSymbol2D } from "./symbolDrawRoutines";

const MIN_SCALE = 0.35;
const MAX_SCALE = 12;
const HIT_TOLERANCE_PX = 10;

/**
 * SVG 2D floor-plan editor. All plan math is inches; the component maps
 * plan <-> screen with a pan/zoom transform kept in local state.
 */
export default function PlanCanvas({ design, tool, selection, multiSelection, calibration, pendingCatalogId, pendingRoomTemplate, dispatch }) {
  const svgRef = useRef(null);
  const wrapRef = useRef(null);
  const [view, setView] = useState({ scale: 1.6, ox: 60, oy: 60 });
  const [drawPreview, setDrawPreview] = useState(null); // {a, b} plan inches while drawing a wall
  const [drag, setDrag] = useState(null); // active drag descriptor
  const [spaceDown, setSpaceDown] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });

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
  const hitTest = useCallback(
    (plan) => {
      const tolIn = HIT_TOLERANCE_PX / view.scale;
      // furniture first (topmost)
      for (let i = design.furniture.length - 1; i >= 0; i -= 1) {
        const f = design.furniture[i];
        const entry = getCatalogEntry(f.catalogId);
        if (!entry) continue;
        const corners = rotatedFootprintCorners({
          x: f.x, y: f.y, widthIn: entry.widthIn, depthIn: entry.depthIn, rotationDeg: f.rotationDeg,
        });
        // point-in-convex-quad via half-plane signs
        let inside = true;
        for (let k = 0; k < 4; k += 1) {
          const p1 = corners[k];
          const p2 = corners[(k + 1) % 4];
          const cross = (p2.x - p1.x) * (plan.y - p1.y) - (p2.y - p1.y) * (plan.x - p1.x);
          if (cross < 0) { inside = false; break; }
        }
        if (inside) return { kind: "furniture", id: f.id };
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
    [design, view.scale],
  );

  // ---- pointer handlers ----
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
      setDrawPreview({ a: point, b: point });
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
    const hit = hitTest(plan);
    if (hit?.kind === "furniture") {
      dispatch({ type: "SELECT", selection: hit });
      setDrag({ kind: "move-furniture", id: hit.id, moved: false });
      return;
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
      setDrawPreview({ a: drag.a, b: point });
      return;
    }
    if (drag.kind === "wall-endpoint") {
      const { point } = snapPoint(plan, {
        ...snapOptions,
        snapTargets: snapTargetsExcluding(drag.exclude),
        snapRadiusIn: 9,
      });
      dispatch({ type: "MOVE_WALL_ENDPOINT", wallId: drag.wallId, end: drag.end, point });
      return;
    }
    if (drag.kind === "move-furniture") {
      const { point } = snapPoint(plan, { ...snapOptions, snapRadiusIn: 9 });
      dispatch({ type: "MOVE_FURNITURE", furnitureId: drag.id, x: point.x, y: point.y });
      setDrag({ ...drag, moved: true });
    }
    if (drag.kind === "move-underlay") {
      // Raw position (no snap) so the image can be aligned to its own features.
      dispatch({ type: "MOVE_UNDERLAY", x: plan.x - drag.dx, y: plan.y - drag.dy });
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
    if (tool !== "select") return;
    const plan = toPlan(eventPoint(e));
    const hit = hitTest(plan);
    if (hit?.kind === "furniture") {
      const piece = design.furniture.find((f) => f.id === hit.id);
      if (piece) {
        dispatch({ type: "ROTATE_FURNITURE", furnitureId: hit.id, rotationDeg: piece.rotationDeg + 45 });
      }
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === " ") setSpaceDown(true);
      if ((e.key === "Delete" || e.key === "Backspace") && tool === "select") {
        dispatch({ type: "DELETE_SELECTION" });
      }
      if (e.key === "Escape") {
        dispatch({ type: "CLEAR_SELECTION" });
        setDrawPreview(null);
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
  }, [tool, dispatch]);

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

  const cursorForTool = {
    select: "default", wall: "crosshair", room: "copy", door: "crosshair",
    window: "crosshair", furniture: "copy", erase: "not-allowed", pan: spaceDown ? "grabbing" : "grab",
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

  const isEmpty = design.walls.length === 0 && design.rooms.length === 0;

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
        style={{ cursor: drag?.kind ? "grabbing" : cursorForTool }}
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
        {design.walls.map(renderWall)}
        {design.furniture.map(renderFurniture)}
        {renderCalibrationMarkers()}
        {drawPreview && (() => {
          const a = toScreen(drawPreview.a);
          const b = toScreen(drawPreview.b);
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
