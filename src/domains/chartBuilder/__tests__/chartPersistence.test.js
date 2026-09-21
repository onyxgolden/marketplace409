import { describe, expect, it } from "vitest";
import {
  CHART_DOCUMENT_TYPE,
  ChartPersistenceError,
  PERSISTED_CHART_VERSION,
  deserializeChartDocument,
  migrateChartDocument,
  serializeChartDocument,
  validatePersistedChartDocument,
} from "../chartPersistence.js";
import {
  CHART_SCHEMA_VERSION,
  createChartDocument,
  createEdge,
  createNode,
} from "../chartDocument.js";

function makeDoc(overrides = {}) {
  return createChartDocument({
    id: "chart-1",
    type: "org",
    nodes: [
      createNode({
        id: "n1",
        label: "Ada",
        subtitle: "CEO",
        fields: { title: "Chief", department: "Exec" },
        position: { x: 120, y: 40 },
        style: { color: "#1f6feb" },
      }),
      createNode({
        id: "n2",
        label: "Bo",
        position: { x: 120, y: 200 },
      }),
    ],
    edges: [createEdge({ id: "e1", from: "n1", to: "n2", type: "supervisor" })],
    metadata: { templateId: "org-classic-hierarchy" },
    background: "warm-paper",
    ...overrides,
  });
}

describe("serializeChartDocument", () => {
  it("wraps the document in the project-document envelope", () => {
    const doc = makeDoc();
    const env = serializeChartDocument(doc, { title: "Q3 org" });
    expect(env.id).toBe("chart-1");
    expect(env.documentType).toBe(CHART_DOCUMENT_TYPE);
    expect(env.version).toBe(PERSISTED_CHART_VERSION);
    expect(env.title).toBe("Q3 org");
    expect(env.content.type).toBe("org");
    expect(env.content.background).toBe("warm-paper");
    expect(env.content.nodes).toHaveLength(2);
    expect(env.content.edges).toHaveLength(1);
    expect(env.metadata.templateId).toBe("org-classic-hierarchy");
    expect(env.metadata.createdAt).toBe(doc.createdAt);
    expect(env.metadata.updatedAt).toBe(doc.updatedAt);
    expect(env.metadata.chartSchemaVersion).toBe(CHART_SCHEMA_VERSION);
  });

  it("preserves node ids, manual positions, labels, and styles", () => {
    const env = serializeChartDocument(makeDoc());
    const n1 = env.content.nodes.find((n) => n.id === "n1");
    expect(n1.position).toEqual({ x: 120, y: 40 });
    expect(n1.label).toBe("Ada");
    expect(n1.subtitle).toBe("CEO");
    expect(n1.fields).toEqual({ title: "Chief", department: "Exec" });
    expect(n1.style.color).toBe("#1f6feb");
  });

  it("keeps document-level UI state out of storage while preserving unknown node/edge keys", () => {
    const doc = makeDoc();
    const fat = {
      ...doc,
      undoHistory: [{ action: "x" }],
      selection: ["n1"],
      viewport: { zoom: 2 },
      nodes: doc.nodes.map((n) => ({ ...n, selected: true, customMetadata: { tag: "x" } })),
      edges: doc.edges.map((e) => ({ ...e, customFlag: true })),
    };
    const env = serializeChartDocument(fat);
    const raw = JSON.stringify(env);
    expect(raw).not.toContain("undoHistory");
    expect(raw).not.toContain("selection");
    expect(raw).not.toContain("viewport");
    // Unknown keys now survive the canonical copy verbatim.
    expect(env.content.nodes[0].customMetadata).toEqual({ tag: "x" });
    expect(env.content.nodes[0].selected).toBe(true);
    expect(env.content.edges[0].customFlag).toBe(true);
    // Known fields keep their canonical defaults.
    expect(env.content.nodes[1].subtitle).toBe("");
  });

  it("preserves unknown node and edge fields through serialize → migrate", () => {
    const doc = makeDoc();
    const custom = {
      ...doc,
      nodes: doc.nodes.map((n) => ({ ...n, customMetadata: { source: "import" } })),
      edges: doc.edges.map((e) => ({ ...e, customFlag: true })),
    };
    const migrated = migrateChartDocument(serializeChartDocument(custom));
    expect(migrated.content.nodes[0].customMetadata).toEqual({ source: "import" });
    expect(migrated.content.nodes[1].customMetadata).toEqual({ source: "import" });
    expect(migrated.content.edges[0].customFlag).toBe(true);
    expect(migrated.content.nodes[1].subtitle).toBe("");
  });

  it("defaults a blank title to Untitled chart", () => {
    expect(serializeChartDocument(makeDoc(), { title: "  " }).title).toBe("Untitled chart");
  });

  it("rejects charts with no id or unknown type", () => {
    expect(() => serializeChartDocument({ type: "org" })).toThrow(ChartPersistenceError);
    expect(() =>
      serializeChartDocument({ id: "x", type: "mystery" })
    ).toThrow(ChartPersistenceError);
  });
});

