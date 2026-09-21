// FORGE Capture — thin browser host ("use client").
// This component owns NO editor logic: every state transition calls the
// framework-neutral core in @/domains/capture-editor. It only wires browser
// capabilities (canvas element, file/clipboard input, localStorage, download)
// and React state. All annotation geometry is converted with screenToImage()
// before it is stored, so the document always lives in source-image pixel
// space regardless of zoom/pan.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_STYLE,
  addAnnotation,
  base64ToBytes,
  browserImageCapabilities,
  browserStorageAdapter,
  canRedo,
  canUndo,
  clearDraft,
  commitHistory,
  createAnnotation,
  createProjectFromSource,
  createViewport,
  decodeSourceImage,
  emptyHistory,
  encodeBmp,
  encodeGif,
  encodeTiff,
  EXPORT_FORMATS,
  exportExtensionForFormat,
  exportLabelForFormat,
  exportMimeForFormat,
  fileSource,
  fitViewport,
  flattenDocument,
  isNativeBlobFormat,
  geometryBounds,
  getAnnotation,
  hitTest,
  imageToScreen,
  isRedaction,
  moveAnnotation,
  normalizeRect,
  recoverDraft,
  redoHistory,
  removeAnnotation,
  renderDocument,
  reorderZ,
  resizeRect,
  saveDraft,
  saveProject,
  screenToImage,
  setAnnotationLock,
  undoHistory,
  updateAnnotation,
  withGeometry,
  withStyle,
  withText,
  zoomAt,
  createProjectStore,
  drawAnnotation,
} from "@/domains/capture-editor/index.js";

const TOOLS = Object.freeze([
  { id: "select", label: "Select" },
  { id: "arrow", label: "Arrow" },
  { id: "line", label: "Line" },
  { id: "rectangle", label: "Rectangle" },
  { id: "ellipse", label: "Ellipse" },
  { id: "freehand", label: "Freehand" },
  { id: "highlight", label: "Highlight" },
  { id: "text", label: "Text" },
  { id: "callout", label: "Callout" },
  { id: "step-marker", label: "Step" },
  { id: "blur", label: "Blur" },
  { id: "blackout", label: "Blackout" },
]);

const RECT_TOOL_TYPES = new Set(["rectangle", "ellipse", "text", "callout", "step-marker", "blur", "blackout"]);
const SEGMENT_TOOL_TYPES = new Set(["line", "arrow"]);
const STROKE_TOOL_TYPES = new Set(["freehand", "highlight"]);

function toolDefaultStyle(tool) {
  switch (tool) {
    case "highlight":
      return { stroke: "#facc15", strokeWidth: 3 };
    case "blur":
      return { blurRadius: 14 };
    case "text":
    case "callout":
      return { stroke: "#111827", fontSize: 20 };
    default:
      return {};
  }
}

