// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkPackageImportDialog from "./WorkPackageImportDialog.jsx";

const PREVIEW = {
  success: true,
  kind: "packages",
  packageId: null,
  sourceSystem: null,
  sourceTrackingAvailable: false,
  columns: [
    { header: "Title", fieldKey: "title" },
    { header: "Status", fieldKey: "status" },
  ],
  rows: [{ title: "Kent kitchen", status: "draft" }],
  plan: {
    creates: [{ rowIndex: 0, fields: { title: "Kent kitchen" }, statusTarget: "draft" }],
    updates: [],
    errors: [],
    summary: { createCount: 1, updateCount: 0, errorCount: 0 },
  },
};

const CONFIRM = {
  success: true,
  kind: "packages",
  created: [{ rowIndex: 0, package: { id: "wp_new", code: "WP-0007", title: "Kent kitchen" } }],
  updated: [],
  warnings: [],
  errors: [],
  summary: { created: 1, updated: 0, warnings: 0, errors: 0 },
};

async function renderDialog(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onImported = vi.fn();
  const onClose = vi.fn();
  await act(async () => {
    root.render(<WorkPackageImportDialog kind="packages" onImported={onImported} onClose={onClose} {...props} />);
  });
  await act(async () => {});
  return { container, root, onImported, onClose };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("WorkPackageImportDialog", () => {
  it("previews a file, shows the plan, and confirms the import", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET" });
      const body = calls.length === 1 ? PREVIEW : CONFIRM;
      return { ok: true, json: async () => body };
    }));
    const { container, onImported } = await renderDialog();
    expect(container.textContent).toContain("Import packages from a file");
    expect(container.textContent).toContain("Download the CSV template");

    const fileInput = container.querySelector('input[type="file"]');
    const file = new File(["Title,Status\nKent kitchen,draft\n"], "import.csv", { type: "text/csv" });
    Object.defineProperty(fileInput, "files", { value: [file] });
    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const previewButton = [...container.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Preview import");
    await act(async () => { previewButton.click(); });
    await act(async () => {});

    expect(calls[0].url).toBe("/api/work-packages/import/preview");
    expect(container.textContent).toContain("Column mapping");
    expect(container.textContent).toContain("1 to create");
    expect(container.textContent).toContain("Create: Kent kitchen");
    // Source tracking is unavailable in the mocked preview: the
    // dialog says so plainly instead of promising idempotency.
    expect(container.textContent).toContain("Source record IDs cannot be saved yet");

    const confirmButton = [...container.querySelectorAll("button")]
      .find((b) => b.textContent.trim().startsWith("Import 1 rows"));
    await act(async () => { confirmButton.click(); });
    await act(async () => {});
    expect(calls[1].url).toBe("/api/work-packages/import/confirm");
    expect(container.textContent).toContain("Import finished: 1 created, 0 updated");
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("1 created"),
    }));
  });

  it("blocks confirm while the plan has errors", async () => {
    const errorPreview = {
      ...PREVIEW,
      success: false,
      plan: {
        creates: [],
        updates: [],
        errors: [{ rowIndex: 0, message: 'Row 1: Status "flying" is not a work package status.' }],
        summary: { createCount: 0, updateCount: 0, errorCount: 1 },
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => errorPreview })));
    const { container } = await renderDialog();
    const fileInput = container.querySelector('input[type="file"]');
    Object.defineProperty(fileInput, "files", {
      value: [new File(["Title,Status\nBad,flying\n"], "import.csv", { type: "text/csv" })],
    });
    const previewButton = [...container.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Preview import");
    await act(async () => { previewButton.click(); });
    await act(async () => {});
    expect(container.textContent).toContain('Status "flying"');
    const confirmButton = [...container.querySelectorAll("button")]
      .find((b) => b.textContent.trim().startsWith("Import"));
    expect(confirmButton.disabled).toBe(true);
  });
});
