// @vitest-environment jsdom

// PhotoFinishField — upload-a-photo control for a room's flooring or a
// wall's covering (pattern or, for walls, an extracted solid color).

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PhotoFinishField from "./PhotoFinishField";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./underlayImage", () => ({
  UNDERLAY_ACCEPT: "image/png,image/jpeg",
  decodeUnderlayFile: vi.fn(async () => ({ dataUrl: "data:image/png;base64,ZmFrZQ==", widthPx: 10, heightPx: 10, mimeType: "image/png" })),
  extractAverageColorFromDataUrl: vi.fn(async () => "#8a6f4d"),
}));

const { decodeUnderlayFile, extractAverageColorFromDataUrl } = await import("./underlayImage");

const flushMicrotasks = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});

const uploadFile = async (input, file) => {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("PhotoFinishField", () => {
  let container;
  let root;
  beforeEach(() => {
    decodeUnderlayFile.mockClear();
    extractAverageColorFromDataUrl.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows Upload photo with no value, Replace photo once one is set, and no Remove button until then", () => {
    act(() => root.render(<PhotoFinishField label="Flooring photo" value={null} onChange={() => {}} onClear={() => {}} />));
    expect(container.textContent).toContain("Upload photo");
    expect(container.querySelector('[aria-label="Remove"]')).toBeNull();

    act(() => root.render(
      <PhotoFinishField label="Flooring photo" value={{ dataUrl: "data:image/png;base64,x", tileIn: 24 }} onChange={() => {}} onClear={() => {}} />,
    ));
    expect(container.textContent).toContain("Replace photo");
    expect(container.querySelector('[aria-label="Remove"]')).not.toBeNull();
  });

  it("calls onClear when Remove is clicked", () => {
    const onClear = vi.fn();
    act(() => root.render(
      <PhotoFinishField label="Flooring photo" value={{ dataUrl: "data:image/png;base64,x", tileIn: 24 }} onChange={() => {}} onClear={onClear} />,
    ));
    act(() => container.querySelector('[aria-label="Remove"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("room mode (allowColorChoice=false): uploading a photo calls onChange with a plain {dataUrl, tileIn}, no kind", async () => {
    const onChange = vi.fn();
    act(() => root.render(<PhotoFinishField label="Flooring photo" value={null} onChange={onChange} onClear={() => {}} />));
    const input = container.querySelector('input[type="file"]');
    const file = new File(["x"], "floor.png", { type: "image/png" });
    await uploadFile(input, file);
    expect(decodeUnderlayFile).toHaveBeenCalledWith(file);
    expect(onChange).toHaveBeenCalledWith({ dataUrl: "data:image/png;base64,ZmFrZQ==", tileIn: 24 });
  });

  it("wall mode, Wallpaper (default): uploading a photo calls onChange with { kind: 'pattern', ... }", async () => {
    const onChange = vi.fn();
    act(() => root.render(<PhotoFinishField label="Wallpaper or color" value={null} allowColorChoice onChange={onChange} onClear={() => {}} />));
    const input = container.querySelector('input[type="file"]');
    const file = new File(["x"], "wallpaper.png", { type: "image/png" });
    await uploadFile(input, file);
    expect(onChange).toHaveBeenCalledWith({ kind: "pattern", dataUrl: "data:image/png;base64,ZmFrZQ==", tileIn: 24 });
    expect(extractAverageColorFromDataUrl).not.toHaveBeenCalled();
  });

  it("wall mode, switched to Color: uploading a photo extracts the average color and calls onChange with { kind: 'color', color }", async () => {
    const onChange = vi.fn();
    act(() => root.render(<PhotoFinishField label="Wallpaper or color" value={null} allowColorChoice onChange={onChange} onClear={() => {}} />));
    act(() => container.querySelector('[aria-pressed="false"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const input = container.querySelector('input[type="file"]');
    const file = new File(["x"], "paint-chip.png", { type: "image/png" });
    await uploadFile(input, file);
    expect(extractAverageColorFromDataUrl).toHaveBeenCalledWith("data:image/png;base64,ZmFrZQ==");
    expect(onChange).toHaveBeenCalledWith({ kind: "color", color: "#8a6f4d" });
  });

  it("shows an error and never calls onChange for a non-image file", async () => {
    const onChange = vi.fn();
    act(() => root.render(<PhotoFinishField label="Flooring photo" value={null} onChange={onChange} onClear={() => {}} />));
    const input = container.querySelector('input[type="file"]');
    const file = new File(["x"], "notes.txt", { type: "text/plain" });
    await uploadFile(input, file);
    expect(onChange).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Please choose an image file.");
  });

  it("shows a swatch for a color value and a preview image for a pattern value", () => {
    act(() => root.render(
      <PhotoFinishField label="Wallpaper or color" value={{ kind: "color", color: "#8a6f4d" }} allowColorChoice onChange={() => {}} onClear={() => {}} />,
    ));
    expect(container.textContent).toContain("#8a6f4d");

    act(() => root.render(
      <PhotoFinishField
        label="Wallpaper or color"
        value={{ kind: "pattern", dataUrl: "data:image/png;base64,x", tileIn: 12 }}
        allowColorChoice
        onChange={() => {}}
        onClear={() => {}}
      />,
    ));
    const preview = container.querySelector("div[style*='background-image']");
    expect(preview).not.toBeNull();
  });
});
