// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalInsurancePanel, { insuranceState } from "./RentalInsurancePanel";
import { clearSWRCache } from "@/hooks/swrCache";

// Controls-sweep follow-up G22 (O-13): verified-expired distinction,
// paper-proof recording, pending-proof editing, reopen.
const REJECTED = { id: "pol_rej", carrier_name: "Acme", policy_number_masked: "POL-1",
  liability_limit_cents: 100000, effective_date: "2026-01-01", expiration_date: "2027-01-01",
  status: "rejected", evidence_id: "drawer A", verified_at: null };
const PENDING = { ...REJECTED, id: "pol_pen", status: "pending_verification" };
const VERIFIED_EXPIRED = { ...REJECTED, id: "pol_vexp", status: "verified", expiration_date: "2026-10-01", verified_at: "2026-01-05T00:00:00Z" };
const VERIFIED_FORCE = { ...REJECTED, id: "pol_v", status: "verified", expiration_date: "2027-01-01", verified_at: "2026-01-05T00:00:00Z" };

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

describe("RentalInsurancePanel follow-up G22", () => {
  let container;
  let root;
  let posts;

  async function renderPanel(policies) {
    posts = [];
    clearSWRCache();
    vi.stubGlobal("fetch", async (url, options = {}) => {
      if (options.method === "POST") {
        posts.push(JSON.parse(options.body || "{}"));
        return { ok: true, json: async () => ({ success: true }) };
      }
      if (String(url) === "/api/rental") {
        return { ok: true, json: async () => ({
          leases: [{ id: "lease_1", status: "active", unit_id: "unit_1" }],
          units: [{ id: "unit_1", label: "Unit A" }],
        }) };
      }
      return { ok: true, json: async () => ({ policies }) };
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<RentalInsurancePanel initialPolicies={policies} />); });
    await flush();
  }

  afterEach(() => { act(() => { root?.unmount(); }); container?.remove(); vi.unstubAllGlobals(); });

  it("O-13: insuranceState distinguishes verified-expired from unverified expired", () => {
    expect(insuranceState(VERIFIED_EXPIRED, "2026-11-01")).toBe("verified_expired");
    expect(insuranceState({ ...PENDING, expiration_date: "2026-10-01" }, "2026-11-01")).toBe("expired");
    expect(insuranceState(VERIFIED_FORCE, "2026-11-01")).toBe("verified");
    expect(insuranceState(REJECTED, "2026-11-01")).toBe("rejected");
  });

  it("O-13: rejected policy reopens for review", async () => {
    await renderPanel([REJECTED]);
    expect(container.textContent).toContain("stay on record");
    click(buttonWithText(container, "Reopen for review"));
    await flush();
    expect(posts[0]).toMatchObject({ operation: "reopen-insurance-policy", policyId: "pol_rej" });
    expect(container.textContent).toContain("Policy reopened");
  });

  it("O-13: verified-expired policy reopens, verified in-force does not", async () => {
    await renderPanel([VERIFIED_EXPIRED]);
    expect(container.textContent).toContain("verified expired");
    expect(buttonWithText(container, "Reopen for review")).toBeTruthy();
    await act(() => { root.unmount(); });
    container.remove();
    await renderPanel([VERIFIED_FORCE]);
    expect(buttonWithText(container, "Reopen for review")).toBeFalsy();
  });

  it("O-13: pending policy edits in place and stays pending", async () => {
    await renderPanel([PENDING]);
    click(buttonWithText(container, "Edit proof"));
    await flush();
    const form = container.querySelector("form");
    expect(form.querySelector('input[placeholder="Carrier"]').value).toBe("Acme");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(posts[0].operation).toBe("update-insurance-proof");
    expect(posts[0].policy.id).toBe("pol_pen");
    expect(container.textContent).toContain("Insurance proof updated");
  });

  it("O-13: paper proof records against an active lease", async () => {
    await renderPanel([PENDING]);
    click(buttonWithText(container, "Record proof"));
    await flush();
    const form = container.querySelector("form");
    setValue(form.querySelector("select"), "lease_1");
    setValue(form.querySelector('input[placeholder="Carrier"]'), "Beta");
    setValue(form.querySelector('input[placeholder="Policy number"]'), "POL-9");
    setValue(form.querySelector('input[placeholder="Liability limit ($)"]'), "250000");
    setValue(form.querySelectorAll('input[type="date"]')[0], "2026-11-01");
    setValue(form.querySelectorAll('input[type="date"]')[1], "2027-11-01");
    setValue(form.querySelector('input[placeholder^="Evidence reference"]'), "drawer B");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(posts[0].operation).toBe("record-insurance-proof");
    expect(posts[0].policy.liabilityLimitCents).toBe(25000000);
    expect(container.textContent).toContain("Insurance proof recorded");
  });
});
