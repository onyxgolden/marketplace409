import { describe, expect, it } from "vitest";
import {
  ChartExportError,
  buildSvgDocument,
  escapeSvgText,
  exportChartSvg,
} from "../chartExportSvg.js";
import { createChartDocument, createEdge, createNode } from "../chartDocument.js";

function makeOrg() {
  return createChartDocument({
    id: "chart-svg-1",
    type: "org",
    nodes: [
      createNode({ id: "n1", label: "Ada <Boss>", subtitle: "CEO & Founder", position: { x: 100, y: 20 } }),
      createNode({
        id: "n2",
        label: "Bo",
        fields: { title: "CTO", department: "Eng" },
        position: { x: 100, y: 180 },
      }),
    ],
    edges: [createEdge({ id: "e1", from: "n1", to: "n2", type: "supervisor" })],
    background: "warm-paper",
  });
}

describe("escapeSvgText", () => {
  it("escapes markup-significant characters", () => {
    expect(escapeSvgText(`<script>alert("x") & 'y'</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;"
    );
  });
});

describe("exportChartSvg", () => {
  it("renders nodes, edges, and background", () => {
    const { svg, width, height } = exportChartSvg(makeOrg());
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    // Node cards + texts (labels are escaped: "<Boss>" and "&").
    expect(svg).toContain("Ada &lt;Boss&gt;");
    expect(svg).toContain("CEO &amp; Founder");
    expect(svg).toContain("CTO · Eng");
    // Edge connector path.
    expect(svg).toContain("<path d=\"M ");
    // Solid background rect.
    expect(svg).toContain('fill="#faf6ee"');
  });

  it("never lets a <script> label break out of the SVG", () => {
    const doc = createChartDocument({
      id: "xss",
      type: "org",
      nodes: [createNode({ id: "n1", label: `<script>alert(1)</script>` })],
      edges: [],
    });
    const { svg } = exportChartSvg(doc);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes edge labels and field values", () => {
    const doc = createChartDocument({
      id: "xss2",
      type: "workflow",
      nodes: [
        createNode({ id: "s1", label: "A", fields: { title: `"quoted" <tag>` }, position: { x: 0, y: 0 } }),
        createNode({ id: "s2", label: "B", position: { x: 300, y: 0 } }),
      ],
      edges: [createEdge({ id: "e1", from: "s1", to: "s2", type: "sequence", label: "yes <no>" })],
    });
    const { svg } = exportChartSvg(doc);
    expect(svg).toContain("&quot;quoted&quot; &lt;tag&gt;");
    expect(svg).toContain("yes &lt;no&gt;");
    expect(svg).not.toContain("<tag>");
  });

  it("exports an empty chart as valid SVG", () => {
    const doc = createChartDocument({ id: "empty", type: "org", nodes: [], edges: [] });
    const { svg, width, height } = exportChartSvg(doc);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it("keeps background, edges, nodes, labels in layer order", () => {
    const { svg } = exportChartSvg(makeOrg());
    const order = ["id=\"background\"", "id=\"edges\"", "id=\"nodes\"", "id=\"labels\""].map(
      (id) => svg.indexOf(id)
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("lays out charts that were never positioned instead of stacking cards", () => {
    const doc = createChartDocument({
      id: "unlaid",
      type: "org",
      nodes: [
        createNode({ id: "a", label: "A" }),
        createNode({ id: "b", label: "B" }),
        createNode({ id: "c", label: "C" }),
      ],
      edges: [createEdge({ id: "e1", from: "a", to: "b", type: "supervisor" })],
    });
    const { svg } = exportChartSvg(doc);
    const transforms = [...svg.matchAll(/transform="translate\(([0-9.]+),([0-9.]+)\)/g)].map(
      (m) => `${m[1]},${m[2]}`
    );
    expect(new Set(transforms).size).toBe(3);
  });

  it("adds arrow markers for workflow edges", () => {
    const doc = createChartDocument({
      id: "wf",
      type: "workflow",
      nodes: [
        createNode({ id: "s1", label: "One", position: { x: 0, y: 0 } }),
        createNode({ id: "s2", label: "Two", position: { x: 300, y: 0 } }),
      ],
      edges: [createEdge({ id: "e1", from: "s1", to: "s2", type: "sequence", label: "next" })],
    });
    const { svg } = exportChartSvg(doc);
    expect(svg).toContain("<marker");
    expect(svg).toContain("marker-end=");
    expect(svg).toContain(">next</text>");
  });

  it("renders pattern and gradient backgrounds without fetching anything", () => {
    const dots = createChartDocument({
      id: "dots",
      type: "org",
      nodes: [createNode({ id: "n1", label: "A" })],
      edges: [],
      background: "dot-grid",
    });
    const dotsSvg = exportChartSvg(dots).svg;
    expect(dotsSvg).toContain("<pattern");
    expect(dotsSvg).toContain("<circle");

    const grad = createChartDocument({
      id: "grad",
      type: "org",
      nodes: [createNode({ id: "n1", label: "A" })],
      edges: [],
      background: "sunrise",
    });
    const gradSvg = exportChartSvg(grad).svg;
    expect(gradSvg).toContain("<linearGradient");
    expect(gradSvg).toContain("<stop");
  });

  it("embeds data-URL image backgrounds but never external URLs", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const withData = createChartDocument({
      id: "img1",
      type: "org",
      nodes: [],
      edges: [],
    });
    const dataSvg = exportChartSvg({ ...withData, background: dataUrl }).svg;
    expect(dataSvg).toContain("<image");
    expect(dataSvg).toContain(`href="${dataUrl}"`);

    const external = exportChartSvg({ ...withData, background: "https://example.com/bg.png" }).svg;
    expect(external).not.toContain("https://example.com/bg.png");
    expect(external).toContain("was not embedded");
  });

  it("completes a large chart without React or the DOM", () => {
    const nodes = [];
    const edges = [];
    for (let i = 0; i < 1500; i++) {
      nodes.push(createNode({ id: `n${i}`, label: `Person ${i}`, position: { x: (i % 30) * 200, y: Math.floor(i / 30) * 120 } }));
      if (i > 0) edges.push(createEdge({ id: `e${i}`, from: `n${i - 1}`, to: `n${i}`, type: "supervisor" }));
    }
    const doc = createChartDocument({ id: "big", type: "org", nodes, edges });
    const started = Date.now();
    const { svg } = exportChartSvg(doc);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(svg.length).toBeGreaterThan(100000);
    expect(svg).toContain("Person 1499");
  });

  it("skips dangling edges instead of crashing", () => {
    const doc = makeOrg();
    const { svg } = exportChartSvg({
      ...doc,
      edges: [...doc.edges, { id: "e-ghost", from: "n1", to: "ghost", label: "", type: "supervisor" }],
    });
    expect(svg).toContain("</svg>");
  });

  it("rejects non-documents and unknown chart types", () => {
    expect(() => exportChartSvg(null)).toThrow(ChartExportError);
    expect(() => exportChartSvg({ type: "mystery", nodes: [], edges: [] })).toThrow(
      ChartExportError
    );
  });
});

describe("exportChartSvg node styles", () => {
  it("honors accent color, card treatment, text size, bold, and alignment", () => {
    const doc = createChartDocument({
      id: "styled",
      type: "org",
      nodes: [
        createNode({
          id: "n1",
          label: "Styled Node",
          style: { color: "#10b981", card: "tint", textSize: "lg", bold: true, align: "center" },
          position: { x: 40, y: 30 },
        }),
      ],
      edges: [],
    });
    const { svg } = exportChartSvg(doc);
    // Accent color string present on the card border and accent bar.
    expect(svg).toContain('stroke="#10b981"');
    expect(svg).toContain('fill="#10b981"');
    // Tint card fill carries the accent at low alpha.
    expect(svg).toContain('fill="#10b9811a"');
    // Large bold centered text.
    expect(svg).toContain('font-size="16"');
    expect(svg).toContain('font-weight="700"');
    expect(svg).toContain('text-anchor="middle"');
  });

  it("renders outline cards with an accent border; thickness follows borderWidth", () => {
    const doc = createChartDocument({
      id: "outlined",
      type: "org",
      nodes: [
        createNode({
          id: "n1",
          label: "Outlined",
          style: { card: "outline", color: "#ef4444", borderWidth: 4 },
          position: { x: 40, y: 30 },
        }),
      ],
      edges: [],
    });
    const { svg } = exportChartSvg(doc);
    expect(svg).toContain('stroke-width="4"');
    expect(svg).toContain('stroke="#ef4444"');
  });

  it("renders the default border width (1) for style-less nodes", () => {
    const doc = createChartDocument({
      id: "plain",
      type: "org",
      nodes: [createNode({ id: "n1", label: "Plain", position: { x: 40, y: 30 } })],
      edges: [],
    });
    const { svg } = exportChartSvg(doc);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('stroke="#1f6feb"');
    expect(svg).toContain('font-size="13"');
    expect(svg).toContain('font-weight="400"');
    expect(svg).toContain('text-anchor="start"');
    // The card rect carries the default border width.
    expect(svg).toMatch(/<rect[^>]*stroke-width="1"\/>/);
  });
});

describe("exportChartSvg line thickness", () => {
  function makeConnected({ settings, edgeStyle } = {}) {
    return createChartDocument({
      id: "thick",
      type: "org",
      nodes: [
        createNode({ id: "n1", label: "A", position: { x: 100, y: 20 } }),
        createNode({ id: "n2", label: "B", position: { x: 100, y: 180 } }),
      ],
      edges: [
        createEdge({ id: "e1", from: "n1", to: "n2", type: "supervisor", style: edgeStyle }),
      ],
      settings,
    });
  }

  it("renders connectors at the canvas default width (2)", () => {
    const { svg } = exportChartSvg(makeConnected());
    expect(svg).toContain('<path d="M ');
    expect(svg).toMatch(/<path d="M [^"]*" stroke-width="2"\/>/);
  });

  it("honors the document connectorWidth on every edge", () => {
    const { svg } = exportChartSvg(makeConnected({ settings: { connectorWidth: 4 } }));
    expect(svg).toMatch(/<path d="M [^"]*" stroke-width="4"\/>/);
    expect(svg).not.toMatch(/<path d="M [^"]*" stroke-width="2"\/>/);
  });

  it("lets a per-edge style.width override the document default", () => {
    const { svg } = exportChartSvg(
      makeConnected({ settings: { connectorWidth: 1 }, edgeStyle: { width: 3 } })
    );
    expect(svg).toMatch(/<path d="M [^"]*" stroke-width="3"\/>/);
  });

  it("honors node borderWidth on the card rect", () => {
    const doc = createChartDocument({
      id: "bw",
      type: "org",
      nodes: [
        createNode({
          id: "n1",
          label: "Thick",
          style: { borderWidth: 3 },
          position: { x: 40, y: 30 },
        }),
      ],
      edges: [],
    });
    const { svg } = exportChartSvg(doc);
    expect(svg).toMatch(/<rect[^>]*stroke-width="3"\/>/);
  });
});

describe("buildSvgDocument", () => {
  it("assembles a document with the four layers", () => {
    const svg = buildSvgDocument({
      width: 100,
      height: 80,
      title: "T",
      backgroundSvg: "<rect/>",
      edgeSvg: "<path/>",
      nodeSvg: "<g/>",
      labelSvg: "<text/>",
    });
    expect(svg.indexOf('id="background"')).toBeLessThan(svg.indexOf('id="edges"'));
    expect(svg.indexOf('id="edges"')).toBeLessThan(svg.indexOf('id="nodes"'));
    expect(svg.indexOf('id="nodes"')).toBeLessThan(svg.indexOf('id="labels"'));
    expect(svg).toContain("<title>T</title>");
  });
});
