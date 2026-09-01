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
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

const EMPTY = { accountBalances: { success: true, accounts: [] }, assets: { success: true, assets: [] }, investmentAccounts: { success: true, accounts: [] } };

// Routes each fetch() call to the matching fixture by URL, independent of call order, so a test
// only needs to override the endpoint(s) it actually cares about.
function stubFetch(overrides = {}) {
  const responses = { ...EMPTY, ...overrides };
  const fetchMock = vi.fn(async (url) => {
    if (url === "/api/financial/account-balances") return { ok: true, json: async () => responses.accountBalances };
    if (url === "/api/financial/assets") return { ok: true, json: async () => responses.assets };
    if (url === "/api/financial/investment-accounts") return { ok: true, json: async () => responses.investmentAccounts };
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("FinancialAccountBalancesPanel", () => {
  let mounted;

  afterEach(() => {
    if (mounted) { unmount(mounted); mounted = null; }
    vi.unstubAllGlobals();
  });

  it("renders nothing when there are no eligible accounts, assets, or investment accounts", async () => {
    stubFetch();
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();
    expect(mounted.container.querySelector("[data-financial-account-balances]")).toBeNull();
  });

  it("shows a read-only row with provider attribution for a synced (non-manual) account", async () => {
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [{
          id: "acct-1", name: "Chase Credit Card", type: "credit", kind: "liability",
          latestBalance: { currentBalanceCents: -20000, asOf: "2026-08-01", provider: "plaid", editable: false },
        }],
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();

    expect(mounted.container.textContent).toContain("Chase Credit Card");
    expect(mounted.container.textContent).toContain("Synced from plaid");
    expect(mounted.container.querySelector('[data-account-balance-row="acct-1"] input')).toBeNull();
  });

  it("shows an editable form for an account with no balance yet, and saves it", async () => {
    const fetchMock = stubFetch({
      accountBalances: {
        success: true,
        accounts: [{ id: "acct-1", name: "Business Savings", type: "depository", kind: "asset", latestBalance: null }],
      },
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

    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ success: true, balance: {} }) }));

    const form = row.querySelector("form");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/financial/account-balances", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"currentBalanceCents":500000'),
    }));
  });

  it("lets a manual balance be updated via the Update link", async () => {
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [{
          id: "acct-1", name: "Business Savings", type: "depository", kind: "asset",
          latestBalance: { currentBalanceCents: 500000, asOf: "2026-08-01", provider: "manual", editable: true },
        }],
      },
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
    const fetchMock = stubFetch({
      accountBalances: {
        success: true,
        accounts: [{ id: "acct-1", name: "Business Savings", type: "depository", kind: "asset", latestBalance: null }],
      },
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

    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 409, json: async () => ({ error: "This account is synced automatically." }) }));

    const form = row.querySelector("form");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(row.querySelector('[role="alert"]').textContent).toContain("This account is synced automatically.");
  });

  it("groups Banking, Investments (with sub-groups), Assets (with sub-groups), and combined Liabilities", async () => {
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [
          { id: "acct-bank", name: "Business Checking", type: "depository", kind: "asset", latestBalance: { currentBalanceCents: 100000, asOf: "2026-08-01", provider: "manual", editable: true } },
          { id: "acct-inv", name: "Brokerage Linked", type: "investment", kind: "asset", latestBalance: { currentBalanceCents: 200000, asOf: "2026-08-01", provider: "manual", editable: true } },
          { id: "acct-credit", name: "Chase Credit Card", type: "credit", kind: "liability", latestBalance: { currentBalanceCents: -20000, asOf: "2026-08-01", provider: "manual", editable: true } },
          { id: "acct-loan", name: "Auto Loan", type: "loan", kind: "liability", latestBalance: { currentBalanceCents: -1500000, asOf: "2026-08-01", provider: "manual", editable: true } },
        ],
      },
      assets: {
        success: true,
        assets: [
          { id: "asset-1", name: "145 Laxon", assetClass: "real_estate", ownershipScope: "business", latestValuation: { amountCents: 15000000, effectiveDate: "2026-08-01" } },
          { id: "asset-2", name: "2015 Toyota Tacoma", assetClass: "vehicle", ownershipScope: "personal", latestValuation: { amountCents: 1800000, effectiveDate: "2026-08-01" } },
          { id: "asset-3", name: "Box Trailer", assetClass: "trailer", ownershipScope: "business", latestValuation: { amountCents: 400000, effectiveDate: "2026-08-01" } },
        ],
      },
      investmentAccounts: {
        success: true,
        accounts: [
          { id: "inv-1", name: "Traditional IRA", accountType: "ira", ownershipScope: "personal", latestValuation: { amountCents: 410213, effectiveDate: "2026-08-01" } },
        ],
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();

    const text = mounted.container.textContent;
    expect(text).toContain("Banking");
    expect(text).toContain("Investments");
    expect(text).toContain("Assets");
    expect(text).toContain("Liabilities");
    // Liabilities is one combined group -- credit and loan are not split into separate top-level groups.
    expect(text).not.toContain("Credit Cards");
    expect(text).not.toContain("Loans");
    expect(text).toContain("Linked Accounts");
    expect(text).toContain("Retirement");
    expect(text).toContain("Real Estate");
    expect(text).toContain("Vehicles");
    expect(text).toContain("Other Assets");
    expect(text).toContain("Traditional IRA");
    expect(text).toContain("145 Laxon");
    expect(text).toContain("Box Trailer");

    // Liabilities combined subtotal: $200.00 credit + $15,000.00 loan = $15,200.00 on the group header.
    const liabilitiesGroup = mounted.container.querySelector('[data-account-category="liabilities"]');
    expect(liabilitiesGroup.querySelector("button").textContent).toContain("$15,200.00");
  });

  it("collapses and expands a top-level group on click", async () => {
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [{ id: "acct-1", name: "Business Checking", type: "depository", kind: "asset", latestBalance: { currentBalanceCents: 100000, asOf: "2026-08-01", provider: "manual", editable: true } }],
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();

    const group = mounted.container.querySelector('[data-account-category="banking"]');
    expect(group.querySelector('[data-account-balance-row="acct-1"]')).not.toBeNull();

    const toggle = group.querySelector("button");
    act(() => { toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(group.querySelector('[data-account-balance-row="acct-1"]')).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    act(() => { toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(group.querySelector('[data-account-balance-row="acct-1"]')).not.toBeNull();
  });
});
