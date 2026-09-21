// Comprehensive core-interaction coverage: all 11 tools, geometry edge cases,
// hit testing, locking, z-order, step renumbering, 50-level history, schema
// behavior, all-or-nothing corruption, and viewport/source-pixel stability.

import { describe, expect, it } from "vitest";
import {
  ANNOTATION_TYPES,
  createAnnotation,
  isRedaction,
  withGeometry,
} from "../annotations.js";
import {
  addAnnotation,
  createDocument,
  moveAnnotation,
  removeAnnotation,
  reorderZ,
  setAnnotationLock,
  updateAnnotation,
} from "../document.js";
import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  commitHistory,
  emptyHistory,
  redoHistory,
  undoHistory,
} from "../history.js";
import {
  createViewport,
  hitTest,
  imageToScreen,
  moveGeometry,
  normalizeRect,
  pointInEllipse,
  pointInRect,
  resizeRect,
  screenToImage,
  zoomAt,
} from "../geometry.js";
import { deserializeProject, serializeProject, CorruptProjectError, UnsupportedVersionError } from "../schema.js";

function makeDoc(id = "interaction-doc") {
  return createDocument({
    id,
    width: 200,
    height: 100,
    source: { kind: "embedded", mime: "image/png", bytes: "aGVsbG8=" },
  });
}

function geometryFor(type) {
  if (type === "arrow" || type === "line") return { points: [[0, 0], [10, 10]] };
  if (type === "freehand" || type === "highlight") return { points: [[0, 0], [5, 6], [10, 0]] };
  return { x: 1, y: 2, w: 30, h: 20 };
}

describe("all 11 annotation tools", () => {
  it("exposes exactly 11 types", () => {
    expect(ANNOTATION_TYPES).toHaveLength(11);
  });

  it.each(ANNOTATION_TYPES)("%s creates a valid frozen annotation", (type) => {
    const annotation = createAnnotation(type, geometryFor(type), { id: `tool-${type}` });
    expect(annotation.type).toBe(type);
    expect(annotation.id).toBe(`tool-${type}`);
    expect(Object.isFrozen(annotation)).toBe(true);
    expect(annotation.locked).toBe(false);
    expect(annotation.z).toBe(0);
  });

  it("text-like types carry text; callout carries an anchor", () => {
    const text = createAnnotation("text", geometryFor("text"), { id: "t", text: "hello" });
    expect(text.text).toBe("hello");
    const callout = createAnnotation("callout", geometryFor("callout"), { id: "c", text: "note", anchor: { x: 9, y: 9 } });
    expect(callout.anchor).toEqual({ x: 9, y: 9 });
    const step = createAnnotation("step-marker", geometryFor("step-marker"), { id: "s" });
    expect(step.stepNumber).toBeNull(); // assigned on document add
  });

  it("only blur and blackout are redactions", () => {
    const redacting = ANNOTATION_TYPES.filter((type) =>
      isRedaction(createAnnotation(type, geometryFor(type), { id: `red-${type}` })),
    );
    expect(redacting.sort()).toEqual(["blackout", "blur"]);
  });
});

describe("geometry edge cases", () => {
  it("normalizes negative rects", () => {
    expect(normalizeRect({ x: 30, y: 20, w: -10, h: -8 })).toEqual({ x: 20, y: 12, w: 10, h: 8 });
  });

  it("createAnnotation normalizes inverted drags", () => {
    const a = createAnnotation("rectangle", { x: 30, y: 30, w: -20, h: -10 }, { id: "inv" });
    expect(a.geometry).toEqual({ x: 10, y: 20, w: 20, h: 10 });
  });

  it("moveGeometry translates both rects and point paths", () => {
    expect(moveGeometry({ x: 1, y: 2, w: 4, h: 4 }, 5, -2)).toEqual({ x: 6, y: 0, w: 4, h: 4 });
    expect(moveGeometry({ points: [[1, 1], [3, 4]] }, 5, -2)).toEqual({ points: [[6, -1], [8, 2]] });
  });

  it("resizeRect handles all corners and enforces a minimum size", () => {
    const base = { x: 10, y: 10, w: 20, h: 20 };
    expect(resizeRect(base, "se", 5, 5)).toEqual({ x: 10, y: 10, w: 25, h: 25 });
    expect(resizeRect(base, "nw", -5, -5)).toEqual({ x: 5, y: 5, w: 25, h: 25 });
    expect(resizeRect(base, "ne", 5, -5)).toEqual({ x: 10, y: 5, w: 25, h: 25 });
    expect(resizeRect(base, "sw", -5, 5)).toEqual({ x: 5, y: 10, w: 25, h: 25 });
    expect(resizeRect(base, "n", 0, -5)).toEqual({ x: 10, y: 5, w: 20, h: 25 });
    expect(resizeRect(base, "se", -100, -100)).toEqual({ x: 10, y: 10, w: 1, h: 1 });
  });

  it("pointInRect honors tolerance", () => {
    const r = { x: 10, y: 10, w: 10, h: 10 };
    expect(pointInRect({ x: 10, y: 10 }, r, 0)).toBe(true);
    expect(pointInRect({ x: 5, y: 10 }, r, 0)).toBe(false);
    expect(pointInRect({ x: 5, y: 10 }, r, 6)).toBe(true);
  });

  it("pointInEllipse rejects corners", () => {
    const e = { x: 0, y: 0, w: 20, h: 10 };
    expect(pointInEllipse({ x: 10, y: 5 }, e)).toBe(true);
    expect(pointInEllipse({ x: 19, y: 9 }, e)).toBe(false);
  });
});

