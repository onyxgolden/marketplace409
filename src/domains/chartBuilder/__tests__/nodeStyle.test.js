import { describe, expect, it } from "vitest";
import {
  ChartError,
  NODE_STYLE_DEFAULTS,
  createChartDocument,
  createEdge,
  createNode,
  resolveCardPaint,
  resolveDocSettings,
  resolveEdgeWidth,
  resolveNodeStyle,
  styleTextMetrics,
} from "../chartDocument.js";
import { chartReducer } from "../chartReducer.js";
import {
  deserializeChartDocument,
  serializeChartDocument,
} from "../chartPersistence.js";

describe("resolveNodeStyle", () => {
  it("applies defaults for style-less and legacy nodes", () => {
    expect(resolveNodeStyle(undefined)).toEqual(NODE_STYLE_DEFAULTS);
    expect(resolveNodeStyle(null)).toEqual(NODE_STYLE_DEFAULTS);
    expect(resolveNodeStyle({})).toEqual(NODE_STYLE_DEFAULTS);
    const legacy = createNode({ id: "n1", label: "Legacy" });
    expect(legacy.style).toEqual({});
    expect(resolveNodeStyle(legacy.style)).toEqual({
      color: "#1f6feb",
      card: "white",
      textSize: "md",
      bold: false,
      align: "left",
      borderWidth: 1,
    });
  });

  it("keeps explicitly set keys and defaults the rest", () => {
    expect(resolveNodeStyle({ color: "#ef4444" })).toEqual({
      ...NODE_STYLE_DEFAULTS,
      color: "#ef4444",
    });
    expect(
      resolveNodeStyle({ card: "tint", textSize: "lg", bold: true, align: "center" })
    ).toEqual({
      color: "#1f6feb",
      card: "tint",
      textSize: "lg",
      bold: true,
      align: "center",
      borderWidth: 1,
    });
  });

  it("falls back to defaults for unknown enum values instead of throwing", () => {
    expect(resolveNodeStyle({ card: "glossy", textSize: "xl", align: "right" })).toEqual(
      NODE_STYLE_DEFAULTS
    );
  });
});

describe("style validation", () => {
  it("rejects invalid style values at write time", () => {
    expect(() => createNode({ id: "n1", label: "A", style: { card: "glossy" } })).toThrow(
      ChartError
    );
    expect(() => createNode({ id: "n1", label: "A", style: { textSize: "xl" } })).toThrow(
      ChartError
    );
    expect(() => createNode({ id: "n1", label: "A", style: { bold: "yes" } })).toThrow(
      ChartError
    );
    expect(() => createNode({ id: "n1", label: "A", style: { align: "right" } })).toThrow(
      ChartError
    );
    expect(() =>
      createNode({ id: "n1", label: "A", style: { borderWidth: 0 } })
    ).toThrow(ChartError);
    expect(() =>
      createNode({ id: "n1", label: "A", style: { borderWidth: 5 } })
    ).toThrow(ChartError);
    expect(() =>
      createNode({ id: "n1", label: "A", style: { borderWidth: 1.5 } })
    ).toThrow(ChartError);
    expect(() =>
      createNode({ id: "n1", label: "A", style: { borderWidth: "2" } })
    ).toThrow(ChartError);
  });

  it("accepts border widths 1-4 and resolves the default to 1", () => {
    for (const w of [1, 2, 3, 4]) {
      const node = createNode({ id: "n1", label: "A", style: { borderWidth: w } });
      expect(resolveNodeStyle(node.style).borderWidth).toBe(w);
    }
    expect(resolveNodeStyle({}).borderWidth).toBe(1);
    expect(NODE_STYLE_DEFAULTS.borderWidth).toBe(1);
  });

  it("preserves unknown style keys verbatim", () => {
    const node = createNode({ id: "n1", label: "A", style: { sparkle: 9000 } });
    expect(node.style.sparkle).toBe(9000);
    // Unknown keys never leak into the resolved style.
    expect(resolveNodeStyle(node.style)).toEqual(NODE_STYLE_DEFAULTS);
  });
});

