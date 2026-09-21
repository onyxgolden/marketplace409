// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChartPersistenceError, serializeChartDocument } from "../chartPersistence.js";
import {
  deleteChartProjectDocument,
  listChartProjectDocuments,
  loadChartProjectDocument,
  saveChartProjectDocument,
} from "../chartProjectAdapter.js";
import { createChartDocument, createEdge, createNode } from "../chartDocument.js";

function makeDoc(id = "chart-1") {
  return createChartDocument({
    id,
    type: "workflow",
    nodes: [
      createNode({ id: "s1", label: "Start", position: { x: 10, y: 20 } }),
      createNode({ id: "s2", label: "End", position: { x: 300, y: 20 } }),
    ],
    edges: [createEdge({ id: "e1", from: "s1", to: "s2", type: "sequence", label: "go" })],
    background: "slate",
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("saveChartProjectDocument / loadChartProjectDocument", () => {
  it("saves and reloads with nodes, edges, ids, and manual positions intact", () => {
    const doc = makeDoc();
    const { documentId, savedAt } = saveChartProjectDocument({
      projectId: null,
      chartDocument: doc,
      title: "My chart",
    });
    expect(documentId).toBe("chart-1");
    expect(typeof savedAt).toBe("string");

    const loaded = loadChartProjectDocument(documentId);
    expect(loaded).toEqual(doc);
    expect(loaded.nodes.map((n) => n.id)).toEqual(["s1", "s2"]);
    expect(loaded.nodes[0].position).toEqual({ x: 10, y: 20 });
    expect(loaded.edges[0]).toMatchObject({ from: "s1", to: "s2", label: "go" });
    expect(loaded.background).toBe("slate");
  });

  it("re-saving the same chart id updates it in place", () => {
    const doc = makeDoc();
    saveChartProjectDocument({ chartDocument: doc, title: "v1" });
    saveChartProjectDocument({ chartDocument: doc, title: "v2" });
    const listed = listChartProjectDocuments();
    expect(listed).toHaveLength(1);
    expect(listed[0].title).toBe("v2");
    expect(loadChartProjectDocument("chart-1").id).toBe("chart-1");
  });

  it("throws a visible error when the saved chart is missing", () => {
    expect(() => loadChartProjectDocument("nope")).toThrow(ChartPersistenceError);
    expect(() => loadChartProjectDocument("nope")).toThrow(/not found/);
  });

  it("throws a visible error for corrupt JSON instead of crashing", () => {
    window.localStorage.setItem("forge.chart.document.bad", "{not json");
    expect(() => loadChartProjectDocument("bad")).toThrow(ChartPersistenceError);
    expect(() => loadChartProjectDocument("bad")).toThrow(/corrupt/);
  });

  it("refuses to load a foreign documentType stored under a chart key", () => {
    window.localStorage.setItem(
      "forge.chart.document.foreign",
      JSON.stringify({ documentType: "design", version: 1 })
    );
    expect(() => loadChartProjectDocument("foreign")).toThrow(ChartPersistenceError);
    expect(() => loadChartProjectDocument("foreign")).toThrow(/not a chart/);
  });

  it("rejects a stored chart whose edge points at a missing node", () => {
    const doc = makeDoc();
    const envelope = serializeChartDocument(doc, { title: "t" });
    envelope.content.edges[0].to = "ghost";
    window.localStorage.setItem("forge.chart.document.broken", JSON.stringify(envelope));
    expect(() => loadChartProjectDocument("broken")).toThrow(ChartPersistenceError);
  });

  it("throws when browser storage is unavailable", () => {
    vi.stubGlobal("window", undefined);
    expect(() =>
      saveChartProjectDocument({ chartDocument: makeDoc(), title: "t" })
    ).toThrow(/unavailable/);
  });
});

describe("deleteChartProjectDocument / listChartProjectDocuments", () => {
  it("deletes and lists newest-first, filterable by project", () => {
    saveChartProjectDocument({ projectId: "p1", chartDocument: makeDoc("a"), title: "A" });
    saveChartProjectDocument({ projectId: "p2", chartDocument: makeDoc("b"), title: "B" });
    expect(listChartProjectDocuments()).toHaveLength(2);
    expect(listChartProjectDocuments()[0].documentId).toBe("b");
    expect(listChartProjectDocuments({ projectId: "p1" })).toHaveLength(1);

    expect(deleteChartProjectDocument("a")).toBe(true);
    expect(deleteChartProjectDocument("a")).toBe(false);
    expect(listChartProjectDocuments()).toHaveLength(1);
    expect(() => loadChartProjectDocument("a")).toThrow(/not found/);
  });
});