describe("hit testing", () => {
  function docWith(rects) {
    let doc = makeDoc();
    rects.forEach(([id, geometry]) => {
      doc = addAnnotation(doc, createAnnotation("rectangle", geometry, { id }));
    });
    return doc;
  }

  // Mirrors the host's selection helper: highest z first.
  function topmostAt(doc, point) {
    const ordered = [...doc.annotations].sort((a, b) => b.z - a.z);
    return ordered.find((a) => hitTest(a, point)) ?? null;
  }

  it("hitTest finds rects, lines, and freehand paths", () => {
    expect(hitTest(createAnnotation("rectangle", { x: 10, y: 10, w: 20, h: 20 }, { id: "r" }), { x: 15, y: 15 })).toBe(true);
    expect(hitTest(createAnnotation("rectangle", { x: 10, y: 10, w: 20, h: 20 }, { id: "r" }), { x: 40, y: 40 })).toBe(false);
    expect(hitTest(createAnnotation("line", { points: [[0, 0], [20, 0]] }, { id: "l" }), { x: 10, y: 1 })).toBe(true);
    expect(hitTest(createAnnotation("line", { points: [[0, 0], [20, 0]] }, { id: "l" }), { x: 10, y: 20 })).toBe(false);
    expect(
      hitTest(createAnnotation("freehand", { points: [[0, 0], [10, 0], [20, 0]] }, { id: "f" }), { x: 5, y: 2 }),
    ).toBe(true);
    expect(hitTest(createAnnotation("ellipse", { x: 0, y: 0, w: 20, h: 10 }, { id: "e" }), { x: 10, y: 5 })).toBe(true);
    expect(hitTest(createAnnotation("ellipse", { x: 0, y: 0, w: 20, h: 10 }, { id: "e" }), { x: 19, y: 9 })).toBe(false);
  });

  it("topmostAt picks the highest z among overlapping annotations", () => {
    const doc = docWith([
      ["bottom", { x: 0, y: 0, w: 50, h: 50 }],
      ["top", { x: 10, y: 10, w: 50, h: 50 }],
    ]);
    expect(topmostAt(doc, { x: 15, y: 15 }).id).toBe("top");
    expect(topmostAt(doc, { x: 5, y: 5 }).id).toBe("bottom");
    expect(topmostAt(doc, { x: 100, y: 90 })).toBeNull();
  });
});

describe("locking", () => {
  function lockedDoc() {
    let doc = makeDoc();
    doc = addAnnotation(doc, createAnnotation("rectangle", geometryFor("rectangle"), { id: "r1" }));
    doc = addAnnotation(doc, createAnnotation("rectangle", geometryFor("rectangle"), { id: "r2" }));
    return setAnnotationLock(doc, "r1", true);
  }

  it("locked annotations refuse move/update/delete/reorder (same reference)", () => {
    const doc = lockedDoc();
    const r1 = doc.annotations.find((a) => a.id === "r1");
    expect(moveAnnotation(doc, "r1", 9, 9)).toBe(doc);
    expect(updateAnnotation(doc, "r1", (a) => withGeometry(a, moveGeometry(a.geometry, 1, 1)))).toBe(doc);
    expect(removeAnnotation(doc, "r1")).toBe(doc);
    expect(reorderZ(doc, "r1", "front")).toBe(doc);
    expect(r1.locked).toBe(true);
  });

  it("locking is allowed even on a locked annotation (unlock path)", () => {
    const doc = lockedDoc();
    const unlocked = setAnnotationLock(doc, "r1", false);
    expect(unlocked.annotations.find((a) => a.id === "r1").locked).toBe(false);
    // Redundant lock state returns the same reference.
    expect(setAnnotationLock(doc, "r1", true)).toBe(doc);
  });

  it("unlocked annotations still edit", () => {
    const doc = lockedDoc();
    const moved = moveAnnotation(doc, "r2", 9, 9);
    expect(moved).not.toBe(doc);
    expect(moved.annotations.find((a) => a.id === "r2").geometry).toEqual({ x: 10, y: 11, w: 30, h: 20 });
  });
});

