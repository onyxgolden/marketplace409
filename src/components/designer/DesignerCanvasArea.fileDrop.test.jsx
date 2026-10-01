// @vitest-environment jsdom

// DesignerCanvasArea — canvas-wide file drop routing (A/B from the
// canvas-drop-import-scale brief). PDF/DXF/VSDX route to onFileImport;
// closed CAD formats (DWG/DWF/DWFx) and anything else are refused in place,
// by name, with no onFileImport call and no file ever parsed.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { createEmptyDesign } from "@/domains/roomDesigner/designerDocument";

vi.mock("./DesignerViewport3D", () => ({
  default: function StubViewport3D() {
    return <div data-testid="viewport-3d-stub" />;
  },
}));

vi.mock("next/dynamic", () => ({
  default: (loader) => {
    let Resolved = null;
    loader().then((mod) => {
      Resolved = mod.default || mod;
    });
    return function DynamicPassthrough(props) {
      if (!Resolved) return null;
      return <Resolved {...props} />;
    };
  },
}));

if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

let DesignerCanvasArea;
let container;
let root;

const baseProps = (overrides = {}) => ({
  view: "2d",
  design: createEmptyDesign(),
  tool: "select",
  selection: null,
  multiSelection: [],
  calibration: null,
  pendingCatalogId: null,
  pendingRoomTemplate: "bedroom",
  pendingPipe: { diameterIn: 2 },
  pendingSymbol: null,
  pendingCustomShape: null,
  orthoSnap: true,
  layerVisibility: {},
  dispatch: vi.fn(),
  zoomRequest: null,
  onFileImport: vi.fn(),
  ...overrides,
});

const render = async (props) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<DesignerCanvasArea {...baseProps(props)} />);
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(async () => {
  vi.clearAllMocks();
  DesignerCanvasArea = (await import("./DesignerCanvasArea")).default;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function fileEvent(type, file) {
  const event = new window.MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { types: file ? ["Files"] : [], files: file ? [file] : [] },
  });
  return event;
}

const zone = () => container.querySelector('[data-testid="designer-canvas-area"]');

describe("canvas file drop", () => {
  it("shows a drop affordance while a file is dragged over the canvas, and clears it on dragleave", async () => {
    await render();
    expect(container.querySelector('[data-testid="canvas-drop-affordance"]')).toBeNull();
    await act(async () => zone().dispatchEvent(fileEvent("dragenter", new File([""], "plan.pdf"))));
    expect(container.querySelector('[data-testid="canvas-drop-affordance"]')).not.toBeNull();
    await act(async () => zone().dispatchEvent(fileEvent("dragleave", new File([""], "plan.pdf"))));
    expect(container.querySelector('[data-testid="canvas-drop-affordance"]')).toBeNull();
  });

  it("routes a dropped .pdf to onFileImport with kind pdf, and clears the affordance", async () => {
    const onFileImport = vi.fn();
    await render({ onFileImport });
    const file = new File(["bytes"], "plan.pdf");
    await act(async () => zone().dispatchEvent(fileEvent("dragenter", file)));
    await act(async () => zone().dispatchEvent(fileEvent("drop", file)));
    expect(onFileImport).toHaveBeenCalledTimes(1);
    expect(onFileImport.mock.calls[0][0]).toBe(file);
    expect(onFileImport.mock.calls[0][1]).toBe("pdf");
    expect(container.querySelector('[data-testid="canvas-drop-affordance"]')).toBeNull();
  });

  it("routes a dropped .dxf to onFileImport with kind dxf", async () => {
    const onFileImport = vi.fn();
    await render({ onFileImport });
    const file = new File(["bytes"], "house.dxf");
    await act(async () => zone().dispatchEvent(fileEvent("drop", file)));
    expect(onFileImport).toHaveBeenCalledWith(file, "dxf");
  });

  it("routes a dropped .vsdx to onFileImport with kind vsdx", async () => {
    const onFileImport = vi.fn();
    await render({ onFileImport });
    const file = new File(["bytes"], "drawing.vsdx");
    await act(async () => zone().dispatchEvent(fileEvent("drop", file)));
    expect(onFileImport).toHaveBeenCalledWith(file, "vsdx");
  });

  it("refuses a dropped .dwg by name, with conversion guidance, and never calls onFileImport", async () => {
    const onFileImport = vi.fn();
    await render({ onFileImport });
    const file = new File(["bytes"], "plan.dwg");
    await act(async () => zone().dispatchEvent(fileEvent("drop", file)));
    expect(onFileImport).not.toHaveBeenCalled();
    const notice = container.querySelector('[data-testid="canvas-drop-notice"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toMatch(/DWG/);
    expect(notice.textContent).toMatch(/DXF/);
  });

  it("refuses a dropped .dwf and .dwfx by name too", async () => {
    const onFileImport = vi.fn();
    await render({ onFileImport });
    await act(async () => zone().dispatchEvent(fileEvent("drop", new File(["b"], "plan.dwf"))));
    expect(container.querySelector('[data-testid="canvas-drop-notice"]').textContent).toMatch(/DWF/);
    await act(async () => zone().dispatchEvent(fileEvent("drop", new File(["b"], "plan.dwfx"))));
    expect(container.querySelector('[data-testid="canvas-drop-notice"]').textContent).toMatch(/DWFx/);
    expect(onFileImport).not.toHaveBeenCalled();
  });

  it("shows an unsupported-format notice for anything else, naming the supported formats", async () => {
    const onFileImport = vi.fn();
    await render({ onFileImport });
    const file = new File(["bytes"], "artwork.ai");
    await act(async () => zone().dispatchEvent(fileEvent("drop", file)));
    expect(onFileImport).not.toHaveBeenCalled();
    const notice = container.querySelector('[data-testid="canvas-drop-notice"]');
    expect(notice.textContent).toMatch(/\.ai/);
    expect(notice.textContent).toMatch(/PDF/);
    expect(notice.textContent).toMatch(/DXF/);
    expect(notice.textContent).toMatch(/VSDX/);
  });

  it("ignores a non-file drag (e.g. dragging a palette item), never showing the affordance", async () => {
    const onFileImport = vi.fn();
    await render({ onFileImport });
    await act(async () => zone().dispatchEvent(fileEvent("dragenter", null)));
    expect(container.querySelector('[data-testid="canvas-drop-affordance"]')).toBeNull();
  });
});
