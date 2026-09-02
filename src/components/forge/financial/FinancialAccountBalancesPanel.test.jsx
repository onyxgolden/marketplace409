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

function expandGroup(container, key) {
  const group = container.querySelector(`[data-account-category="${key}"]`);
  const toggle = group.querySelector("button");
  if (toggle.getAttribute("aria-expanded") === "false") {
    act(() => { toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  }
  return group;
}

const EMPTY = { accountBalances: { success: true, accounts: [] }, assets: { success: true, assets: [] }, investmentAccounts: { success: true, accounts: [] } };

// Routes each fetch() call to the matching fixture by URL, independent of call order, so a test
// only needs to override the endpoint(s) it actually cares about.
function stubFetch(overrides = {}) {
  const responses = { ...EMPTY, ...overrides };
  const fetchMock = vi.fn(async (url, init) => {
    if (url === "/api/financial/account-balances") return { ok: true, json: async () => responses.accountBalances };
    if (url === "/api/financial/assets") return { ok: true, json: async () => responses.assets };
    if (url === "/api/financial/investment-accounts") return { ok: true, json: async () => responses.investmentAccounts };
    if (url === "/api/financial/accounts" && init?.method === "POST") {
      return { ok: true, json: async () => ({ success: true, accountId: "financial_account_manual_new" }) };
    }
    if (url === "/api/financial/assets" && (init?.method === "POST" || init?.method === "PATCH")) {
      return { ok: true, json: async () => ({ success: true, assetId: "asset_manual_new" }) };
    }
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
    expandGroup(mounted.container, "liabilities");

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
    expandGroup(mounted.container, "banking");

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

  it("lets a manual balance be updated via the Edit link", async () => {
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
    expandGroup(mounted.container, "banking");

    const row = mounted.container.querySelector('[data-account-balance-row="acct-1"]');
    expect(row.querySelector("form")).toBeNull();
    const editButton = Array.from(row.querySelectorAll("button")).find((b) => b.textContent === "Edit");
    act(() => { editButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

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

    expandGroup(mounted.container, "banking");

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
    expandGroup(mounted.container, "banking");
    expandGroup(mounted.container, "investments");
    expandGroup(mounted.container, "assets");
    expandGroup(mounted.container, "liabilities");

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

  it("doesn't double-count or double-show an investment account mirrored into financial_accounts", async () => {
    // The investment-accounts registry's create/update RPCs mirror themselves into
    // financial_accounts (same id, type "investment") so Net Worth stays accurate elsewhere in the
    // app. That mirror must not also render under Investments > Linked Accounts.
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [
          { id: "acct-bank", name: "Business Checking", type: "depository", kind: "asset", latestBalance: { currentBalanceCents: 100000, asOf: "2026-08-01", provider: "manual", editable: true } },
          { id: "investment_account_llc", name: "Limited Liability Company", type: "investment", kind: "asset", latestBalance: { currentBalanceCents: 17001742, asOf: "2026-08-25", provider: "manual_investment", editable: false } },
        ],
      },
      investmentAccounts: {
        success: true,
        accounts: [
          { id: "investment_account_llc", name: "Limited Liability Company", accountType: "private_investment", ownershipScope: "business", latestValuation: { amountCents: 17001742, effectiveDate: "2026-08-25" } },
        ],
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();
    expandGroup(mounted.container, "investments");

    expect(mounted.container.querySelectorAll('[data-account-balance-row="investment_account_llc"]')).toHaveLength(1);
    expect(mounted.container.querySelector('[data-account-category="investments"]').textContent).not.toContain("Linked Accounts");
    expect(mounted.container.querySelector('[data-account-category="investments.other_investments"]').textContent).toContain("Other Investments");

    // Net worth: $1,000.00 bank + $170,017.42 LLC, counted once each -- not $340,034.84 from a double-count.
    expect(mounted.container.querySelector("[data-net-worth]").textContent).toBe("$171,017.42");
  });

  it("starts top-level groups collapsed and expands them on click", async () => {
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [{ id: "acct-1", name: "Business Checking", type: "depository", kind: "asset", latestBalance: { currentBalanceCents: 100000, asOf: "2026-08-01", provider: "manual", editable: true } }],
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();

    const group = mounted.container.querySelector('[data-account-category="banking"]');
    expect(group.querySelector('[data-account-balance-row="acct-1"]')).toBeNull();
    expect(group.querySelector("button").getAttribute("aria-expanded")).toBe("false");

    const toggle = group.querySelector("button");
    act(() => { toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(group.querySelector('[data-account-balance-row="acct-1"]')).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    act(() => { toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(group.querySelector('[data-account-balance-row="acct-1"]')).toBeNull();
  });

  it("lets an existing asset's value be updated via the Edit link, without touching its name or class", async () => {
    const fetchMock = stubFetch({
      assets: {
        success: true,
        assets: [{
          id: "asset-1", name: "2015 Toyota Tacoma", assetClass: "vehicle", ownershipScope: "personal",
          latestValuation: { amountCents: 1800000, effectiveDate: "2026-08-01" },
        }],
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();

    expandGroup(mounted.container, "assets");

    const row = mounted.container.querySelector('[data-account-balance-row="asset-1"]');
    const editButton = Array.from(row.querySelectorAll("button")).find((button) => button.textContent === "Edit");
    act(() => { editButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    expect(row.querySelector("form")).not.toBeNull();
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const valueInput = row.querySelector('input[type="number"]');
    act(() => {
      nativeInputValueSetter.call(valueInput, "19500.00");
      valueInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      row.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    const patchCall = fetchMock.mock.calls.find(([url, init]) => url === "/api/financial/assets" && init?.method === "PATCH");
    expect(patchCall).toBeTruthy();
    expect(JSON.parse(patchCall[1].body)).toMatchObject({
      assetId: "asset-1", name: "2015 Toyota Tacoma", assetClass: "vehicle", ownershipScope: "personal", valueCents: 1950000,
    });
  });

  it("lets a new asset be added from the Assets group, defaulting to Vehicle", async () => {
    const fetchMock = stubFetch({
      assets: {
        success: true,
        assets: [{ id: "asset-1", name: "Existing Boat", assetClass: "other", ownershipScope: "business", latestValuation: { amountCents: 500000, effectiveDate: "2026-08-01" } }],
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();

    const assetsGroup = expandGroup(mounted.container, "assets");
    const addToggle = Array.from(assetsGroup.querySelectorAll("button")).find((b) => b.textContent === "+ Add asset");
    act(() => { addToggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    const form = Array.from(assetsGroup.querySelectorAll("form")).find((f) => f.querySelector('input[placeholder="Asset name"]'));
    expect(form).not.toBeNull();

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const nameInput = form.querySelector('input[placeholder="Asset name"]');
    const valueInput = form.querySelector('input[type="number"]');
    act(() => {
      nativeInputValueSetter.call(nameInput, "2015 Toyota Tacoma");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      nativeInputValueSetter.call(valueInput, "18000.00");
      valueInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    const postCall = fetchMock.mock.calls.find(([url, init]) => url === "/api/financial/assets" && init?.method === "POST");
    expect(postCall).toBeTruthy();
    // purchaseCostCents must be an explicit null, not omitted -- the API's optional-field parsing
    // (`body?.purchaseCostCents === null || === undefined || === "" ? null : Number(...)`) would
    // otherwise turn an omitted field into Number(undefined) = NaN and fail "must be whole cents".
    expect(JSON.parse(postCall[1].body)).toMatchObject({
      name: "2015 Toyota Tacoma", assetClass: "vehicle", ownershipScope: "business", valueCents: 1800000, purchaseCostCents: null,
    });
  });

  it("lets a new liability account be added from the Liabilities group, and shows it after reload", async () => {
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [{ id: "acct-credit", name: "Chase Credit Card", type: "credit", kind: "liability", latestBalance: { currentBalanceCents: 20000, asOf: "2026-08-01", provider: "manual", editable: true } }],
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();

    const group = expandGroup(mounted.container, "liabilities");
    const addToggle = Array.from(group.querySelectorAll("button")).find((b) => b.textContent === "+ Add account");
    act(() => { addToggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    const form = group.querySelector("form");
    expect(form).not.toBeNull();
    // Loan is a real option alongside Credit card, since Liabilities isn't split into two groups.
    const typeSelect = form.querySelector("select");
    expect(Array.from(typeSelect.options).map((option) => option.value)).toEqual(["credit", "loan"]);

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    const nameInput = form.querySelector("input");
    const balanceInput = form.querySelector('input[type="number"]');

    act(() => {
      nativeInputValueSetter.call(nameInput, "Share Lane Mortgage");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      nativeSelectValueSetter.call(typeSelect, "loan");
      typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
      nativeInputValueSetter.call(balanceInput, "176012.60");
      balanceInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Once the new account is created, the next reload picks it up.
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [
          { id: "acct-credit", name: "Chase Credit Card", type: "credit", kind: "liability", latestBalance: { currentBalanceCents: 20000, asOf: "2026-08-01", provider: "manual", editable: true } },
          { id: "financial_account_manual_new", name: "Share Lane Mortgage", type: "loan", kind: "liability", latestBalance: { currentBalanceCents: 17601260, asOf: "2026-09-01", provider: "manual", editable: true } },
        ],
      },
    });

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(mounted.container.textContent).toContain("Share Lane Mortgage");
    expect(mounted.container.querySelector('[data-account-balance-row="financial_account_manual_new"]').textContent).toContain("$176,012.60");
  });
});
