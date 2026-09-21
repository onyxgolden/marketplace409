// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChartPrintError,
  createPrintableChart,
  printChart,
} from "../chartPrintExport.js";
import { createChartDocument, createNode } from "../chartDocument.js";

function makeDoc() {
  return createChartDocument({
    id: "print-1",
    type: "org",
    nodes: [createNode({ id: "n1", label: "Ada Lovelace", position: { x: 40, y: 30 } })],
    edges: [],
  });
}

describe("createPrintableChart", () => {
  it("returns a printable rendering of the chart", () => {
    const printable = createPrintableChart(makeDoc());
    expect(printable.id).toBe("print-1");
    expect(printable.title).toBe("Org chart");
    expect(printable.width).toBeGreaterThan(0);
    expect(printable.height).toBeGreaterThan(0);
    expect(printable.svg).toContain("<svg");
    expect(printable.svg).toContain("Ada Lovelace");
  });

  it("rejects documents that cannot be exported", () => {
    expect(() => createPrintableChart(null)).toThrow(ChartPrintError);
    expect(() => createPrintableChart({ type: "mystery", nodes: [], edges: [] })).toThrow(
      ChartPrintError
    );
  });
});

describe("printChart", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls window.print() exactly once and returns the printable chart", () => {
    const printMock = vi.fn();
    vi.stubGlobal("print", printMock);
    // jsdom exposes window; stub window.print too for the domain check.
    window.print = printMock;
    const printable = printChart(makeDoc());
    expect(printMock).toHaveBeenCalledTimes(1);
    expect(printable.svg).toContain("Ada Lovelace");
  });

  it("never opens the print dialog for an invalid document", () => {
    const printMock = vi.fn();
    window.print = printMock;
    expect(() => printChart({ type: "mystery", nodes: [], edges: [] })).toThrow(
      ChartPrintError
    );
    expect(printMock).not.toHaveBeenCalled();
  });

  it("throws when printing is unavailable", () => {
    const original = window.print;
    // @ts-expect-error deliberate: simulate a non-browser environment
    window.print = undefined;
    expect(() => printChart(makeDoc())).toThrow(ChartPrintError);
    window.print = original;
  });
});
