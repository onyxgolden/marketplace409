// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import TenantInvoiceEditor from "./TenantInvoiceEditor";

afterEach(() => { vi.unstubAllGlobals(); });

describe("TenantInvoiceEditor controls sweep — B2 delete text", () => {
  it("names the real payment-resolution paths in the delete explanation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ charge: { id: "charge_1", dueDate: "2026-11-01", notes: "", chargeType: "other", amountCents: 100000, paidCents: 0 } }),
    })));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<TenantInvoiceEditor chargeId="charge_1" tenantId="tenant_1" tenantName="Test Tenant" onClose={() => {}} onSaved={() => {}} />);
    });
    await act(async () => {});
    const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent.includes("Delete Invoice"));
    expect(button).toBeTruthy();
    await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(container.textContent).toContain("void the offline payment or refund the Stripe payment first");
    await act(async () => { root.unmount(); });
    container.remove();
  });
});