describe("styleTextMetrics", () => {
  it("scales truncation limits with text size so text stays inside the card", () => {
    expect(styleTextMetrics("sm").nameLimit).toBe(30);
    expect(styleTextMetrics("md").nameLimit).toBe(26);
    expect(styleTextMetrics("lg").nameLimit).toBe(20);
    // Larger text truncates shorter on every line.
    for (const key of ["nameLimit", "subtitleLimit", "metaLimit"]) {
      expect(styleTextMetrics("lg")[key]).toBeLessThan(styleTextMetrics("md")[key]);
      expect(styleTextMetrics("md")[key]).toBeLessThan(styleTextMetrics("sm")[key]);
    }
  });

  it("grows font sizes with text size and defaults unknown sizes to md", () => {
    expect(styleTextMetrics("sm").name).toBeLessThan(styleTextMetrics("md").name);
    expect(styleTextMetrics("md").name).toBeLessThan(styleTextMetrics("lg").name);
    expect(styleTextMetrics("huge")).toEqual(styleTextMetrics("md"));
  });
});

describe("resolveCardPaint", () => {
  it("renders the classic white card by default", () => {
    expect(resolveCardPaint(undefined)).toEqual({
      fill: "#ffffff",
      stroke: "#1f6feb",
    });
  });

  it("tints the card fill with the accent color", () => {
    expect(resolveCardPaint({ card: "tint", color: "#ff0000" })).toEqual({
      fill: "#ff00001a",
      stroke: "#ff0000",
    });
  });

  it("falls back to a white fill when the accent cannot take an alpha suffix", () => {
    const paint = resolveCardPaint({ card: "tint", color: "red" });
    expect(paint.fill).toBe("#ffffff");
    expect(paint.stroke).toBe("red");
  });

  it("draws an accent border for outline cards; thickness comes from borderWidth", () => {
    expect(resolveCardPaint({ card: "outline", color: "#10b981" })).toEqual({
      fill: "#ffffff",
      stroke: "#10b981",
    });
    expect(resolveNodeStyle({ card: "outline", borderWidth: 4 }).borderWidth).toBe(4);
  });

  it("never reports a border width — resolveNodeStyle owns it", () => {
    expect("strokeWidth" in resolveCardPaint({ borderWidth: 3 })).toBe(false);
  });
});

describe("style patch round-trip", () => {
  it("UPDATE_NODE style patches survive serialize/deserialize", () => {
    const doc = createChartDocument({
      id: "style-rt",
      type: "org",
      nodes: [createNode({ id: "n1", label: "Ada" })],
      edges: [],
    });
    const result = chartReducer(doc, {
      type: "UPDATE_NODE",
      id: "n1",
      patch: {
        style: { color: "#10b981", card: "tint", textSize: "lg", bold: true, align: "center" },
      },
    });
    expect(result.error).toBeNull();
    const patched = result.state.nodes[0];
    expect(patched.style).toMatchObject({
      color: "#10b981",
      card: "tint",
      textSize: "lg",
      bold: true,
      align: "center",
    });

    const envelope = serializeChartDocument(result.state, { title: "Styled" });
    const restored = deserializeChartDocument(envelope);
    expect(restored.nodes[0].style).toMatchObject({
      color: "#10b981",
      card: "tint",
      textSize: "lg",
      bold: true,
      align: "center",
    });
    expect(resolveNodeStyle(restored.nodes[0].style).color).toBe("#10b981");
  });

  it("borderWidth patches survive serialize/deserialize", () => {
    const doc = createChartDocument({
      id: "border-rt",
      type: "org",
      nodes: [createNode({ id: "n1", label: "Ada" })],
      edges: [],
    });
    const result = chartReducer(doc, {
      type: "UPDATE_NODE",
      id: "n1",
      patch: { style: { borderWidth: 3 } },
    });
    expect(result.error).toBeNull();
    expect(resolveNodeStyle(result.state.nodes[0].style).borderWidth).toBe(3);
    const restored = deserializeChartDocument(serializeChartDocument(result.state));
    expect(resolveNodeStyle(restored.nodes[0].style).borderWidth).toBe(3);
  });
});

