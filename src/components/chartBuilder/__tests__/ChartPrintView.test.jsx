// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import ChartPrintView from "../ChartPrintView.jsx";
import { createChartDocument, createNode } from "@/domains/chartBuilder/chartDocument.js";

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.print = vi.fn();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function makeDoc() {
  return createChartDocument({
    id: "pv-1",
    type: "org",
    nodes: [createNode({ id: "n1", label: "Ada Lovelace", position: { x: 40, y: 30 } })],
    edges: [],
  });
}

function renderView(doc, onClose = () => {}) {
  act(() => {
    root.render(<ChartPrintView doc={doc} onClose={onClose} />);
  });
}

describe("ChartPrintView", () => {
  it("renders the chart and calls window.print() exactly once", () => {
    renderView(makeDoc());
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toContain("Ada Lovelace");
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it("excludes builder chrome: no toolbar, inspector, handles, or grid controls", () => {
    renderView(makeDoc());
    const text = container.textContent;
    expect(text).not.toContain("Chart Builder");
    expect(text).not.toContain("Inspector");
    expect(text).not.toContain("Add person");
    expect(text).not.toContain("Grid");
    // No node-card interactivity hooks that the canvas uses.
    expect(container.querySelector("[data-testid]")).toBeNull();
  });

  it("shows an error and never prints for an invalid document", () => {
    renderView({ type: "mystery", nodes: [], edges: [] });
    expect(container.querySelector("[role='alert']")).not.toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(window.print).not.toHaveBeenCalled();
  });

  it("returns to the builder via afterprint", () => {
    const onClose = vi.fn();
    renderView(makeDoc(), onClose);
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
