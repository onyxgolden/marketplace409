// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import ControlledDrawingUpload from "./ControlledDrawingUpload.jsx";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\n%test isometric\n%%EOF\n");
const SHA = "a".repeat(64);

function renderUpload(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ControlledDrawingUpload packageId="forge_wp_1" {...props} />);
  });
  return { container, root };
}

function selectFile(container, name = "W-0005-1.pdf") {
  const input = container.querySelector('input[type="file"]');
  const file = new File([PDF_BYTES], name, { type: "application/pdf" });
  Object.defineProperty(input, "files", { value: [file] });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return input;
}

function setText(container, label, value) {
  const input = [...container.querySelectorAll("input, select")].find((el) => {
    const id = el.getAttribute("id");
    const labelEl = id && container.querySelector(`label[for="${id}"]`);
    return labelEl && labelEl.textContent.includes(label);
  });
  // React controlled inputs ignore a plain .value assignment; use the
  // native setter so React's value tracker sees the change.
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submitForm(container) {
  const form = container.querySelector("#controlled-drawing-intake form");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("ControlledDrawingUpload", () => {
  it("renders the controlled intake section with PDF-only input and IFA wording", () => {
    const { container } = renderUpload();
    expect(container.querySelector("#controlled-drawing-intake")).not.toBeNull();
    expect(container.textContent).toContain("Upload controlled drawing (PDF)");
    expect(container.textContent).toContain("immutable IFA revision");
    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput.getAttribute("accept")).toContain("application/pdf");
    expect(container.querySelector("#controlled-drawing-number")).not.toBeNull();
    expect(container.querySelector("#controlled-revision-code")).not.toBeNull();
    expect(container.querySelector("#controlled-issue-date")).not.toBeNull();
  });

  it("uploads the selected PDF and shows a named success with navigation", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (typeof url === "string" && url.includes("/drawings/intake")) {
        return {
          ok: true,
          json: async () => ({
            artifact: { id: "forge_wpa_1", drawingId: "forge_wdwg_1", contentSha256: SHA },
            drawing: { id: "forge_wdwg_1" }, revision: { id: "forge_wpdrv_1" }, replayed: false,
          }),
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const onNavigateToTab = vi.fn();
    const { container } = renderUpload({ onNavigateToTab });
    setText(container, "Drawing number", "W-0005-1");
    selectFile(container);
    await submitForm(container);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/work-packages/forge_wp_1/drawings/intake");
    expect(options.method).toBe("POST");
    expect(options.body.get("drawingNumber")).toBe("W-0005-1");
    expect(options.body.get("revisionCode")).toBe("0");
    expect(options.body.get("requestId")).toMatch(/^.{1,128}$/);
    expect(options.body.get("file")).toBeInstanceOf(File);

    expect(container.textContent).toContain("Uploaded W-0005-1 revision 0 as IFA");
    expect(container.textContent).toContain(SHA.slice(0, 12));
    const navButton = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("View in Drawing readiness"));
    expect(navButton).not.toBeUndefined();
    act(() => { navButton.click(); });
    expect(onNavigateToTab).toHaveBeenCalledWith("redlines");
  });

  it("shows the server error and reuses the same request id on a retry", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: "A revision with this code already exists for the drawing." }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderUpload();
    setText(container, "Drawing number", "W-0005-1");
    selectFile(container);
    await submitForm(container);
    expect(container.textContent).toContain("A revision with this code already exists");
    await submitForm(container);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstId = fetchMock.mock.calls[0][1].body.get("requestId");
    const secondId = fetchMock.mock.calls[1][1].body.get("requestId");
    expect(firstId).toBeTruthy();
    expect(secondId).toBe(firstId);
  });

  it("opens the preview through a signed URL fetched after the click", async () => {
    const tab = { location: {}, opener: "x" };
    vi.spyOn(window, "open").mockReturnValue(tab);
    const fetchMock = vi.fn(async (url) => {
      if (typeof url === "string" && url.includes("/drawings/intake")) {
        return {
          ok: true,
          json: async () => ({
            artifact: { id: "forge_wpa_1", drawingId: "forge_wdwg_1", contentSha256: SHA },
            drawing: { id: "forge_wdwg_1" }, revision: { id: "forge_wpdrv_1" }, replayed: false,
          }),
        };
      }
      if (typeof url === "string" && url.includes("/preview")) {
        return { ok: true, json: async () => ({ url: "https://signed.example/controlled.pdf" }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderUpload();
    setText(container, "Drawing number", "W-0005-1");
    selectFile(container);
    await submitForm(container);
    const previewButton = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Preview the uploaded PDF"));
    expect(previewButton).not.toBeUndefined();
    await act(async () => { previewButton.click(); });
    await act(async () => {});
    expect(window.open).toHaveBeenCalledWith("", "_blank");
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toBe("https://signed.example/controlled.pdf");
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/work-packages/forge_wp_1/drawings/forge_wdwg_1/artifacts/forge_wpa_1/preview",
    );
  });
});
