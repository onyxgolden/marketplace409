// @vitest-environment jsdom
import { act } from "react"; import { createRoot } from "react-dom/client"; import { renderToStaticMarkup } from "react-dom/server"; import { afterEach, describe, expect, it, vi } from "vitest";
import ReservationInventoryBulkImport from "./ReservationInventoryBulkImport";
describe("ReservationInventoryBulkImport", () => {
  let mounted;
  afterEach(() => { if (mounted) { act(() => mounted.root.unmount()); mounted.container.remove(); mounted = null; } vi.unstubAllGlobals(); });
  it("offers a template, local CSV selection, preview, and no immediate import", () => {
    const markup = renderToStaticMarkup(<ReservationInventoryBulkImport/>);
    expect(markup).toContain("Download CSV template"); expect(markup).toContain('type="file"'); expect(markup).toContain("Preview import"); expect(markup).not.toContain("Import all units"); expect(markup).toContain("Drivable RVs are excluded");
  });
  it("shows reconciliation and keeps confirmation disabled until acknowledgement plus typed IMPORT", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ previewToken: "signed-token", reconciliation: { totalRows: 1, validRows: 1, errorRows: 0, rows: [{ rowNumber: 2, propertyId: "Pine Park", unitLabel: "Site 1", inventory: { inventoryType: "rv_site", nightlyRateCents: 5500 }, errors: [] }] } }) })));
    const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container); mounted = { container, root };
    await act(async () => { root.render(<ReservationInventoryBulkImport/>); });
    const input = container.querySelector('input[type="file"]'); Object.defineProperty(input, "files", { value: [{ name: "spots.csv", text: async () => "csv" }] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await Promise.resolve(); });
    const previewButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Preview import");
    await act(async () => { previewButton.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain("Pine Park"); expect(container.textContent).toContain("Ready");
    const importButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Import all units");
    expect(importButton.disabled).toBe(true); expect(container.textContent).toContain("Type IMPORT to confirm");
  });
});
