// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache } from "../../../hooks/swrCache";
import RentalDepositsPanel, { depositBalance } from "./RentalDepositsPanel";

afterEach(() => { clearSWRCache(); });

const baseData = {
  deposits: [{ id: "dep_1", lease_id: "lease_1", tenant_id: "tenant_1", required_amount_cents: 180000, status: "required", jurisdiction_code: "TX" }],
  transactions: [
    { id: "tx_1", deposit_id: "dep_1", transaction_type: "received", amount_cents: 180000, occurred_at: "2026-10-13T12:00:00Z", description: "Move-in" },
    { id: "tx_2", deposit_id: "dep_1", transaction_type: "deduction", amount_cents: 5000, occurred_at: "2026-10-20T12:00:00Z", description: "Cleaning", voided_at: "2026-10-31T00:00:00Z", void_reason: "Wrong unit" },
  ],
  schedules: [],
  tenants: [{ id: "tenant_1", display_name: "Steven Crabtree" }],
};

describe("RentalDepositsPanel controls sweep — G6 deposit corrections", () => {
  it("depositBalance excludes voided transactions", () => {
    expect(depositBalance(baseData.deposits[0], baseData.transactions)).toBe(180000);
  });

  it("shows Edit and Void requirement plus per-transaction Void, and marks voided rows", () => {
    const markup = renderToStaticMarkup(<RentalDepositsPanel initialData={baseData} />);
    expect(markup).toContain("Edit requirement");
    expect(markup).toContain("Void requirement");
    expect(markup).toContain("Void transaction");
    expect(markup).toContain("Voided: Wrong unit");
    expect(markup).toContain("void it and record the corrected one");
  });

  it("shows no Edit on a void requirement, only the preservation text", () => {
    const markup = renderToStaticMarkup(<RentalDepositsPanel initialData={{ ...baseData, deposits: [{ ...baseData.deposits[0], status: "void" }] }} />);
    expect(markup).toContain("cannot be edited");
    expect(markup).not.toContain("Edit requirement");
    expect(markup).not.toContain("Void requirement");
  });

  it("posts update-security-deposit from the edit form and confirms", async () => {
    const posted = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (options?.method === "POST") { posted.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ success: true }) }; }
      return { ok: true, json: async () => ({ deposits: baseData.deposits, depositTransactions: baseData.transactions, schedules: [], tenants: baseData.tenants }) };
    };
    try {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => { root.render(<RentalDepositsPanel initialData={baseData} />); });
      const edit = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === "Edit requirement");
      expect(edit).toBeTruthy();
      await act(async () => { edit.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      const form = container.querySelector('form[aria-label="Edit deposit requirement"]');
      expect(form).toBeTruthy();
      form.querySelector('input[name="amount"]').value = "1900";
      await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({ operation: "update-security-deposit", deposit: { depositId: "dep_1", requiredAmountCents: 190000 } });
      expect(container.textContent).toContain("Deposit requirement updated: $1,900.00");
      await act(async () => { root.unmount(); });
      container.remove();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("posts void-security-deposit-transaction with a reason and confirms", async () => {
    const posted = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (options?.method === "POST") { posted.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ success: true }) }; }
      return { ok: true, json: async () => ({ deposits: baseData.deposits, depositTransactions: baseData.transactions, schedules: [], tenants: baseData.tenants }) };
    };
    try {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => { root.render(<RentalDepositsPanel initialData={baseData} />); });
      const voidButton = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === "Void transaction");
      expect(voidButton).toBeTruthy();
      await act(async () => { voidButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      const form = container.querySelector('form[aria-label="Void transaction tx_1"]');
      expect(form).toBeTruthy();
      form.querySelector('input[name="reason"]').value = "Mistyped amount";
      await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({ operation: "void-security-deposit-transaction", transactionId: "tx_1", reason: "Mistyped amount" });
      expect(container.textContent).toContain("Deposit transaction voided.");
      await act(async () => { root.unmount(); });
      container.remove();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