function newDocumentId() {
  const g = globalThis;
  if (g.crypto && typeof g.crypto.randomUUID === "function") return g.crypto.randomUUID();
  return `capture-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

// Screen-space resize handles for the current selection.
function handlePositions(annotation, viewport) {
  const toScreen = (p) => imageToScreen(viewport, p);
  if (SEGMENT_TOOL_TYPES.has(annotation.type)) {
    const [a, b] = annotation.geometry.points;
    return [
      { id: "p0", ...toScreen({ x: a[0], y: a[1] }) },
      { id: "p1", ...toScreen({ x: b[0], y: b[1] }) },
    ];
  }
  if (!RECT_TOOL_TYPES.has(annotation.type)) return [];
  const r = normalizeRect(annotation.geometry);
  const corners = {
    nw: { x: r.x, y: r.y },
    n: { x: r.x + r.w / 2, y: r.y },
    ne: { x: r.x + r.w, y: r.y },
    e: { x: r.x + r.w, y: r.y + r.h / 2 },
    se: { x: r.x + r.w, y: r.y + r.h },
    s: { x: r.x + r.w / 2, y: r.y + r.h },
    sw: { x: r.x, y: r.y + r.h },
    w: { x: r.x, y: r.y + r.h / 2 },
  };
  return Object.entries(corners).map(([id, p]) => ({ id, ...toScreen(p) }));
}

function handleAtPoint(annotation, screenPoint, viewport, radius = 9) {
  let best = null;
  let bestDist = radius;
  for (const handle of handlePositions(annotation, viewport)) {
    const d = Math.hypot(handle.x - screenPoint.x, handle.y - screenPoint.y);
    if (d <= bestDist) {
      best = handle.id;
      bestDist = d;
    }
  }
  return best;
}

function isTextLike(annotation) {
  return annotation != null &&
    (annotation.type === "text" || annotation.type === "callout" || annotation.type === "step-marker");
}

// Browser services are created once via lazy state init (no effect needed).
// The core module loads without a DOM; capabilities throw only when used.
function initCaptureServices() {
  try {
    return {
      store: createProjectStore(browserStorageAdapter()),
      caps: browserImageCapabilities(),
      error: null,
    };
  } catch (e) {
    return { store: null, caps: null, error: e };
  }
}

function initialRecovery(services) {
  if (services.error || !services.store) return { draft: null, notice: null };
  const result = recoverDraft(services.store);
  if (result.status === "ok") return { draft: result.doc, notice: null };
  if (result.status === "corrupt") {
    return {
      draft: null,
      notice: {
        kind: "error",
        text: "Found a corrupt autosave draft. It was left untouched and cannot replace your work.",
      },
    };
  }
  return { draft: null, notice: null };
}

export default function CaptureEditorHost() {
  const [services] = useState(initCaptureServices);
  const [initial] = useState(() => initialRecovery(services));
  // doc + history live in one state so undo/redo and edits stay atomic.
  const [editor, setEditor] = useState(() => ({ doc: null, history: emptyHistory() }));
  const [bitmap, setBitmap] = useState(null);
  const [viewport, setViewport] = useState(() => createViewport());
  const [tool, setTool] = useState("select");
  const [selectionId, setSelectionId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [notice, setNotice] = useState(
    () =>
      initial.notice ??
      (services.error
        ? { kind: "error", text: `Capture storage unavailable: ${services.error.message}` }
        : null),
  );
  const [recovered, setRecovered] = useState(() => initial.draft);
  const [prevSelectionId, setPrevSelectionId] = useState(null);
  const [textValue, setTextValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [exportFormat, setExportFormat] = useState("png");
  const [exportQuality, setExportQuality] = useState(0.92); // JPEG/WebP only

  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const fileRef = useRef(null);
  const gestureRef = useRef(null);
  const spaceDownRef = useRef(false);
  // Set when a fresh document is loaded; the fit runs on the next effect
  // because loadFile/restoreRecovered execute before React mounts the canvas.
  const fitPendingRef = useRef(false);

  // Fresh mirror for callbacks that outlive a render (wheel, keyboard).
  const liveRef = useRef({});
  useEffect(() => {
    liveRef.current = { editor, viewport, tool, selectionId, bitmap };
  });

  const { doc, history } = editor;
  const selected = selectionId && doc ? getAnnotation(doc, selectionId) : null;

  // Keep the text editor in sync with the selection without an effect: when
  // the selection identity changes, re-seed the draft value during render.
  if ((selected?.id ?? null) !== prevSelectionId) {
    setPrevSelectionId(selected?.id ?? null);
    setTextValue(isTextLike(selected) ? (selected.text ?? "") : "");
  }

  // --- canvas sizing ------------------------------------------------------

  const sizeCanvasToWrapper = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const w = Math.max(320, Math.floor(wrap.clientWidth));
    const h = Math.max(240, Math.floor(wrap.clientHeight));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }, []);

  useEffect(() => {
    sizeCanvasToWrapper();
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => sizeCanvasToWrapper());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [sizeCanvasToWrapper]);

  // Autosave the draft on every document change (best-effort, debounced).
  useEffect(() => {
    const store = services.store;
    if (!doc || !store) return undefined;
    const timer = setTimeout(() => {
      try {
        saveDraft(store, doc);
      } catch {
        // Draft saving is best-effort; explicit Save reports its own errors.
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [doc, services]);

  // --- rendering ----------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !doc || !bitmap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // e.g. jsdom without a real canvas implementation
    const createCanvas = (w, h) => {
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      return off;
    };
    renderDocument(ctx, doc, { sourceImage: bitmap, viewport, createCanvas });
    if (draft) {
      drawAnnotation(ctx, draft, { createCanvas });
    }
    // Selection overlay in screen space (never touches document geometry).
    const annotation = selectionId ? getAnnotation(doc, selectionId) : null;
    if (annotation) {
      const bounds = geometryBounds(annotation.geometry);
      const tl = imageToScreen(viewport, { x: bounds.x, y: bounds.y });
      const br = imageToScreen(viewport, { x: bounds.x + bounds.w, y: bounds.y + bounds.h });
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      ctx.setLineDash([]);
      for (const handle of handlePositions(annotation, viewport)) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(handle.x - 5, handle.y - 5, 10, 10);
        ctx.strokeRect(handle.x - 5, handle.y - 5, 10, 10);
      }
      ctx.restore();
    }
  }, [doc, bitmap, viewport, draft, selectionId]);

  // --- source loading -----------------------------------------------------

  const markFitPending = useCallback(() => {
    fitPendingRef.current = true;
  }, []);

  // Applies the pending fit once the canvas for the new document is mounted.
  // loadFile/restoreRecovered cannot fit synchronously: the canvas only
  // renders after the document state commits.
  useEffect(() => {
    if (!fitPendingRef.current || !doc) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    sizeCanvasToWrapper();
    setViewport(fitViewport(doc.canvas.width, doc.canvas.height, canvas.width, canvas.height));
    fitPendingRef.current = false;
  }, [doc, sizeCanvasToWrapper]);

  const loadFile = useCallback(
    async (file) => {
      if (!file) return;
      setBusy(true);
      setNotice(null);
      try {
        const caps = services.caps;
        const raw = await fileSource(file).load();
        const decoded = await decodeSourceImage({ bytes: raw.bytes, mime: raw.mime }, caps);
        const next = createProjectFromSource(decoded, { id: newDocumentId() });
        setEditor({ doc: next, history: emptyHistory() });
        setBitmap(decoded.image);
        setSelectionId(null);
        setRecovered(null);
        markFitPending();
        setNotice({ kind: "ok", text: `Loaded ${decoded.width}×${decoded.height} (${decoded.mime}). Metadata stripped on import.` });
      } catch (e) {
        setNotice({ kind: "error", text: `Could not load image: ${e.message}` });
      } finally {
        setBusy(false);
      }
    },
    [services, markFitPending],
  );

  const restoreRecovered = useCallback(async () => {
    if (!recovered) return;
    setBusy(true);
    try {
      const caps = services.caps;
      const raw = base64ToBytes(recovered.source.bytes);
      const decoded = await caps.decode(raw, recovered.source.mime);
      if (decoded.width !== recovered.canvas.width || decoded.height !== recovered.canvas.height) {
        throw new Error("recovered image dimensions do not match the saved project");
      }
      setEditor({ doc: recovered, history: emptyHistory() });
      setBitmap(decoded.image);
      setSelectionId(null);
      setRecovered(null);
      markFitPending();
      setNotice({ kind: "ok", text: "Recovered your unsaved draft." });
    } catch (e) {
      setNotice({ kind: "error", text: `Could not restore the draft: ${e.message}` });
    } finally {
      setBusy(false);
    }
  }, [recovered, services, markFitPending]);

  const discardRecovered = useCallback(() => {
    try {
      if (services.store) clearDraft(services.store);
    } catch {
      // Best-effort.
    }
    setRecovered(null);
  }, [services]);

  // --- history-aware mutation ---------------------------------------------

  const doUndo = useCallback(() => {
    const { editor: s } = liveRef.current;
    if (!s?.doc) return;
    const result = undoHistory(s.history, s.doc);
    setEditor({ doc: result.document, history: result.history });
    setSelectionId(null);
  }, []);

  const doRedo = useCallback(() => {
    const { editor: s } = liveRef.current;
    if (!s?.doc) return;
    const result = redoHistory(s.history, s.doc);
    setEditor({ doc: result.document, history: result.history });
    setSelectionId(null);
  }, []);

  // --- pointer interaction (all coordinates converted to image space) -----

  const eventToImage = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (canvas.width / Math.max(1, rect.width));
    const sy = (e.clientY - rect.top) * (canvas.height / Math.max(1, rect.height));
    return {
      image: screenToImage(liveRef.current.viewport, { x: sx, y: sy }),
      screen: { x: sx, y: sy },
    };
  };

  const topmostAt = (document, point) => {
    const ordered = [...document.annotations].sort((a, b) => b.z - a.z);
    return ordered.find((a) => hitTest(a, point)) ?? null;
  };

  const onPointerDown = (e) => {
    const { editor: s, tool: currentTool } = liveRef.current;
    if (!s?.doc || busy) return;
    const current = s.doc;
    const canvas = canvasRef.current;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Best-effort.
    }
    const { image, screen } = eventToImage(e);

    if (e.button === 1 || (e.button === 0 && spaceDownRef.current)) {
      gestureRef.current = {
        mode: "pan",
        startScreen: screen,
        startViewport: liveRef.current.viewport,
      };
      return;
    }
    if (e.button !== 0) return;

    if (currentTool === "select") {
      const sel = liveRef.current.selectionId ? getAnnotation(current, liveRef.current.selectionId) : null;
      if (sel && !sel.locked) {
        const handle = handleAtPoint(sel, screen, liveRef.current.viewport);
        if (handle) {
          gestureRef.current = { mode: "resize", id: sel.id, handle, start: image, baseDoc: current, committed: false };
          return;
        }
      }
      const hit = topmostAt(current, image);
      if (hit) {
        setSelectionId(hit.id);
        if (!hit.locked) {
          gestureRef.current = { mode: "move", id: hit.id, start: image, baseDoc: current, committed: false };
        }
      } else {
        setSelectionId(null);
      }
      return;
    }

    gestureRef.current = {
      mode: "draw",
      tool: currentTool,
      start: image,
      current: image,
      points: STROKE_TOOL_TYPES.has(currentTool) ? [[image.x, image.y]] : null,
    };
    e.preventDefault();
  };

  const previewForGesture = (g) => {
    const style = { ...DEFAULT_STYLE, ...toolDefaultStyle(g.tool) };
    if (STROKE_TOOL_TYPES.has(g.tool)) {
      return { type: g.tool, geometry: { points: g.points }, style, text: "" };
    }
    if (SEGMENT_TOOL_TYPES.has(g.tool)) {
      return {
        type: g.tool,
        geometry: { points: [[g.start.x, g.start.y], [g.current.x, g.current.y]] },
        style,
        text: "",
      };
    }
    const r = normalizeRect({ x: g.start.x, y: g.start.y, w: g.current.x - g.start.x, h: g.current.y - g.start.y });
    const geometry = r.w < 4 || r.h < 4
      ? { x: g.start.x - 2, y: g.start.y - 2, w: 4, h: 4 }
      : r;
    const preview = { type: g.tool, geometry, style };
    if (g.tool === "text" || g.tool === "callout" || g.tool === "step-marker") preview.text = "";
    if (g.tool === "callout") preview.anchor = { x: g.start.x, y: g.start.y };
    return preview;
  };

  const onPointerMove = (e) => {
    const g = gestureRef.current;
    if (!g) return;
    const { image, screen } = eventToImage(e);

    if (g.mode === "pan") {
      const dx = screen.x - g.startScreen.x;
      const dy = screen.y - g.startScreen.y;
      const v = g.startViewport;
      setViewport(createViewport({ zoom: v.zoom, panX: v.panX + dx, panY: v.panY + dy }));
      return;
    }
    if (g.mode === "draw") {
      g.current = image;
      if (g.points) {
        const last = g.points[g.points.length - 1];
        if (Math.hypot(image.x - last[0], image.y - last[1]) >= 2) {
          g.points.push([image.x, image.y]);
        }
      }
      setDraft(previewForGesture(g));
      return;
    }
    if (g.mode === "move") {
      const dx = image.x - g.start.x;
      const dy = image.y - g.start.y;
      if (!g.committed && Math.hypot(dx, dy) < 2) return;
      const moved = moveAnnotation(g.baseDoc, g.id, dx, dy);
      if (moved === g.baseDoc) return; // locked mid-gesture: refuse
      if (!g.committed) {
        setEditor((s) => ({ doc: moved, history: commitHistory(s.history, g.baseDoc) }));
        g.committed = true;
      } else {
        setEditor((s) => ({ ...s, doc: moved }));
      }
      return;
    }
    if (g.mode === "resize") {
      const dx = image.x - g.start.x;
      const dy = image.y - g.start.y;
      if (!g.committed && Math.hypot(dx, dy) < 2) return;
      const base = getAnnotation(g.baseDoc, g.id);
      if (!base) return;
      let next = g.baseDoc;
      if (SEGMENT_TOOL_TYPES.has(base.type)) {
        const pts = base.geometry.points.map((p) => [...p]);
        const index = g.handle === "p0" ? 0 : 1;
        pts[index] = [pts[index][0] + dx, pts[index][1] + dy];
        next = updateAnnotation(g.baseDoc, g.id, (a) => withGeometry(a, { points: pts }));
      } else {
        const resized = resizeRect(normalizeRect(base.geometry), g.handle, dx, dy);
        next = updateAnnotation(g.baseDoc, g.id, (a) => withGeometry(a, resized));
      }
      if (next !== g.baseDoc) {
        if (!g.committed) {
          setEditor((s) => ({ doc: next, history: commitHistory(s.history, g.baseDoc) }));
          g.committed = true;
        } else {
          setEditor((s) => ({ ...s, doc: next }));
        }
      }
    }
  };

  const finishDraw = (g) => {
    let geometry = null;
    if (STROKE_TOOL_TYPES.has(g.tool)) {
      if (!g.points || g.points.length < 2) return;
      geometry = { points: g.points };
    } else if (SEGMENT_TOOL_TYPES.has(g.tool)) {
      geometry = { points: [[g.start.x, g.start.y], [g.current.x, g.current.y]] };
    } else {
      const r = normalizeRect({ x: g.start.x, y: g.start.y, w: g.current.x - g.start.x, h: g.current.y - g.start.y });
      geometry = r.w < 4 || r.h < 4
        ? { x: g.start.x - 2, y: g.start.y - 2, w: 4, h: 4 }
        : r;
    }
    const options = {
      style: { ...DEFAULT_STYLE, ...toolDefaultStyle(g.tool) },
      text: g.tool === "text" ? "Text" : "",
    };
    if (g.tool === "callout") options.anchor = { x: g.start.x, y: g.start.y };
    const annotation = createAnnotation(g.tool, geometry, options);
    setEditor((s) => {
      if (!s.doc) return s;
      return { doc: addAnnotation(s.doc, annotation), history: commitHistory(s.history, s.doc) };
    });
    setSelectionId(annotation.id);
  };

  const onPointerUp = () => {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g) return;
    if (g.mode === "draw") {
      try {
        finishDraw(g);
      } catch (e) {
        setNotice({ kind: "error", text: `Could not create annotation: ${e.message}` });
      } finally {
        setDraft(null);
      }
    }
  };

  // --- selection actions ---------------------------------------------------

  const deleteSelection = useCallback(() => {
    const { editor: s, selectionId: id } = liveRef.current;
    if (!s?.doc || !id) return;
    const target = getAnnotation(s.doc, id);
    if (!target || target.locked) return;
    setEditor({ doc: removeAnnotation(s.doc, id), history: commitHistory(s.history, s.doc) });
    setSelectionId(null);
  }, []);

  const toggleLock = () => {
    const { editor: s, selectionId: id } = liveRef.current;
    const target = s?.doc && id ? getAnnotation(s.doc, id) : null;
    if (!target) return;
    setEditor({ doc: setAnnotationLock(s.doc, id, !target.locked), history: commitHistory(s.history, s.doc) });
  };

  const reorderSelection = (direction) => {
    const { editor: s, selectionId: id } = liveRef.current;
    const target = s?.doc && id ? getAnnotation(s.doc, id) : null;
    if (!target || target.locked) return;
    setEditor({ doc: reorderZ(s.doc, id, direction), history: commitHistory(s.history, s.doc) });
  };

  const applyText = () => {
    const { editor: s, selectionId: id } = liveRef.current;
    const target = s?.doc && id ? getAnnotation(s.doc, id) : null;
    if (!target || target.locked || !isTextLike(target)) return;
    setEditor({
      doc: updateAnnotation(s.doc, id, (a) => withText(a, textValue)),
      history: commitHistory(s.history, s.doc),
    });
  };

  const applyStrokePatch = (patch) => {
    const { editor: s, selectionId: id } = liveRef.current;
    const target = s?.doc && id ? getAnnotation(s.doc, id) : null;
    if (!target || target.locked) return;
    setEditor({
      doc: updateAnnotation(s.doc, id, (a) => withStyle(a, patch)),
      history: commitHistory(s.history, s.doc),
    });
  };

  // --- zoom / keyboard -----------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const { editor: s } = liveRef.current;
      if (!s?.doc) return;
      const rect = canvas.getBoundingClientRect();
      const sx = (e.clientX - rect.left) * (canvas.width / Math.max(1, rect.width));
      const sy = (e.clientY - rect.top) * (canvas.height / Math.max(1, rect.height));
      setViewport((v) => zoomAt(v, { x: sx, y: sy }, v.zoom * Math.exp(-e.deltaY * 0.0015)));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === " ") spaceDownRef.current = true;
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "");
      if (inField) return;
      if ((e.key === "Delete" || e.key === "Backspace") && liveRef.current.selectionId) {
        e.preventDefault();
        deleteSelection();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        doUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        doRedo();
      } else if (e.key === "Escape") {
        setSelectionId(null);
      }
    };
    const onKeyUp = (e) => {
      if (e.key === " ") spaceDownRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [deleteSelection, doUndo, doRedo]);

  // --- save / export -------------------------------------------------------

  const onSave = () => {
    const { editor: s } = liveRef.current;
    if (!s?.doc || !services.store) return;
    try {
      saveProject(services.store, s.doc);
      clearDraft(services.store);
      setNotice({ kind: "ok", text: "Project saved locally." });
    } catch (e) {
      setNotice({ kind: "error", text: `Save failed: ${e.message}` });
    }
  };

  const onExport = async () => {
    const { editor: s, bitmap: image } = liveRef.current;
    if (!s?.doc || !image) return;
    setBusy(true);
    try {
      const caps = services.caps;
      const format = exportFormat;
      const quality = exportQuality;
      const artifact = await flattenDocument({
        doc: s.doc,
        sourceImage: image,
        format,
        createCanvas: caps.createCanvas,
        encodeRaster: async ({ canvas, width, height }) => {
          if (isNativeBlobFormat(format)) {
            // PNG/JPEG/WebP: the browser's own encoder. Quality applies to
            // the lossy formats; PNG ignores it.
            const blob = await new Promise((resolve) =>
              canvas.toBlob((b) => resolve(b), exportMimeForFormat(format), format === "png" ? undefined : quality),
            );
            if (!blob) throw new Error("toBlob returned null");
            return new Uint8Array(await blob.arrayBuffer());
          }
          // GIF/TIFF/BMP: pixel encoders from raw RGBA bytes.
          const ctx = canvas.getContext("2d");
          const { data } = ctx.getImageData(0, 0, width, height);
          if (format === "gif") return encodeGif(data, width, height);
          if (format === "tiff") return encodeTiff(data, width, height);
          return encodeBmp(data, width, height);
        },
      });
      const url = URL.createObjectURL(new Blob([artifact.bytes], { type: artifact.mime }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `forge-capture-${s.doc.id}.${exportExtensionForFormat(format)}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setNotice({
        kind: "ok",
        text: `Exported ${exportLabelForFormat(format)} at ${artifact.width}×${artifact.height}. Blur/blackout are baked into pixels — the file carries no editable layers.`,
      });
    } catch (e) {
      setNotice({ kind: "error", text: `Export failed: ${e.message}` });
    } finally {
      setBusy(false);
    }
  };

  const onPaste = (e) => {
    const file = e.clipboardData?.files?.[0];
    if (file) {
      e.preventDefault();
      loadFile(file);
    }
  };

  const zoomBy = (factor) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const center = { x: canvas.width / 2, y: canvas.height / 2 };
    setViewport((v) => zoomAt(v, center, v.zoom * factor));
  };

  const fitToScreen = () => {
    const { editor: s } = liveRef.current;
    if (!s?.doc) return;
    sizeCanvasToWrapper();
    const canvas = canvasRef.current;
    if (canvas) setViewport(fitViewport(s.doc.canvas.width, s.doc.canvas.height, canvas.width, canvas.height));
  };

  // --- render --------------------------------------------------------------

  return (
    <div data-testid="capture-host" className="flex h-full flex-col" onPaste={onPaste}>
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Capture</h1>
          <p className="text-sm text-gray-500">
            {doc
              ? `${doc.canvas.width}×${doc.canvas.height} · ${doc.annotations.length} annotation${doc.annotations.length === 1 ? "" : "s"}`
              : "Screenshot & image markup — annotations live in source-image pixels"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="rounded border border-gray-300 px-3 py-2 text-sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            {doc ? "Replace image" : "Open image"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              loadFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button type="button" className="rounded border border-gray-300 px-3 py-2 text-sm disabled:opacity-40" onClick={onSave} disabled={!doc || busy}>
            Save
          </button>
          <label className="flex items-center gap-1 text-sm text-gray-600">
            Format
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value)}
              disabled={!doc || busy}
              aria-label="Export format"
              className="rounded border border-gray-300 px-2 py-2 text-sm"
            >
              {EXPORT_FORMATS.map((f) => (
                <option key={f} value={f}>{exportLabelForFormat(f)}</option>
              ))}
            </select>
          </label>
          {(exportFormat === "jpeg" || exportFormat === "webp") && (
            <label className="flex items-center gap-1 text-sm text-gray-600" title="Export quality">
              Quality
              <input
                type="range"
                min={0.5}
                max={1}
                step={0.01}
                value={exportQuality}
                onChange={(e) => setExportQuality(Number(e.target.value))}
                disabled={!doc || busy}
                aria-label="Export quality"
                className="w-24"
              />
            </label>
          )}
          <button type="button" className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40" onClick={onExport} disabled={!doc || busy}>
            {busy ? "Working…" : "Export"}
          </button>
        </div>
      </div>

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`border-b px-6 py-2 text-sm ${notice.kind === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-green-200 bg-green-50 text-green-800"}`}
        >
          {notice.text}
          <button type="button" className="ml-4 underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {recovered && (
        <div role="alert" className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
          Found an unsaved draft from your last session.
          <button type="button" className="ml-4 rounded border border-amber-400 px-2 py-1" onClick={restoreRecovered}>Restore draft</button>
          <button type="button" className="ml-2 underline" onClick={discardRecovered}>Discard</button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex w-36 flex-col gap-1 overflow-y-auto border-r border-gray-200 p-2" role="toolbar" aria-label="Annotation tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              data-tool={t.id}
              onClick={() => setTool(t.id)}
              aria-pressed={tool === t.id}
              className={`rounded px-3 py-2 text-left text-sm ${tool === t.id ? "bg-blue-600 text-white" : "text-gray-700 hover:bg-gray-100"}`}
            >
              {t.label}
            </button>
          ))}
          <div className="mt-2 border-t border-gray-200 pt-2 text-xs text-gray-500">
            <p>Wheel: zoom</p>
            <p>Middle-drag / Space-drag: pan</p>
            <p>Del: remove · Ctrl+Z: undo</p>
          </div>
        </div>

        <div ref={wrapRef} className="relative min-w-0 flex-1 bg-gray-900">
          {!doc ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-300"
            >
              <span className="text-lg font-medium">Open a PNG, JPEG, or WebP to start</span>
              <span className="text-sm text-gray-400">…or paste a screenshot from your clipboard (Ctrl+V)</span>
              <span className="text-xs text-gray-500">SVG and GIF are rejected · images are re-encoded on import, metadata stripped</span>
            </button>
          ) : (
            <canvas
              ref={canvasRef}
              data-testid="capture-canvas"
              className="absolute inset-0 h-full w-full touch-none"
              style={{ cursor: tool === "select" ? "default" : "crosshair" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          )}
        </div>

        <div className="flex w-72 flex-col gap-4 overflow-y-auto border-l border-gray-200 p-4">
          <section>
            <h2 className="text-sm font-semibold text-gray-900">View</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="rounded border border-gray-300 px-2 py-1 text-sm" onClick={() => zoomBy(1.25)} disabled={!doc}>+</button>
              <button type="button" className="rounded border border-gray-300 px-2 py-1 text-sm" onClick={() => zoomBy(0.8)} disabled={!doc}>−</button>
              <button type="button" className="rounded border border-gray-300 px-2 py-1 text-sm" onClick={fitToScreen} disabled={!doc}>Fit</button>
              <span className="px-2 py-1 text-sm text-gray-500">{Math.round(viewport.zoom * 100)}%</span>
              <button type="button" className="rounded border border-gray-300 px-2 py-1 text-sm disabled:opacity-40" onClick={doUndo} disabled={!canUndo(history)}>Undo</button>
              <button type="button" className="rounded border border-gray-300 px-2 py-1 text-sm disabled:opacity-40" onClick={doRedo} disabled={!canRedo(history)}>Redo</button>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-gray-900">Selection</h2>
            {!selected ? (
              <p className="mt-1 text-sm text-gray-500">Nothing selected. Use the Select tool and click an annotation.</p>
            ) : (
              <div className="mt-2 flex flex-col gap-2 text-sm">
                <p className="text-gray-700">
                  <span className="font-medium capitalize">{selected.type.replace("-", " ")}</span>
                  {isRedaction(selected) && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">redaction</span>}
                  {selected.locked && <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-700">locked</span>}
                  {selected.type === "step-marker" && selected.stepNumber != null && (
                    <span className="ml-2 text-gray-500">step {selected.stepNumber}</span>
                  )}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="rounded border border-gray-300 px-2 py-1" onClick={toggleLock} disabled={busy}>
                    {selected.locked ? "Unlock" : "Lock"}
                  </button>
                  <button type="button" className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40" onClick={deleteSelection} disabled={selected.locked || busy}>
                    Delete
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40" onClick={() => reorderSelection("front")} disabled={selected.locked}>Bring to front</button>
                  <button type="button" className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40" onClick={() => reorderSelection("forward")} disabled={selected.locked}>Forward</button>
                  <button type="button" className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40" onClick={() => reorderSelection("backward")} disabled={selected.locked}>Backward</button>
                  <button type="button" className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40" onClick={() => reorderSelection("back")} disabled={selected.locked}>Send to back</button>
                </div>

                {isTextLike(selected) && (
                  <div className="flex flex-col gap-1">
                    <label htmlFor="capture-text" className="text-xs text-gray-500">Text</label>
                    <textarea
                      id="capture-text"
                      rows={3}
                      className="rounded border border-gray-300 p-2"
                      value={textValue}
                      disabled={selected.locked}
                      onChange={(e) => setTextValue(e.target.value)}
                    />
                    <button type="button" className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40" onClick={applyText} disabled={selected.locked}>
                      Apply text
                    </button>
                  </div>
                )}

                {!isRedaction(selected) && (
                  <div className="flex items-center gap-2">
                    <label htmlFor="capture-stroke" className="text-xs text-gray-500">Color</label>
                    <input
                      id="capture-stroke"
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(selected.style.stroke) ? selected.style.stroke : "#2563eb"}
                      disabled={selected.locked}
                      onChange={(e) => applyStrokePatch({ stroke: e.target.value })}
                    />
                    <label htmlFor="capture-width" className="text-xs text-gray-500">Width</label>
                    <input
                      id="capture-width"
                      type="range"
                      min={1}
                      max={24}
                      value={selected.style.strokeWidth ?? 3}
                      disabled={selected.locked}
                      onChange={(e) => applyStrokePatch({ strokeWidth: Number(e.target.value) })}
                    />
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="text-xs text-gray-500">
            <h2 className="text-sm font-semibold text-gray-900">Redaction guarantee</h2>
            <p className="mt-1">
              Blur and blackout are baked into pixels when you export. The PNG carries no layers —
              removing a redaction afterwards cannot reveal what was underneath.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