describe("document settings", () => {
  it("defaults connectorWidth to today's canvas edge width (2)", () => {
    const doc = createChartDocument({ id: "s1", type: "org" });
    expect(resolveDocSettings(doc.settings).connectorWidth).toBe(2);
    expect(resolveDocSettings(undefined).connectorWidth).toBe(2);
    expect(resolveDocSettings(null).connectorWidth).toBe(2);
    expect(resolveDocSettings({}).connectorWidth).toBe(2);
  });

  it("accepts connector widths 1-4", () => {
    for (const w of [1, 2, 3, 4]) {
      const doc = createChartDocument({ id: "s1", type: "org", settings: { connectorWidth: w } });
      expect(resolveDocSettings(doc.settings).connectorWidth).toBe(w);
    }
  });

  it("rejects invalid connector widths at write time", () => {
    for (const bad of [0, 5, 1.5, "2", NaN]) {
      expect(() =>
        createChartDocument({ id: "s1", type: "org", settings: { connectorWidth: bad } })
      ).toThrow(ChartError);
    }
  });

  it("preserves unknown settings keys verbatim", () => {
    const doc = createChartDocument({
      id: "s1",
      type: "org",
      settings: { connectorWidth: 3, futureFlag: "kept" },
    });
    expect(doc.settings.futureFlag).toBe("kept");
    expect(resolveDocSettings(doc.settings).futureFlag).toBe("kept");
  });

  it("settings survive serialize/deserialize with defaults", () => {
    const doc = createChartDocument({
      id: "s1",
      type: "org",
      settings: { connectorWidth: 4, futureFlag: 7 },
    });
    const restored = deserializeChartDocument(serializeChartDocument(doc));
    expect(resolveDocSettings(restored.settings).connectorWidth).toBe(4);
    expect(restored.settings.futureFlag).toBe(7);
    // A legacy envelope with no settings still resolves the default.
    const legacy = deserializeChartDocument(
      serializeChartDocument(createChartDocument({ id: "s2", type: "org" }))
    );
    expect(resolveDocSettings(legacy.settings).connectorWidth).toBe(2);
  });
});

describe("resolveEdgeWidth", () => {
  const edge = (style) => createEdge({ id: "e1", from: "a", to: "b", style });

  it("uses the document default, then today's canvas width", () => {
    expect(resolveEdgeWidth(edge(), undefined)).toBe(2);
    expect(resolveEdgeWidth(edge(), {})).toBe(2);
    expect(resolveEdgeWidth(edge(), { connectorWidth: 3 })).toBe(3);
  });

  it("lets a per-edge style.width override the document default", () => {
    expect(resolveEdgeWidth(edge({ width: 4 }), { connectorWidth: 1 })).toBe(4);
    expect(resolveEdgeWidth(edge({ width: 1 }), {})).toBe(1);
  });

  it("rejects invalid per-edge widths at write time", () => {
    expect(() => edge({ width: 0 })).toThrow(ChartError);
    expect(() => edge({ width: 9 })).toThrow(ChartError);
  });

  it("edge style.width survives serialize/deserialize", () => {
    const doc = createChartDocument({
      id: "ew1",
      type: "workflow",
      nodes: [
        createNode({ id: "a", label: "A" }),
        createNode({ id: "b", label: "B" }),
      ],
      edges: [createEdge({ id: "e1", from: "a", to: "b", style: { width: 4 } })],
    });
    const restored = deserializeChartDocument(serializeChartDocument(doc));
    expect(restored.edges[0].style.width).toBe(4);
    expect(resolveEdgeWidth(restored.edges[0], restored.settings)).toBe(4);
  });
});