describe("validatePersistedChartDocument", () => {
  it("accepts a serialized document", () => {
    expect(validatePersistedChartDocument(serializeChartDocument(makeDoc()))).toEqual([]);
  });

  it("rejects a non-chart documentType — it never loads as another type", () => {
    const env = serializeChartDocument(makeDoc());
    env.documentType = "design";
    const problems = validatePersistedChartDocument(env);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(" ")).toMatch(/not a chart/);
  });

  it("rejects an edge pointing at a missing node", () => {
    const env = serializeChartDocument(makeDoc());
    env.content.edges.push({ id: "e-bad", from: "n1", to: "ghost", label: "", type: "supervisor" });
    const problems = validatePersistedChartDocument(env);
    expect(problems.some((p) => p.includes("ghost"))).toBe(true);
  });

  it("rejects duplicate node ids", () => {
    const env = serializeChartDocument(makeDoc());
    env.content.nodes.push({ ...env.content.nodes[0] });
    const problems = validatePersistedChartDocument(env);
    expect(problems.some((p) => p.includes("duplicate node id"))).toBe(true);
  });

  it("rejects newer versions and non-objects", () => {
    const env = serializeChartDocument(makeDoc());
    env.version = PERSISTED_CHART_VERSION + 1;
    expect(validatePersistedChartDocument(env).length).toBeGreaterThan(0);
    expect(validatePersistedChartDocument(null)).toEqual([
      "The saved data is not a chart document.",
    ]);
  });
});

describe("migrateChartDocument", () => {
  it("migrates a legacy version-0 envelope and preserves unknown fields", () => {
    const legacy = {
      id: "chart-old",
      documentType: "chart",
      version: 0,
      title: "Legacy",
      owner: "jason", // unknown top-level field survives
      content: {
        type: "org",
        nodes: [{ id: "n1", label: "Ada", custom: 42 }],
        edges: [],
        extraContent: "kept",
      },
      metadata: { templateId: null },
    };
    const migrated = migrateChartDocument(legacy);
    expect(migrated.version).toBe(PERSISTED_CHART_VERSION);
    expect(migrated.owner).toBe("jason");
    expect(migrated.content.extraContent).toBe("kept");
    expect(migrated.content.background).toBe("white");
    expect(migrated.content.nodes[0].custom).toBe(42);
    expect(migrated.metadata.migratedFrom).toBe(0);
    expect(validatePersistedChartDocument(migrated)).toEqual([]);
  });

  it("leaves a current envelope untouched apart from metadata defaults", () => {
    const env = serializeChartDocument(makeDoc());
    const migrated = migrateChartDocument(env);
    expect(migrated.metadata.migratedFrom).toBeNull();
    expect(validatePersistedChartDocument(migrated)).toEqual([]);
  });

  it("refuses foreign documents and newer versions", () => {
    expect(() =>
      migrateChartDocument({ documentType: "design", version: 1 })
    ).toThrow(ChartPersistenceError);
    expect(() =>
      migrateChartDocument({ documentType: "chart", version: 99 })
    ).toThrow(ChartPersistenceError);
  });
});

describe("deserializeChartDocument", () => {
  it("round-trips import -> save -> reload to an identical chart", () => {
    const doc = makeDoc();
    const reloaded = deserializeChartDocument(serializeChartDocument(doc, { title: "T" }));
    expect(reloaded).toEqual(doc);
    expect(reloaded.nodes.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(reloaded.nodes[0].position).toEqual({ x: 120, y: 40 });
  });

  it("preserves an org multi-root forest and a workflow cycle", () => {
    const forest = createChartDocument({
      id: "forest",
      type: "org",
      nodes: [
        createNode({ id: "a", label: "A" }),
        createNode({ id: "b", label: "B" }),
        createNode({ id: "c", label: "C" }),
      ],
      edges: [createEdge({ id: "e1", from: "a", to: "c", type: "supervisor" })],
    });
    const reloadedForest = deserializeChartDocument(serializeChartDocument(forest));
    expect(reloadedForest.nodes).toHaveLength(3);
    expect(reloadedForest.edges).toHaveLength(1);

    const cycle = createChartDocument({
      id: "cycle",
      type: "workflow",
      nodes: [
        createNode({ id: "s1", label: "Step 1" }),
        createNode({ id: "s2", label: "Step 2" }),
      ],
      edges: [
        createEdge({ id: "e1", from: "s1", to: "s2", type: "sequence" }),
        createEdge({ id: "e2", from: "s2", to: "s1", type: "sequence" }),
      ],
    });
    const reloadedCycle = deserializeChartDocument(serializeChartDocument(cycle));
    expect(reloadedCycle.edges).toHaveLength(2);
  });

  it("throws a visible error for invalid documents — no silent repair", () => {
    const env = serializeChartDocument(makeDoc());
    env.content.edges[0].to = "missing-node";
    expect(() => deserializeChartDocument(env)).toThrow(ChartPersistenceError);
    expect(() => deserializeChartDocument(env)).toThrow(/missing node/);
  });

  it("throws for corrupt envelopes without crashing", () => {
    expect(() => deserializeChartDocument(null)).toThrow(ChartPersistenceError);
    expect(() => deserializeChartDocument("nope")).toThrow(ChartPersistenceError);
    expect(() => deserializeChartDocument({})).toThrow(ChartPersistenceError);
  });
});
