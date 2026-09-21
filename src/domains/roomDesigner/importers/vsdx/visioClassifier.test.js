import { describe, expect, it } from "vitest";
import { classifyShape } from "./visioClassifier.js";

const rect = (x0, y0, x1, y1) => ({
  points: [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ],
  closed: true,
  allLines: true,
});
const line = (x0, y0, x1, y1) => ({
  points: [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ],
  closed: false,
  allLines: true,
});
const features = (over) => ({
  polylines: [],
  text: "",
  isOneD: false,
  hasRasterImage: false,
  masterNameU: "",
  masterName: "",
  shapeNameU: "",
  ...over,
});

describe("visioClassifier hard rules", () => {
  it("a flowchart connector is an annotation, never a pipe", () => {
    const c = classifyShape(null, features({
      polylines: [line(0, 0, 5, 5)],
      isOneD: true,
      text: "Yes",
      shapeNameU: "Decision connector",
    }));
    expect(c.kind).toBe("annotation");
    expect(c.reason).toMatch(/not a pipe/i);
  });

  it("a plumbing connector earns a pipe", () => {
    const c = classifyShape(null, features({
      polylines: [line(0, 0, 10, 0)],
      isOneD: true,
      masterNameU: "Pipe run",
    }));
    expect(c.kind).toBe("pipe");
  });

  it("a rectangle alone is an annotation, never a room", () => {
    const c = classifyShape(null, features({
      polylines: [rect(0, 0, 10, 8)],
      masterNameU: "Rectangle",
    }));
    expect(c.kind).toBe("annotation");
  });

  it("a long line alone is an annotation, never a wall", () => {
    const c = classifyShape(null, features({
      polylines: [line(0, 0, 120, 0)],
      masterNameU: "Line",
    }));
    expect(c.kind).toBe("annotation");
  });
});

describe("visioClassifier strong-evidence mapping", () => {
  it("wall master + straight segment → wall", () => {
    const c = classifyShape(null, features({
      polylines: [line(0, 0, 120, 0)],
      masterNameU: "Wall",
    }));
    expect(c.kind).toBe("wall");
    expect(c.detail.a).toMatchObject({ x: 0, y: 0 });
    expect(c.detail.b).toMatchObject({ x: 120, y: 0 });
  });

  it("wall master drawn as a long thin rectangle → wall centerline", () => {
    const c = classifyShape(null, features({
      polylines: [rect(0, 0, 120, 4)],
      masterNameU: "Wall",
    }));
    expect(c.kind).toBe("wall");
    expect(c.detail.approximated).toBe("thin-rectangle-centerline");
  });

  it("room evidence + closed outline → room", () => {
    const c = classifyShape(null, features({
      polylines: [rect(0, 0, 144, 120)],
      masterNameU: "Room",
      text: "Living Room",
    }));
    expect(c.kind).toBe("room");
    expect(c.detail.label).toBe("Living Room");
  });

  it("room evidence with zero area → annotation (no degenerate room)", () => {
    const c = classifyShape(null, features({
      polylines: [{ ...rect(0, 0, 0.01, 0.01), closed: true }],
      masterNameU: "Room",
    }));
    expect(c.kind).toBe("annotation");
  });

  it("door master at real size → opening", () => {
    const c = classifyShape(null, features({
      polylines: [rect(0, 0, 36, 2)],
      masterNameU: "Door",
    }));
    expect(c.kind).toBe("opening");
    expect(c.detail.openingType).toBe("door");
  });

  it("tiny door master → annotation (cannot resolve safely)", () => {
    const c = classifyShape(null, features({
      polylines: [rect(0, 0, 2, 1)],
      masterNameU: "Door",
    }));
    expect(c.kind).toBe("annotation");
  });

  it("recognized valve stencil → piping symbol", () => {
    const c = classifyShape(null, features({
      polylines: [rect(0, 0, 4, 4)],
      masterNameU: "Gate valve",
    }));
    expect(c.kind).toBe("symbol");
    expect(c.detail).toMatchObject({ domain: "piping", symbolId: "gate-valve" });
  });

  it("known furniture master → furniture catalog entry", () => {
    const c = classifyShape(null, features({
      polylines: [rect(0, 0, 84, 36)],
      masterNameU: "Sofa",
    }));
    expect(c.kind).toBe("furniture");
    expect(c.detail.catalogId).toBe("sofa-3seat");
  });

  it("plumbing evidence on an open 2-D run → pipe", () => {
    const c = classifyShape(null, features({
      polylines: [line(0, 0, 10, 5)],
      masterNameU: "Water line",
    }));
    expect(c.kind).toBe("pipe");
  });
});

describe("visioClassifier fallbacks", () => {
  it("raster image → skipped with a reason", () => {
    const c = classifyShape(null, features({ hasRasterImage: true }));
    expect(c.kind).toBe("skipped");
  });

  it("text-only shape → label", () => {
    const c = classifyShape(null, features({ text: "North arrow note" }));
    expect(c.kind).toBe("label");
  });

  it("empty shape with no text → skipped", () => {
    const c = classifyShape(null, features({}));
    expect(c.kind).toBe("skipped");
  });

  it("unrecognized shape with text → annotation", () => {
    const c = classifyShape(null, features({
      polylines: [rect(0, 0, 5, 5)],
      masterNameU: "Squiggle",
      text: "mystery",
    }));
    expect(c.kind).toBe("annotation");
  });

  it("always returns evidence for provenance", () => {
    const c = classifyShape(null, features({ polylines: [line(0, 0, 1, 1)], masterNameU: "X" }));
    expect(typeof c.evidence).toBe("string");
    expect(c.evidence).toContain("X");
  });
});
