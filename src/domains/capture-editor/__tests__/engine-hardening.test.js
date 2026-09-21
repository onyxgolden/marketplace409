// FORGE Capture editor — regression tests for the ChatGPT architecture review.
// One focused test per finding: document construction invariants, strict
// hydration, geometry contracts, style/z validation, base64, viewport.

import { describe, expect, it } from "vitest";
import {
  ANNOTATION_TYPES,
  AnnotationError,
  createAnnotation,
  normalizeStyle,
  withStyle,
} from "../annotations.js";
import { addAnnotation, createDocument } from "../document.js";
import { createViewport } from "../geometry.js";
import { SourceRejectedError } from "../limits.js";
import {
  CorruptProjectError,
  PROJECT_KIND,
  UnsupportedVersionError,
  deserializeProject,
  serializeProject,
} from "../schema.js";

const VALID_BYTES = "aGVsbG8="; // "hello" — syntactically valid base64

function validSource(overrides = {}) {
  return { kind: "embedded", mime: "image/png", bytes: VALID_BYTES, ...overrides };
}

function makeDoc(annotations = []) {
  let doc = createDocument({
    id: "doc-1",
    width: 100,
    height: 80,
    source: validSource(),
    createdAt: "2026-09-20T00:00:00.000Z",
  });
  for (const a of annotations) doc = addAnnotation(doc, a);
  return doc;
}

function projectJSON(annotations, source = validSource()) {
  return JSON.stringify({
    schemaVersion: 1,
    kind: PROJECT_KIND,
    id: "doc-1",
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
    canvas: { width: 100, height: 80 },
    source,
    annotations,
  });
}

function rectAnnotation(id, z, type = "rectangle") {
  return {
    id,
    type,
    z,
    geometry: { x: 1, y: 2, w: 10, h: 10 },
    style: {},
    locked: false,
  };
}

describe("finding 1: document construction enforces source invariants", () => {
  it("rejects a 16384x16384 canvas (decoded memory exceeds 128 MB)", () => {
    expect(() =>
      createDocument({ id: "d", width: 16384, height: 16384, source: validSource() }),
    ).toThrow(SourceRejectedError);
  });

  it("accepts a canvas at the decoded-memory boundary", () => {
    // 5656 x 5656 x 4 = 127,977,344 bytes < 128 MiB
    const doc = createDocument({ id: "d", width: 5656, height: 5656, source: validSource() });
    expect(doc.canvas).toEqual({ width: 5656, height: 5656 });
  });

  it("rejects an unsupported source mime at construction", () => {
    expect(() =>
      createDocument({ id: "d", width: 10, height: 10, source: validSource({ mime: "image/gif" }) }),
    ).toThrow(SourceRejectedError);
  });

  it("rejects an embedded source without bytes", () => {
    expect(() =>
      createDocument({ id: "d", width: 10, height: 10, source: { kind: "embedded", mime: "image/png" } }),
    ).toThrow(/bytes/);
  });

  it("rejects a local-ref source without a hex digest", () => {
    expect(() =>
      createDocument({
        id: "d",
        width: 10,
        height: 10,
        source: { kind: "local-ref", mime: "image/png", sha256: "not-a-digest" },
      }),
    ).toThrow(/sha256/);
  });

  it("accepts a well-formed local-ref source", () => {
    const doc = createDocument({
      id: "d",
      width: 10,
      height: 10,
      source: { kind: "local-ref", mime: "image/jpeg", sha256: "a".repeat(64) },
    });
    expect(doc.source.kind).toBe("local-ref");
  });
});

describe("finding 2: unknown annotation types reject the whole project", () => {
  it("throws CorruptProjectError instead of partially hydrating", () => {
    const json = projectJSON([
      rectAnnotation("a1", 0),
      { ...rectAnnotation("a2", 1), type: "hologram" },
    ]);
    expect(() => deserializeProject(json)).toThrow(CorruptProjectError);
  });

  it("still rejects newer schema versions before annotation processing", () => {
    const json = JSON.stringify({
      schemaVersion: 99,
      kind: PROJECT_KIND,
      id: "d",
      createdAt: "x",
      updatedAt: "x",
      canvas: { width: 10, height: 10 },
      source: validSource(),
      annotations: [],
    });
    expect(() => deserializeProject(json)).toThrow(UnsupportedVersionError);
  });
});

