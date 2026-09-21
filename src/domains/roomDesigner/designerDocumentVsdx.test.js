import { describe, expect, it } from "vitest";
import {
  createEmptyDesign,
  parseDesign,
  serializeDesign,
  validateDesign,
} from "@/domains/roomDesigner/designerDocument";

const goodPath = {
  id: "a1",
  kind: "path",
  points: [
    { x: 0, y: 0 },
    { x: 4, y: 4 },
  ],
};
const goodLabel = {
  id: "a2",
  kind: "label",
  points: [{ x: 1, y: 1 }],
  text: "North",
};

describe("designerDocument annotations", () => {
  it("new designs start with an empty annotations array", () => {
    expect(createEmptyDesign().annotations).toEqual([]);
  });

  it("validates path and label annotations", () => {
    const design = { ...createEmptyDesign(), annotations: [goodPath, goodLabel] };
    expect(validateDesign(design)).toEqual([]);
  });

  it("rejects an unknown annotation kind", () => {
    const design = { ...createEmptyDesign(), annotations: [{ ...goodPath, kind: "spline" }] };
    expect(validateDesign(design).some((e) => /unknown kind/i.test(e))).toBe(true);
  });

  it("rejects an annotation with no valid points", () => {
    const design = { ...createEmptyDesign(), annotations: [{ ...goodPath, points: [] }] };
    expect(validateDesign(design).some((e) => /no valid points/i.test(e))).toBe(true);
  });

  it("rejects a label without text", () => {
    const design = { ...createEmptyDesign(), annotations: [{ ...goodLabel, text: 42 }] };
    expect(validateDesign(design).some((e) => /without text/i.test(e))).toBe(true);
  });

  it("loads documents saved before annotations existed", () => {
    const legacy = { ...createEmptyDesign() };
    delete legacy.annotations;
    const parsed = parseDesign(serializeDesign({ ...legacy, annotations: undefined }));
    // serialize drops undefined; parse must still normalize.
    expect(Array.isArray(parsed.annotations)).toBe(true);
  });

  it("round-trips annotations through serialize/parse", () => {
    const design = { ...createEmptyDesign(), annotations: [goodPath, goodLabel] };
    const parsed = parseDesign(serializeDesign(design));
    expect(parsed.annotations).toHaveLength(2);
    expect(validateDesign(parsed)).toEqual([]);
  });
});
