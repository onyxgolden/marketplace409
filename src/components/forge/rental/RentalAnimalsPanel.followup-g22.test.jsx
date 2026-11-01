// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalAnimalsPanel from "./RentalAnimalsPanel";
import { clearSWRCache } from "@/hooks/swrCache";

// Controls-sweep follow-up G22 (O-12): landlord animal recording,
// re-review on decided animals, and revoke.
const REQUESTED = { id: "animal_req", name: "Rex", breed_description: "Lab mix", classification: "pet", approval_status: "requested" };
const APPROVED = { id: "animal_app", name: "Bella", breed_description: "Beagle", classification: "pet", approval_status: "approved" };
const BODY = {
  animals: [REQUESTED, APPROVED],
  leases: [{ id: "lease_1", status: "active", unit_id: "unit_1" }],
  units: [{ id: "unit_1", label: "Unit A" }],
};

async function flush(times = 10) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
function click(el) { act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); }
function buttonWithText(root, text) {
  return [...root.querySelectorAll("button")].find((b) => b.textContent.includes(text));
}
function setValue(el, value) {
  const proto = el instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  act(() => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
}

describe("RentalAnimalsPanel follow-up G22", () => {
  let container;
  let root;
  let posts;

  async function renderPanel() {
    posts = [];
    clearSWRCache();
    vi.stubGlobal("fetch", async (url, options = {}) => {
      if (options.method === "POST") {
        posts.push(JSON.parse(options.body || "{}"));
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => BODY };
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<RentalAnimalsPanel />); });
    await flush();
  }

  afterEach(() => { act(() => { root?.unmount(); }); container?.remove(); vi.unstubAllGlobals(); });

  it("O-12: records an animal against an active lease", async () => {
    await renderPanel();
    click(buttonWithText(container, "Record an animal"));
    await flush();
    const form = container.querySelector("form");
    const selects = form.querySelectorAll("select");
    setValue(selects[0], "lease_1");
    setValue(form.querySelector('input[placeholder="Animal name"]'), "Rex");
    setValue(form.querySelector('input[placeholder="Breed description"]'), "Lab mix");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(posts[0].operation).toBe("create-animal");
    expect(posts[0].animal.leaseId).toBe("lease_1");
    expect(posts[0].animal.name).toBe("Rex");
    expect(container.textContent).toContain("Animal recorded");
  });

  it("O-12: decided animals show re-review and revoke", async () => {
    await renderPanel();
    expect(container.textContent).toContain("this decision is not final");
    const articles = [...container.querySelectorAll("article")];
    const approvedArticle = articles.find((a) => a.textContent.includes("Bella"));
    expect(approvedArticle.textContent).toContain("Save review");
    click(buttonWithText(approvedArticle, "Revoke approval"));
    await flush();
    expect(posts[0]).toMatchObject({ operation: "revoke-animal", animalId: "animal_app" });
    expect(container.textContent).toContain("Approval revoked");
  });
});
