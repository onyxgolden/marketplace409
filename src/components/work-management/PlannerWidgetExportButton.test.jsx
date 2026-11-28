// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import PlannerWidgetExportButton from "./PlannerWidgetExportButton.jsx";

function renderButton(props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PlannerWidgetExportButton {...props} />);
  });
  return { container, root };
}

function setupDownloadMocks() {
  const captured = { blob: null, url: null, anchors: [] };
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn((blob) => {
    captured.blob = blob;
    captured.url = "blob:fake-url";
    return "blob:fake-url";
  });
  URL.revokeObjectURL = vi.fn();
  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    captured.anchors.push({ href: this.href, download: this.download });
  });
  return {
    captured,
    restore() {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      clickSpy.mockRestore();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const BUILD = () => ({ filename: "forge-planner-p-scope-by-status-20261127-163000Z.csv", csvText: "a,b\r\n1,2" });

describe("PlannerWidgetExportButton", () => {
  it("renders a labelled Export CSV control for the widget", () => {
    const { container } = renderButton({ widgetTitle: "Scope by status", buildExport: BUILD });
    const button = container.querySelector("button");
    expect(button.getAttribute("aria-label")).toBe("Export Scope by status as CSV");
    expect(button.textContent).toContain("Export CSV");
    expect(button.disabled).toBe(false);
  });

  it("downloads exactly one file per click with the builder payload, then announces success", async () => {
    const mocks = setupDownloadMocks();
    const onExported = vi.fn();
    const { container } = renderButton({ widgetTitle: "Scope by status", buildExport: BUILD, onExported });
    const button = container.querySelector("button");
    await act(async () => {
      button.click();
    });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(mocks.captured.blob.type).toBe("text/csv;charset=utf-8");
    expect(await mocks.captured.blob.text()).toBe("a,b\r\n1,2");
    expect(mocks.captured.anchors).toHaveLength(1);
    expect(mocks.captured.anchors[0].download).toBe("forge-planner-p-scope-by-status-20261127-163000Z.csv");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
    expect(onExported).toHaveBeenCalledWith({ filename: "forge-planner-p-scope-by-status-20261127-163000Z.csv" });
    expect(container.textContent).toContain("CSV downloaded");
    expect(button.textContent).toContain("Export CSV");
    mocks.restore();
  });

  it("shows the busy state and ignores a second click while preparing", async () => {
    const mocks = setupDownloadMocks();
    const { container } = renderButton({ widgetTitle: "Scope by status", buildExport: BUILD });
    const button = container.querySelector("button");
    act(() => {
      button.click();
    });
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Preparing CSV");
    act(() => {
      button.click();
    });
    await act(async () => {});
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(mocks.captured.anchors).toHaveLength(1);
    expect(container.textContent).toContain("CSV downloaded");
    mocks.restore();
  });

  it("downloads nothing on a failed build, offers Retry, and retries successfully", async () => {
    const mocks = setupDownloadMocks();
    let calls = 0;
    const flaky = () => {
      calls += 1;
      if (calls === 1) throw new Error("cannot reconcile");
      return BUILD();
    };
    const { container } = renderButton({ widgetTitle: "Scope by status", buildExport: flaky });
    const button = container.querySelector("button");
    await act(async () => {
      button.click();
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(mocks.captured.anchors).toHaveLength(0);
    expect(button.textContent).toContain("Retry export");
    expect(container.textContent).toContain("Export failed — retry");
    await act(async () => {
      button.click();
    });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("CSV downloaded");
    mocks.restore();
  });

  it("revokes the Object URL even when the anchor click throws", async () => {
    const mocks = setupDownloadMocks();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("click failed");
    });
    const { container } = renderButton({ widgetTitle: "Scope by status", buildExport: BUILD });
    const button = container.querySelector("button");
    await act(async () => {
      button.click();
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
    expect(container.textContent).toContain("Export failed — retry");
    mocks.restore();
  });

  it("stays visible but disabled with a concise reason when there is no trustworthy data", () => {
    const buildExport = vi.fn();
    const { container } = renderButton({
      widgetTitle: "Planning and work plan",
      buildExport,
      disabled: true,
      disabledReason: "Export unavailable until the work steps load.",
    });
    const button = container.querySelector("button");
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Export CSV");
    expect(container.textContent).toContain("Export unavailable until the work steps load.");
    act(() => {
      button.click();
    });
    expect(buildExport).not.toHaveBeenCalled();
  });
});
