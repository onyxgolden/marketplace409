// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import ListingsPanel from "./ListingsPanel";

async function mountWith({ units, listings, forms }) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/api/rental/listings")) return { ok: true, json: async () => ({ listings }) };
    if (String(url).includes("/api/rental/application-forms")) return { ok: true, json: async () => ({ forms }) };
    if (String(url).includes("/api/rental/syndication")) return { ok: true, json: async () => ({ sites: [] }) };
    return { ok: true, json: async () => ({ units, leases: [], tenants: [] }) };
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<ListingsPanel />); });
  return { container, root, restore: () => { globalThis.fetch = originalFetch; } };
}

describe("ListingsPanel controls sweep — G4/L-16 explanations", () => {
  it("explains the empty-units placeholder in the new-listing editor", async () => {
    const { container, root, restore } = await mountWith({ units: [], listings: [], forms: [] });
    try {
      const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === "New listing");
      expect(button).toBeTruthy();
      await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(container.textContent).toContain("No available units — mark a unit available under Setup first");
      await act(async () => { root.unmount(); });
      container.remove();
    } finally { restore(); }
  });

  it("explains the fixed unit on an existing listing and the undeletable default form", async () => {
    const listings = [{ id: "listing_1", unitId: "unit_1", title: "Sunny 2-bed", status: "active" }];
    const forms = [{ id: "form_1", name: "Standard application", isDefault: true, sections: { a: true }, customQuestions: [], feeAmountCents: 0 }];
    const { container, root, restore } = await mountWith({ units: [{ id: "unit_1", label: "930 Highland Drive", property_id: "930-highland-drive" }], listings, forms });
    try {
      const edit = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === "Edit");
      expect(edit).toBeTruthy();
      await act(async () => { edit.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(container.textContent).toContain("The unit is fixed when editing a listing");
      const close = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === "Cancel");
      if (close) await act(async () => { close.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      const formsTab = [...container.querySelectorAll('[role="tab"]')].find((candidate) => candidate.textContent.toLowerCase().includes("form"));
      expect(formsTab).toBeTruthy();
      await act(async () => { formsTab.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(container.textContent).toContain("The default form cannot be deleted.");
      await act(async () => { root.unmount(); });
      container.remove();
    } finally { restore(); }
  });
});
