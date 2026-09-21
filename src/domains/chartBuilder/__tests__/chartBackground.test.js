import { describe, expect, it } from "vitest";
import {
  ChartError,
  createChartDocument,
  createEdge,
  createNode,
  chartReducer,
  validateOrgDocument,
  DEFAULT_CHART_BACKGROUND,
  getChartBackground,
  isValidChartBackgroundId,
  CHART_BACKGROUNDS,
} from "../index.js";

function orgDoc(background) {
  return createChartDocument({
    id: "doc-1",
    type: "org",
    background,
    nodes: [
      createNode({ id: "ceo", label: "CEO" }),
      createNode({ id: "vp", label: "VP" }),
    ],
    edges: [createEdge({ id: "e1", from: "ceo", to: "vp", type: "supervisor" })],
  });
}

describe("chart backgrounds", () => {
  it("defaults to the white background", () => {
    expect(orgDoc().background).toBe(DEFAULT_CHART_BACKGROUND);
    expect(DEFAULT_CHART_BACKGROUND).toBe("white");
  });

  it("accepts every catalog preset id", () => {
    for (const preset of CHART_BACKGROUNDS) {
      expect(orgDoc(preset.id).background).toBe(preset.id);
      expect(isValidChartBackgroundId(preset.id)).toBe(true);
      expect(getChartBackground(preset.id)).toBe(preset);
    }
  });

  it("rejects unknown background ids instead of inventing them", () => {
    expect(() => orgDoc("hot-pink")).toThrow(ChartError);
    expect(isValidChartBackgroundId("hot-pink")).toBe(false);
    expect(isValidChartBackgroundId(null)).toBe(false);
    expect(getChartBackground("hot-pink")).toBe(null);
  });

  it("survives a JSON serialization round-trip (slice-4 export contract)", () => {
    const doc = orgDoc("blueprint");
    const revived = createChartDocument(JSON.parse(JSON.stringify(doc)));
    expect(revived.background).toBe("blueprint");
    expect(revived.nodes).toHaveLength(2);
  });

  it("SET_BACKGROUND applies and validates through the reducer", () => {
    const applied = chartReducer(orgDoc(), {
      type: "SET_BACKGROUND",
      background: "ocean",
    });
    expect(applied.error).toBe(null);
    expect(applied.state.background).toBe("ocean");

    const rejected = chartReducer(orgDoc(), {
      type: "SET_BACKGROUND",
      background: "not-a-preset",
    });
    expect(rejected.error).toMatch(/unknown chart background/);
    expect(rejected.state.background).toBe(DEFAULT_CHART_BACKGROUND);
  });

  it("slice-1 validators accept documents carrying a background", () => {
    const { valid, errors } = validateOrgDocument(orgDoc("sunrise"));
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    expect(valid).toBe(true);
  });
});