describe("z-order", () => {
  function three() {
    let doc = makeDoc();
    doc = addAnnotation(doc, createAnnotation("rectangle", geometryFor("rectangle"), { id: "a" }));
    doc = addAnnotation(doc, createAnnotation("rectangle", geometryFor("rectangle"), { id: "b" }));
    doc = addAnnotation(doc, createAnnotation("rectangle", geometryFor("rectangle"), { id: "c" }));
    return doc; // a:0, b:1, c:2
  }

  it("reorderZ front/back/forward/backward keeps canonical 0..n-1", () => {
    expect(reorderZ(three(), "a", "front").annotations.map((a) => a.id)).toEqual(["b", "c", "a"]);
    expect(reorderZ(three(), "c", "back").annotations.map((a) => a.id)).toEqual(["c", "a", "b"]);
    expect(reorderZ(three(), "a", "forward").annotations.map((a) => a.id)).toEqual(["b", "a", "c"]);
    expect(reorderZ(three(), "c", "backward").annotations.map((a) => a.id)).toEqual(["a", "c", "b"]);
    const again = reorderZ(three(), "a", "front");
    expect(again.annotations.map((a) => a.z)).toEqual([0, 1, 2]);
  });

  it("unknown ids throw", () => {
    expect(() => reorderZ(three(), "nope", "front")).toThrow();
  });
});

describe("step renumbering", () => {
  function steps() {
    let doc = makeDoc();
    doc = addAnnotation(doc, createAnnotation("step-marker", geometryFor("step-marker"), { id: "s1" }));
    doc = addAnnotation(doc, createAnnotation("step-marker", geometryFor("step-marker"), { id: "s2" }));
    doc = addAnnotation(doc, createAnnotation("step-marker", geometryFor("step-marker"), { id: "s3" }));
    return doc;
  }

  it("numbers steps 1..n in z order", () => {
    const doc = steps();
    expect(doc.annotations.map((a) => a.stepNumber)).toEqual([1, 2, 3]);
  });

  it("renumbers after removal", () => {
    const doc = removeAnnotation(steps(), "s2");
    expect(doc.annotations.map((a) => [a.id, a.stepNumber])).toEqual([["s1", 1], ["s3", 2]]);
  });

  it("renumbers after z reorder", () => {
    const doc = reorderZ(steps(), "s1", "front");
    expect(doc.annotations.map((a) => [a.id, a.stepNumber])).toEqual([["s2", 1], ["s3", 2], ["s1", 3]]);
  });
});

describe("history", () => {
  it(`keeps at most ${HISTORY_LIMIT} entries`, () => {
    expect(HISTORY_LIMIT).toBe(50);
    let doc = makeDoc();
    let history = emptyHistory();
    for (let i = 0; i < 60; i += 1) {
      history = commitHistory(history, doc);
      doc = addAnnotation(doc, createAnnotation("rectangle", geometryFor("rectangle"), { id: `r${i}` }));
    }
    expect(history.past).toHaveLength(50);
    expect(canUndo(history)).toBe(true);
    // 60 commits → 10 oldest dropped; undoing 50 lands on the 10-annotation doc.
    let cursor = history;
    let current = doc;
    for (let i = 0; i < 50; i += 1) {
      const result = undoHistory(cursor, current);
      cursor = result.history;
      current = result.document;
    }
    expect(current.annotations).toHaveLength(10);
    expect(canUndo(cursor)).toBe(false);
    expect(undoHistory(cursor, current).document).toBe(current); // empty undo: same ref
  });

  it("redo replays and a new commit invalidates redo", () => {
    let doc = makeDoc();
    let history = emptyHistory();
    history = commitHistory(history, doc);
    const doc2 = addAnnotation(doc, createAnnotation("rectangle", geometryFor("rectangle"), { id: "x" }));
    const undone = undoHistory(history, doc2);
    expect(undone.document.annotations).toHaveLength(0);
    expect(canRedo(undone.history)).toBe(true);
    const redone = redoHistory(undone.history, undone.document);
    expect(redone.document.annotations).toHaveLength(1);
    expect(canRedo(redone.history)).toBe(false);
    // A new commit after undo clears the redo stack.
    const fresh = commitHistory(undone.history, undone.document);
    expect(canRedo(fresh)).toBe(false);
    expect(redoHistory(fresh, undone.document).document).toBe(undone.document); // empty redo: same ref
  });
});