describe("finding 3: line/arrow require exactly two points", () => {
  it("rejects a 3-point arrow", () => {
    expect(() =>
      createAnnotation("arrow", { points: [[0, 0], [5, 5], [10, 0]] }),
    ).toThrow(AnnotationError);
  });

  it("rejects a 1-point line", () => {
    expect(() => createAnnotation("line", { points: [[0, 0]] })).toThrow(AnnotationError);
  });

  it("accepts a 2-point line and a 3-point freehand", () => {
    expect(createAnnotation("line", { points: [[0, 0], [10, 10]] }).type).toBe("line");
    expect(
      createAnnotation("freehand", { points: [[0, 0], [5, 5], [10, 0]] }).geometry.points,
    ).toHaveLength(3);
  });
});

describe("finding 4: malformed point tuples become AnnotationError", () => {
  const badPointSets = [
    [[null]],
    [[7]],
    [[{}]],
    [[["a", "b"]]],
    [[[1]]],
    [[[1, 2, 3]]],
    [[[NaN, 0]]],
  ];
  it.each(badPointSets)("rejects points=%j without a raw TypeError", (points) => {
    let thrown = null;
    try {
      createAnnotation("freehand", { points });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AnnotationError);
    expect(thrown).not.toBeInstanceOf(TypeError);
  });
});

describe("finding 5: style contract validation", () => {
  it.each([
    [{ strokeWidth: NaN }, "strokeWidth"],
    [{ strokeWidth: -2 }, "strokeWidth"],
    [{ strokeWidth: "3" }, "strokeWidth"],
    [{ opacity: 2 }, "opacity"],
    [{ opacity: -0.1 }, "opacity"],
    [{ fontSize: 0 }, "fontSize"],
    [{ blurRadius: 0 }, "blurRadius"],
    [{ stroke: "" }, "stroke"],
    [{ stroke: 42 }, "stroke"],
  ])("rejects style %j", (style) => {
    expect(() => createAnnotation("rectangle", { x: 0, y: 0, w: 5, h: 5 }, { style })).toThrow(
      AnnotationError,
    );
  });

  it("rejects a bad style patch in withStyle", () => {
    const a = createAnnotation("rectangle", { x: 0, y: 0, w: 5, h: 5 });
    expect(() => withStyle(a, { opacity: 99 })).toThrow(AnnotationError);
  });

  it("rejects malformed style on import", () => {
    const json = projectJSON([{ ...rectAnnotation("a1", 0), style: { strokeWidth: NaN } }]);
    // NaN does not survive JSON, so use a string width instead — still invalid.
    const parsed = JSON.parse(json);
    parsed.annotations[0].style = { strokeWidth: "huge" };
    expect(() => deserializeProject(JSON.stringify(parsed))).toThrow(CorruptProjectError);
  });

  it("keeps serialize -> deserialize deterministic", () => {
    const doc = makeDoc([
      createAnnotation("rectangle", { x: 0, y: 0, w: 5, h: 5 }, { style: { strokeWidth: 4, opacity: 0.5 } }),
    ]);
    const once = serializeProject(doc);
    const twice = serializeProject(deserializeProject(once));
    expect(twice).toBe(once);
  });

  it("drops unknown style keys instead of smuggling renderer state", () => {
    const out = normalizeStyle({ strokeWidth: 3, cssInjection: "url(evil)" });
    expect(out).toEqual({ strokeWidth: 3 });
  });
});

