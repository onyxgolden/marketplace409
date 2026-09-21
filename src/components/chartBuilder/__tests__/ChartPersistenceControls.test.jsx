// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import ChartPersistenceControls from "../ChartPersistenceControls.jsx";
import { createChartDocument, createNode } from "@/domains/chartBuilder/chartDocument.js";

let container;
let root;

const DOC_KEY = "forge.chart.document.bad-1";
const INDEX_KEY = "forge.chart.document.index.v1";

function makeDoc() {
  return createChartDocument({
    id: "persist-ui-1",
    type: "org",
    nodes: [createNode({ id: "n1", label: "Ada Lovelace", position: { x: 40, y: 30 } })],
    edges: [],
  });
}

function renderControls(props = {}) {
  const notices = [];
  const onLoad = vi.fn();
  act(() => {
    root.render(
      <ChartPersistenceControls
        doc={makeDoc()}
        onLoad={onLoad}
        onNotice={(n) => notices.push(n)}
        {...props}
      />
    );
  });
  return { notices, onLoad };
}

function clickText(text) {
  const el = [...container.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === text
  );
  if (!el) throw new Error(`button "${text}" not found`);
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  return el;
}

function typeName(name) {
  const input = container.querySelector("input[aria-label='Chart name']");
  act(() => {
    input.focus();
    // React 18+ reads the native setter; dispatch both for reliability.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set;
    setter.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("ChartPersistenceControls", () => {
  it("saves the chart and lists it in the saved-charts panel", () => {
    const { notices } = renderControls();
    typeName("My first chart");
    clickText("Save");
    expect(notices.some((n) => n.text.includes("saved on this device"))).toBe(true);
    clickText("Saved charts (1)");
    expect(container.textContent).toContain("My first chart");
  });

  it("opens a saved chart through onLoad with a fresh document", () => {
    const { notices, onLoad } = renderControls();
    typeName("Reopen me");
    clickText("Save");
    clickText("Saved charts (1)");
    clickText("Open");
    expect(onLoad).toHaveBeenCalledTimes(1);
    const loaded = onLoad.mock.calls[0][0];
    expect(loaded.nodes[0].label).toBe("Ada Lovelace");
    expect(notices.some((n) => n.text.includes("opened"))).toBe(true);
  });

  it("shows a visible error and never calls onLoad for a corrupt saved document", () => {
    localStorage.setItem(DOC_KEY, JSON.stringify({ garbage: "not-a-chart" }));
    localStorage.setItem(
      INDEX_KEY,
      JSON.stringify([
        { documentId: "bad-1", title: "Corrupt chart", chartType: "org", savedAt: new Date().toISOString() },
      ])
    );
    const { notices, onLoad } = renderControls();
    clickText("Saved charts (1)");
    expect(container.textContent).toContain("Corrupt chart");
    clickText("Open");
    expect(onLoad).not.toHaveBeenCalled();
    expect(notices.some((n) => n.kind === "error")).toBe(true);
  });

  it("deletes only after confirmation", () => {
    const { notices } = renderControls();
    typeName("Delete me");
    clickText("Save");
    clickText("Saved charts (1)");

    const confirmMock = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmMock);
    window.confirm = confirmMock;
    clickText("Delete");
    expect(confirmMock).toHaveBeenCalledTimes(1);
    // Cancelled: panel still open, entry still listed.
    expect(container.textContent).toContain("Delete me");

    confirmMock.mockReturnValue(true);
    clickText("Delete");
    expect(notices.some((n) => n.text.includes("deleted"))).toBe(true);
    clickText("Saved charts");
    expect(container.textContent).not.toContain("Delete me");
  });
});