describe("project schema", () => {
  it("round-trips and is deterministic", () => {
    let doc = makeDoc();
    doc = addAnnotation(doc, createAnnotation("arrow", { points: [[0, 0], [5, 5]] }, { id: "a1" }));
    const one = serializeProject(doc);
    const two = serializeProject(doc);
    expect(one).toBe(two);
    const back = deserializeProject(JSON.parse(one));
    expect(back.id).toBe(doc.id);
    expect(back.annotations).toHaveLength(1);
  });

  it("rejects malformed bodies", () => {
    expect(() => deserializeProject(null)).toThrow(CorruptProjectError);
    expect(() => deserializeProject({})).toThrow(CorruptProjectError);
    expect(() => deserializeProject({ kind: "wrong", schemaVersion: 1 })).toThrow(CorruptProjectError);
    expect(() => deserializeProject({ kind: "forge-capture-project", schemaVersion: 1 })).toThrow(CorruptProjectError);
  });

  it("rejects future versions without guessing", () => {
    expect(() =>
      deserializeProject({ kind: "forge-capture-project", schemaVersion: 999, id: "x" }),
    ).toThrow(UnsupportedVersionError);
  });

  it("rejects unknown annotation types (whole project, all-or-nothing)", () => {
    let doc = makeDoc();
    doc = addAnnotation(doc, createAnnotation("rectangle", geometryFor("rectangle"), { id: "good" }));
    const body = JSON.parse(serializeProject(doc));
    body.annotations.push({ id: "bad", type: "mystery", z: 1, geometry: {}, style: {}, locked: false });
    expect(() => deserializeProject(body)).toThrow(CorruptProjectError);
  });

  it("rejects non-canonical z sequences", () => {
    let doc = makeDoc();
    doc = addAnnotation(doc, createAnnotation("rectangle", geometryFor("rectangle"), { id: "a" }));
    doc = addAnnotation(doc, createAnnotation("rectangle", geometryFor("rectangle"), { id: "b" }));
    const body = JSON.parse(serializeProject(doc));
    body.annotations[1].z = 5; // gap: not 0..n-1
    expect(() => deserializeProject(body)).toThrow(CorruptProjectError);
    body.annotations[1].z = 0; // duplicate
    expect(() => deserializeProject(body)).toThrow(CorruptProjectError);
  });
});

describe("viewport / source-pixel stability", () => {
  it("annotations are untouched by pan/zoom (source pixels authoritative)", () => {
    let doc = makeDoc();
    doc = addAnnotation(doc, createAnnotation("rectangle", geometryFor("rectangle"), { id: "r" }));
    const before = JSON.stringify(doc.annotations);
    let viewport = createViewport();
    viewport = zoomAt(viewport, { x: 50, y: 50 }, 3);
    viewport = { ...viewport, panX: 120, panY: -40 };
    expect(JSON.stringify(doc.annotations)).toBe(before);
    const zoomed = zoomAt(createViewport(), { x: 50, y: 50 }, 3);
    expect(zoomed.zoom).toBe(3);
  });

  it("screen/image conversion round-trips through arbitrary viewport states", () => {
    let viewport = createViewport();
    viewport = zoomAt(viewport, { x: 320, y: 200 }, 2.5);
    viewport = { ...viewport, panX: viewport.panX + 130, panY: viewport.panY - 70 };
    for (const [x, y] of [[0, 0], [33.5, 77.25], [199, 99]]) {
      const screen = imageToScreen(viewport, { x, y });
      const back = screenToImage(viewport, screen);
      expect(back.x).toBeCloseTo(x, 9);
      expect(back.y).toBeCloseTo(y, 9);
    }
  });

  it("zoomAt keeps the screen anchor fixed", () => {
    const viewport = createViewport();
    const screen = imageToScreen(viewport, { x: 40, y: 30 });
    const zoomed = zoomAt(viewport, screen, 4);
    const screen2 = imageToScreen(zoomed, { x: 40, y: 30 });
    expect(screen2.x).toBeCloseTo(screen.x, 9);
    expect(screen2.y).toBeCloseTo(screen.y, 9);
  });
});