describe("finding 6: z must be a non-negative integer", () => {
  it.each([[-1], [1.5], [NaN], [Infinity]])("rejects z=%j at creation", (z) => {
    expect(() => createAnnotation("rectangle", { x: 0, y: 0, w: 5, h: 5 }, { z })).toThrow(
      AnnotationError,
    );
  });

  it("re-stamps an invalid incoming z in addAnnotation", () => {
    const doc = makeDoc();
    const bad = { ...createAnnotation("rectangle", { x: 0, y: 0, w: 5, h: 5 }), z: 2.5 };
    const next = addAnnotation(doc, bad);
    expect(next.annotations[0].z).toBe(0);
  });
});

describe("finding 7: imported z-order is unique and canonical", () => {
  it("rejects duplicate z values", () => {
    const json = projectJSON([rectAnnotation("a1", 0), rectAnnotation("a2", 0)]);
    expect(() => deserializeProject(json)).toThrow(/duplicate annotation z/);
  });

  it("rejects a gapped z sequence", () => {
    const json = projectJSON([rectAnnotation("a1", 0), rectAnnotation("a2", 2)]);
    expect(() => deserializeProject(json)).toThrow(/canonical sequence/);
  });

  it("accepts the canonical set regardless of array order", () => {
    const json = projectJSON([rectAnnotation("a1", 1), rectAnnotation("a2", 0)]);
    const doc = deserializeProject(json);
    expect(doc.annotations).toHaveLength(2);
  });
});

describe("finding 8: embedded bytes must be valid base64", () => {
  it("rejects prose that is not base64", () => {
    const json = projectJSON([], validSource({ bytes: "definitely not an image" }));
    expect(() => deserializeProject(json)).toThrow(CorruptProjectError);
  });

  it("rejects base64 with a bad length", () => {
    const json = projectJSON([], validSource({ bytes: "abc" }));
    expect(() => deserializeProject(json)).toThrow(CorruptProjectError);
  });

  it("accepts syntactically valid base64", () => {
    const doc = deserializeProject(projectJSON([]));
    expect(doc.source.bytes).toBe(VALID_BYTES);
  });
});

describe("finding 9: viewport pan must be finite", () => {
  it("rejects NaN/Infinity pan coordinates", () => {
    expect(() => createViewport({ panX: NaN })).toThrow(/pan/);
    expect(() => createViewport({ panY: Infinity })).toThrow(/pan/);
  });

  it("accepts a normal viewport", () => {
    expect(createViewport({ zoom: 2, panX: -10, panY: 4 })).toEqual({ zoom: 2, panX: -10, panY: 4 });
  });
});

describe("review invariants that still hold", () => {
  it("exports all 11 required annotation types", () => {
    expect(ANNOTATION_TYPES).toHaveLength(11);
  });

  it("hydrates a document with every annotation type", () => {
    const anns = [
      { ...rectAnnotation("r", 0, "rectangle") },
      { ...rectAnnotation("e", 1, "ellipse") },
      { id: "l", type: "line", z: 2, geometry: { points: [[0, 0], [3, 4]] }, style: {}, locked: false },
      { id: "a", type: "arrow", z: 3, geometry: { points: [[0, 0], [3, 4]] }, style: {}, locked: false },
      { id: "f", type: "freehand", z: 4, geometry: { points: [[0, 0], [1, 1], [2, 0]] }, style: {}, locked: false },
      { id: "h", type: "highlight", z: 5, geometry: { points: [[0, 0], [1, 1]] }, style: {}, locked: false },
      { ...rectAnnotation("t", 6, "text"), text: "hi" },
      { ...rectAnnotation("c", 7, "callout"), text: "yo", anchor: { x: 50, y: 50 } },
      { ...rectAnnotation("s", 8, "step-marker") },
      { ...rectAnnotation("b", 9, "blur") },
      { ...rectAnnotation("k", 10, "blackout") },
    ];
    const doc = deserializeProject(projectJSON(anns));
    expect(doc.annotations).toHaveLength(11);
    expect(doc.annotations.find((x) => x.id === "s").stepNumber).toBe(1);
  });
});
