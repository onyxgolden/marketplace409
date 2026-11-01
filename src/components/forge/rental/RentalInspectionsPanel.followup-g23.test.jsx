// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalInspectionsPanel from "./RentalInspectionsPanel";
import { clearSWRCache } from "@/hooks/swrCache";

// Controls-sweep follow-up G23 (O-14, O-15): draft edit, delete, terminality text.
const DRAFT = { id: "insp_draft", lease_id: "lease_1", unit_id: "unit_1", tenant_id: "tenant_1",
  inspection_type: "move_in", inspection_date: "2026-11-01", status: "draft", general_notes: "Entry scuff" };
const FINALIZED = { ...DRAFT, id: "insp_fin", status: "finalized", general_notes: null };
const DRAFT_ITEM = { id: "item_1", inspection_id: "insp_draft", area: "Entry", component: "Overall condition",
  condition_rating: "good", notes: "", damage_observed: false, deposit_review_recommended: false,
  estimated_cost_cents: null, evidence_document_id: null };
const BASE = {
  inspections: [DRAFT],
  inspectionItems: [DRAFT_ITEM],
  inspectionAcknowledgements: [],
  leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "prop_1", status: "active" }],
  units: [{ id: "unit_1", label: "Unit A" }],
  leaseMemberships: [{ lease_id: "lease_1", tenant_id: "tenant_1" }],
  tenants: [{ id: "tenant_1", display_name: "Dana" }],
  documents: [],
};

async function flush(times = 10) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
function click(el) { act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); }
function buttonWithText(root, text) {
  return [...root.querySelectorAll("button")].find((b) => b.textContent.includes(text));
}

describe("RentalInspectionsPanel follow-up G23", () => {
  let container;
  let root;
  let posts;

  async function renderPanel(data) {
    posts = [];
    clearSWRCache();
    vi.stubGlobal("fetch", async (url, options = {}) => {
      if (options.method === "POST") {
        posts.push(JSON.parse(options.body || "{}"));
        return { ok: true, json: async () => ({ success: true }) };
      }
      if (String(url) === "/api/rental/documents") return { ok: true, json: async () => ({ documents: [] }) };
      return { ok: true, json: async () => data };
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<RentalInspectionsPanel initialData={data} />); });
    await flush();
  }

  afterEach(() => { act(() => { root?.unmount(); }); container?.remove(); vi.unstubAllGlobals(); });

  it("O-14: draft edits in place with the same id", async () => {
    await renderPanel(BASE);
    click(buttonWithText(container, "Edit draft"));
    await flush();
    const form = container.querySelector('form[aria-label="Edit draft inspection"]');
    expect(form).toBeTruthy();
    expect(form.querySelector('input[name="inspectionDate"]').value).toBe("2026-11-01");
    expect(form.querySelector('select[name="leaseId"]').value).toBe("lease_1");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(posts[0].operation).toBe("save-inspection");
    expect(posts[0].inspection.id).toBe("insp_draft");
    expect(container.textContent).toContain("Draft inspection updated");
  });

  it("O-14: delete asks twice, then posts", async () => {
    await renderPanel(BASE);
    click(buttonWithText(container, "Delete inspection"));
    await flush();
    expect(buttonWithText(container, "Delete this inspection")).toBeTruthy();
    click(buttonWithText(container, "Delete this inspection"));
    await flush();
    expect(posts[0]).toMatchObject({ operation: "delete-inspection", inspectionId: "insp_draft" });
    expect(container.textContent).toContain("Inspection deleted");
  });

  it("O-15: finalized shows terminality text and no edit or finalize control", async () => {
    await renderPanel({ ...BASE, inspections: [FINALIZED], inspectionItems: [{ ...DRAFT_ITEM, inspection_id: "insp_fin" }] });
    expect(container.textContent).toContain("Finalization publishes to the tenant portal; create a new inspection to correct.");
    expect(buttonWithText(container, "Edit draft")).toBeFalsy();
    expect(buttonWithText(container, "Finalize and publish")).toBeFalsy();
    expect(buttonWithText(container, "Delete inspection")).toBeTruthy();
  });
});
