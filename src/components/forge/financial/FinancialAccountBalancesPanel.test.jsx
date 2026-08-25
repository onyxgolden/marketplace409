// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FinancialAccountBalancesPanel from "./FinancialAccountBalancesPanel";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}
function unmount({ container, root }) {
  act(() => { root.unmount(); });
  container.remove();
}
async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe("FinancialAccountBalancesPanel", () => {
  let mounted;
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    if (mounted) { unmount(mounted); mounted = null; }
    vi.unstubAllGlobals();
  });

  it("renders nothing when there are no eligible accounts", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, accounts: [] }) });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();
    expect(mounted.container.querySelector("[data-financial-account-balances]")).toBeNull();
  });

  it("shows a read-only row with provider attribution for a synced (non-manual) account", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        accounts: [{
          id: "acct-1", name: "Chase Credit Card", type: "credit", kind: "liability",
          latestBalance: { currentBalanceCents: -20000, asOf: "2026-08-01", provider: "plaid", editable: false },
        }],
      }),
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();

    expect(mounted.container.textContent).toContain("Chase Credit Card");
    expect(mounted.container.textContent).toContain("Synced from plaid");
    expect(mounted.container.querySelector('[data-account-balance-row="acct-1"] input')).toBeNull();
  });

  it("shows an editable form for an account with no balance yet, and saves it", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          accounts: [{ id: "acct-1", name: "Business Savings", type: "depository", kind: "asset", latestBalance: null }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, balance: {} }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          accounts: [{
            id: "acct-1", name: "Business Savings", type: "depository", kind: "asset",
            latestBalance: { currentBalanceCents: 500000, asOf: "2026-08-01", provider: "manual", editable: true },
          }],
        }),
      });

    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();

    const row = mounted.container.querySelector('[data-account-balance-row="acct-1"]');
    const input = row.querySelector('input[type="number"]');
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    act(() => {
      nativeInputValueSetter.call(input, "5000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = row.querySelector("form");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/financial/account-balances", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"currentBalanceCents":500000'),
    }));
  });

  it("lets a manual balance be updated via the Update link", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        accounts: [{
          id: "acct-1", name: "Business Savings", type: "depository", kind: "asset",
          latestBalance: { currentBalanceCents: 500000, asOf: "2026-08-01", provider: "manual", editable: true },
        }],
      }),
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();

    const row = mounted.container.querySelector('[data-account-balance-row="acct-1"]');
    expect(row.querySelector("form")).toBeNull();
    const updateButton = Array.from(row.querySelectorAll("button")).find((b) => b.textContent === "Update");
    act(() => { updateButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    expect(row.querySelector("form")).not.toBeNull();
  });

  it("shows an error when the save request fails", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          accounts: [{ id: "acct-1", name: "Business Savings", type: "depository", kind: "asset", latestBalance: null }],
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: "This account is synced automatically." }) });

    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();

    const row = mounted.container.querySelector('[data-account-balance-row="acct-1"]');
    const input = row.querySelector('input[type="number"]');
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    act(() => {
      nativeInputValueSetter.call(input, "5000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = row.querySelector("form");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(row.querySelector('[role="alert"]').textContent).toContain("This account is synced automatically.");
  });
});
