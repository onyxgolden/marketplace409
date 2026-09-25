// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import TenantCreditSection from "./TenantCreditSection";

const credits = [{
  id: "credit_1", tenant_id: "t1", lease_id: "lease_1", amount_cents: 3200, remaining_cents: 1200,
  source: "overpayment", source_payment_id: "pay_1", status: "open", notes: null,
  voided_at: null, voided_by: null, void_reason: null, created_at: "2026-09-05T12:00:00Z",
}];
const applications = [{
  id: "app_1", credit_id: "credit_1", tenant_id: "t1", lease_id: "lease_1", charge_id: "charge_oct",
  amount_cents: 2000, applied_at: "2026-10-01T12:00:00Z", notes: null,
}];
const openCharges = [{ id: "charge_nov", period: "2026-11", remainingCents: 150000 }];

function renderSection(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<TenantCreditSection credits={credits} creditApplications={applications} openCharges={openCharges} onChanged={vi.fn()} {...props} />));
  return { container, root };
}

describe("TenantCreditSection", () => {
  let container;
  let root;

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.unstubAllGlobals();
  });

  it("renders nothing when the tenant has no credits", () => {
    ({ container, root } = renderSection({ credits: [] }));
    expect(container.querySelector("[data-tenant-credits]")).toBeNull();
  });

  it("shows the credit with its remaining balance and application history", () => {
    ({ container, root } = renderSection());
    const section = container.querySelector("[data-tenant-credits]");
    expect(section.textContent).toContain("$32.00");
    expect(section.textContent).toContain("$12.00 remaining");
    expect(section.textContent).toContain("Applied $20.00 on 2026-10-01");
  });

  it("gates manual application behind checkbox + CONFIRM and posts with owner confirmation", async () => {
    const post = vi.fn(async () => ({ ok: true, json: async () => ({ application: { id: "app_2" } }) }));
    vi.stubGlobal("fetch", post);
    const onChanged = vi.fn();
    ({ container, root } = renderSection({ onChanged }));
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      container.querySelectorAll("button").forEach((button) => {
        if (button.textContent === "Apply to a charge…") button.dispatchEvent(new Event("click", { bubbles: true }));
      });
    });
    // Pick the charge and a partial amount.
    const select = container.querySelector("select");
    const selectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    await act(async () => {
      selectSetter.call(select, "charge_nov");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const amount = container.querySelector('input[placeholder="0.00"]');
    await act(async () => {
      nativeSetter.call(amount, "12");
      amount.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Ungated submit: the gate holds, nothing posts.
    await act(async () => {
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Apply credit")
        .dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(post).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]').textContent).toContain("CONFIRM");
    // Gate properly: checkbox + CONFIRM, then the POST carries owner confirmation.
    const checkbox = container.querySelector('input[type="checkbox"]');
    const checkedSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked").set;
    const confirm = container.querySelector('input[placeholder="CONFIRM"]');
    await act(async () => {
      checkedSetter.call(checkbox, true);
      checkbox.dispatchEvent(new Event("click", { bubbles: true }));
      nativeSetter.call(confirm, "CONFIRM");
      confirm.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Apply credit")
        .dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(JSON.parse(post.mock.calls[0][1].body)).toEqual({
      operation: "apply-tenant-credit",
      credit: { creditId: "credit_1", chargeId: "charge_nov", amountCents: 1200, ownerConfirmed: true },
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("requires a reason to void and posts the void behind the same human gate", async () => {
    const post = vi.fn(async () => ({ ok: true, json: async () => ({ credit: { id: "credit_1", status: "void" } }) }));
    vi.stubGlobal("fetch", post);
    ({ container, root } = renderSection());
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Void remaining…")
        .dispatchEvent(new Event("click", { bubbles: true }));
    });
    // No reason: rejected before any network call.
    await act(async () => {
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Void credit")
        .dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(post).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]').textContent).toContain("reason is required");
    // Reason but no gate: still held.
    const reason = container.querySelector('input[placeholder="e.g. refunded to tenant in cash"]');
    await act(async () => {
      nativeSetter.call(reason, "Recorded in error");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Void credit")
        .dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(post).not.toHaveBeenCalled();
    // Gate: checkbox + CONFIRM posts the void with the reason. (Only the void panel is
    // open, so the section's single checkbox is the void gate.)
    const check = container.querySelector('input[type="checkbox"]');
    const checkedSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked").set;
    const confirm = container.querySelector('input[placeholder="CONFIRM"]');
    await act(async () => {
      checkedSetter.call(check, true);
      check.dispatchEvent(new Event("click", { bubbles: true }));
      nativeSetter.call(confirm, "CONFIRM");
      confirm.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Void credit")
        .dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(JSON.parse(post.mock.calls[0][1].body)).toEqual({
      operation: "void-tenant-credit",
      creditId: "credit_1", reason: "Recorded in error", ownerConfirmed: true,
    });
  });

  it("shows the void reason from the audit columns on a voided credit", () => {
    const voided = [{ ...credits[0], status: "void", remaining_cents: 0, voided_at: "2026-09-10T12:00:00Z", void_reason: "Recorded in error" }];
    ({ container, root } = renderSection({ credits: voided }));
    expect(container.querySelector("[data-tenant-credits]").textContent).toContain("Voided on 2026-09-10: Recorded in error");
  });
});
