// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FinancialAccountBalancesPanel from "./FinancialAccountBalancesPanel";
import { clearSWRCache } from "../../../hooks/swrCache";

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

  // The panel serves a module-global SWR cache across mounts: clear it so each
  // test's fetch stub, not a sibling test's cached payload, drives this test.
  beforeEach(() => { clearSWRCache(); });

  afterEach(() => {
    if (mounted) { unmount(mounted); mounted = null; }
    vi.unstubAllGlobals();
  });

  it("still renders the panel with a manual \"+ Add account\" entry point when there are no eligible accounts, assets, or investment accounts -- not nothing at all", async () => {
    const fetchMock = stubFetch();
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();

    const panel = mounted.container.querySelector("[data-financial-account-balances]");
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain("No accounts yet.");

    const addButton = Array.from(panel.querySelectorAll("button")).find((button) => button.textContent === "+ Add account");
    expect(addButton).toBeTruthy();
    act(() => { addButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const nameInput = panel.querySelector("input[placeholder='Account name']");
    const dollarsInput = panel.querySelector("input[placeholder='0.00']");
    expect(nameInput).not.toBeNull();
    expect(dollarsInput).not.toBeNull();
    act(() => {
      setter.call(nameInput, "New Checking");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(dollarsInput, "500");
      dollarsInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = panel.querySelector("form");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await flush(); });

    expect(fetchMock).toHaveBeenCalledWith("/api/financial/accounts", expect.objectContaining({ method: "POST" }));
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
    expect(mounted.container.textContent).toContain("Synced from Plaid");
    expect(mounted.container.querySelector('[data-account-balance-row="acct-1"] input')).toBeNull();
  });

  it("shortens a long raw provider value so the account name stays readable, but keeps the full value available on hover", async () => {
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [{
          id: "acct-2", name: "Business Checking", type: "depository", kind: "asset",
          latestBalance: { currentBalanceCents: 500000, asOf: "2026-08-01", provider: "stripe_financial_connections", editable: false },
        }],
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();
    expandGroup(mounted.container, "banking");

    expect(mounted.container.textContent).toContain("Synced from Stripe");
    expect(mounted.container.textContent).not.toContain("stripe_financial_connections");
    const label = mounted.container.querySelector('[data-account-balance-row="acct-2"] p[title]');
    // The hover keeps the full raw provider value -- now with the balance's
    // as-of date, so the tooltip never implies a stale balance is fresh.
    expect(label.getAttribute("title")).toBe("Synced from stripe_financial_connections · as of 2026-08-01");
  });

  it("humanizes an unmapped provider value instead of showing it raw", async () => {
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [{
          id: "acct-3", name: "Old Brokerage", type: "investment", kind: "asset",
          latestBalance: { currentBalanceCents: 100000, asOf: "2026-08-01", provider: "manual_investment", editable: false },
        }],
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();
    expandGroup(mounted.container, "investments");

    expect(mounted.container.textContent).toContain("Synced from Manual Investment");
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
          { id: "asset-1", name: "12 Juniper Lane", assetClass: "real_estate", ownershipScope: "business", latestValuation: { amountCents: 14850000, effectiveDate: "2026-08-01" } },
          { id: "asset-2", name: "2015 Toyota Tacoma", assetClass: "vehicle", ownershipScope: "personal", latestValuation: { amountCents: 1800000, effectiveDate: "2026-08-01" } },
          { id: "asset-3", name: "Utility Trailer", assetClass: "trailer", ownershipScope: "business", latestValuation: { amountCents: 375000, effectiveDate: "2026-08-01" } },
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
    expect(text).toContain("12 Juniper Lane");
    expect(text).toContain("Utility Trailer");

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
          { id: "investment_account_llc", name: "Harbor Holdings LLC", type: "investment", kind: "asset", latestBalance: { currentBalanceCents: 17000000, asOf: "2026-08-25", provider: "manual_investment", editable: false } },
        ],
      },
      investmentAccounts: {
        success: true,
        accounts: [
          { id: "investment_account_llc", name: "Harbor Holdings LLC", accountType: "private_investment", ownershipScope: "business", latestValuation: { amountCents: 17000000, effectiveDate: "2026-08-25" } },
        ],
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();
    expandGroup(mounted.container, "investments");

    expect(mounted.container.querySelectorAll('[data-account-balance-row="investment_account_llc"]')).toHaveLength(1);
    expect(mounted.container.querySelector('[data-account-category="investments"]').textContent).not.toContain("Linked Accounts");
    expect(mounted.container.querySelector('[data-account-category="investments.other_investments"]').textContent).toContain("Other Investments");

    // Net worth: $1,000.00 bank + $170,000.00 Harbor Holdings LLC, counted once each -- not $340,000.00 from a double-count.
    expect(mounted.container.querySelector("[data-net-worth]").textContent).toBe("$171,000.00");
  });

  it("starts top-level groups expanded and collapses them on click", async () => {
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [{ id: "acct-1", name: "Business Checking", type: "depository", kind: "asset", latestBalance: { currentBalanceCents: 100000, asOf: "2026-08-01", provider: "manual", editable: true } }],
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();

    // Expanded by default so the panel never reads empty on first load.
    const group = mounted.container.querySelector('[data-account-category="banking"]');
    expect(group.querySelector('[data-account-balance-row="acct-1"]')).not.toBeNull();
    expect(group.querySelector("button").getAttribute("aria-expanded")).toBe("true");

    const toggle = group.querySelector("button");
    act(() => { toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(group.querySelector('[data-account-balance-row="acct-1"]')).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    act(() => { toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(group.querySelector('[data-account-balance-row="acct-1"]')).not.toBeNull();
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
      nativeInputValueSetter.call(nameInput, "Willow Bend Mortgage");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      nativeSelectValueSetter.call(typeSelect, "loan");
      typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
      nativeInputValueSetter.call(balanceInput, "482105.50");
      balanceInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Once the new account is created, the next reload picks it up.
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [
          { id: "acct-credit", name: "Chase Credit Card", type: "credit", kind: "liability", latestBalance: { currentBalanceCents: 20000, asOf: "2026-08-01", provider: "manual", editable: true } },
          { id: "financial_account_manual_new", name: "Willow Bend Mortgage", type: "loan", kind: "liability", latestBalance: { currentBalanceCents: 48210550, asOf: "2026-09-01", provider: "manual", editable: true } },
        ],
      },
    });

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(mounted.container.textContent).toContain("Willow Bend Mortgage");
    expect(mounted.container.querySelector('[data-account-balance-row="financial_account_manual_new"]').textContent).toContain("$482,105.50");
  });

  describe("click-to-view-activity", () => {
    it("calls onSelectAccount with the account's id and name when a Banking/Liabilities row's name is clicked", async () => {
      stubFetch({
        accountBalances: {
          success: true,
          accounts: [{ id: "acct-bank", name: "Business Checking", type: "depository", kind: "asset", latestBalance: { currentBalanceCents: 100000, asOf: "2026-08-01", provider: "manual", editable: true } }],
        },
      });
      const onSelectAccount = vi.fn();
      mounted = mount(<FinancialAccountBalancesPanel onSelectAccount={onSelectAccount} />);
      await flush();
      expandGroup(mounted.container, "banking");

      const row = mounted.container.querySelector('[data-account-balance-row="acct-bank"]');
      act(() => { row.querySelector("button").dispatchEvent(new MouseEvent("click", { bubbles: true })); });

      expect(onSelectAccount).toHaveBeenCalledWith("acct-bank", "Business Checking");
    });

    it("does not call onSelectAccount when clicking the Edit button on a row with an existing balance", async () => {
      stubFetch({
        accountBalances: {
          success: true,
          accounts: [{ id: "acct-bank", name: "Business Checking", type: "depository", kind: "asset", latestBalance: { currentBalanceCents: 100000, asOf: "2026-08-01", provider: "manual", editable: true } }],
        },
      });
      const onSelectAccount = vi.fn();
      mounted = mount(<FinancialAccountBalancesPanel onSelectAccount={onSelectAccount} />);
      await flush();
      expandGroup(mounted.container, "banking");

      const row = mounted.container.querySelector('[data-account-balance-row="acct-bank"]');
      const editButton = Array.from(row.querySelectorAll("button")).find((button) => button.textContent === "Edit");
      act(() => { editButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

      expect(onSelectAccount).not.toHaveBeenCalled();
      expect(row.querySelector("form")).not.toBeNull();
    });

    it("does not call onSelectAccount when a Group or SubGroup header is clicked -- only collapses/expands", async () => {
      stubFetch({
        accountBalances: {
          success: true,
          accounts: [{ id: "acct-bank", name: "Business Checking", type: "depository", kind: "asset", latestBalance: { currentBalanceCents: 100000, asOf: "2026-08-01", provider: "manual", editable: true } }],
        },
      });
      const onSelectAccount = vi.fn();
      mounted = mount(<FinancialAccountBalancesPanel onSelectAccount={onSelectAccount} />);
      await flush();
      expandGroup(mounted.container, "banking");

      expect(onSelectAccount).not.toHaveBeenCalled();
    });

    it("calls onSelectAccount when an investment-registry row is clicked", async () => {
      stubFetch({
        investmentAccounts: {
          success: true,
          accounts: [{ id: "inv-1", name: "Traditional IRA", accountType: "ira", ownershipScope: "personal", latestValuation: { amountCents: 410213, effectiveDate: "2026-08-01" } }],
        },
      });
      const onSelectAccount = vi.fn();
      mounted = mount(<FinancialAccountBalancesPanel onSelectAccount={onSelectAccount} />);
      await flush();
      expandGroup(mounted.container, "investments");
      expandGroup(mounted.container, "investments.retirement");

      const row = mounted.container.querySelector('[data-account-balance-row="inv-1"]');
      act(() => { row.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

      expect(onSelectAccount).toHaveBeenCalledWith("inv-1", "Traditional IRA");
    });

    it("does not offer click-to-view-activity on an asset row -- assets track valuation history, not financial_events activity", async () => {
      stubFetch({
        assets: {
          success: true,
          assets: [{ id: "asset-1", name: "12 Juniper Lane", assetClass: "real_estate", ownershipScope: "business", latestValuation: { amountCents: 14850000, effectiveDate: "2026-08-01" } }],
        },
      });
      const onSelectAccount = vi.fn();
      mounted = mount(<FinancialAccountBalancesPanel onSelectAccount={onSelectAccount} />);
      await flush();
      expandGroup(mounted.container, "assets");
      expandGroup(mounted.container, "assets.real_estate");

      const row = mounted.container.querySelector('[data-account-balance-row="asset-1"]');
      expect(row.tagName).not.toBe("BUTTON");
      act(() => { row.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

      expect(onSelectAccount).not.toHaveBeenCalled();
    });

    it("visually marks the selected account via data-account-selected", async () => {
      stubFetch({
        accountBalances: {
          success: true,
          accounts: [
            { id: "acct-bank", name: "Business Checking", type: "depository", kind: "asset", latestBalance: { currentBalanceCents: 100000, asOf: "2026-08-01", provider: "manual", editable: true } },
            { id: "acct-savings", name: "Business Savings", type: "depository", kind: "asset", latestBalance: { currentBalanceCents: 200000, asOf: "2026-08-01", provider: "manual", editable: true } },
          ],
        },
      });
      mounted = mount(<FinancialAccountBalancesPanel selectedAccountId="acct-bank" />);
      await flush();
      expandGroup(mounted.container, "banking");

      expect(mounted.container.querySelector('[data-account-balance-row="acct-bank"]').getAttribute("data-account-selected")).toBe("true");
      expect(mounted.container.querySelector('[data-account-balance-row="acct-savings"]').getAttribute("data-account-selected")).toBeNull();
    });
  });
});

describe("BalanceRow drill-down affordance", () => {
  let mounted;

  beforeEach(() => { clearSWRCache(); });

  afterEach(() => {
    if (mounted) { unmount(mounted); mounted = null; }
    vi.unstubAllGlobals();
  });

  it("marks the account-name row as a tappable drill-down with a visible chevron and aria label, not a tooltip-only hint", async () => {
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [{ id: "acct-1", name: "Business Checking", type: "depository", kind: "asset", latestBalance: { currentBalanceCents: 100000, asOf: "2026-08-01", provider: "manual", editable: true } }],
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel onSelectAccount={() => {}} />);
    await flush();
    expandGroup(mounted.container, "banking");

    const row = mounted.container.querySelector('[data-account-balance-row="acct-1"]');
    expect(row).not.toBeNull();
    const nameButton = row.querySelector('button[aria-label="View activity for Business Checking"]');
    expect(nameButton).not.toBeNull();
    expect(nameButton.className).toContain("cursor-pointer");
    expect(nameButton.querySelector("svg")).not.toBeNull();
  });
});

describe("FinancialAccountBalancesPanel -- position-aware dedup", () => {
  let mounted;

  beforeEach(() => { clearSWRCache(); });

  afterEach(() => {
    if (mounted) { unmount(mounted); mounted = null; }
    vi.unstubAllGlobals();
  });

  const EMPTY_POSITION = { supersededBalances: [], missingBalances: [] };

  it("shows a superseded group member under 'Not counted in net worth' with a duplicate label, contributing $0", async () => {
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [
          { id: "acct-csv", name: "Aldergrove Checking", type: "depository", kind: "asset", includedInPosition: true, degraded: true, sourceLabel: "last known / manual", latestBalance: { currentBalanceCents: 287415, asOf: "2026-08-25", provider: "manual", editable: true } },
          { id: "acct-stripe", name: "Juniper Checking", type: "depository", kind: "asset", includedInPosition: false, latestBalance: { currentBalanceCents: 512340, asOf: "2026-09-09", provider: "stripe_financial_connections", editable: false } },
        ],
        position: {
          supersededBalances: [{ id: "acct-stripe", name: "Juniper Checking", provider: "stripe_financial_connections", current_value: 5123.40, as_of: "2026-09-09T02:20:26.000Z" }],
          missingBalances: [],
        },
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();

    // Banking counts the static winner once: $2,874.15, not $2,874.15 + $5,123.40.
    const bankingGroup = mounted.container.querySelector('[data-account-category="banking"]');
    expect(bankingGroup.querySelector("button").textContent).toContain("$2,874.15");
    expect(bankingGroup.textContent).toContain("Aldergrove Checking");
    expect(bankingGroup.textContent).not.toContain("Juniper Checking");

    const excludedGroup = mounted.container.querySelector('[data-account-category="excluded"]');
    expect(excludedGroup).not.toBeNull();
    expect(excludedGroup.querySelector("button").textContent).toContain("$0.00");
    expect(excludedGroup.textContent).toContain("Not counted in net worth");
    expect(excludedGroup.textContent).toContain("Juniper Checking");
    expect(excludedGroup.textContent).toContain("Duplicate — already counted once");
    // The loser still shows its real value ($5,123.40) with its provenance --
    // excluded from the total, never presented as zero.
    expect(excludedGroup.textContent).toContain("$5,123.40");
    expect(excludedGroup.textContent).toContain("Synced from Stripe");

    // The CSV winner is labeled last known / manual, not presented as fresh.
    expect(bankingGroup.textContent).toContain("Last known / manual");

    expect(mounted.container.querySelector("[data-net-worth]").textContent).toBe("$2,874.15");
    expect(mounted.container.querySelectorAll('[data-account-balance-row="acct-stripe"]')).toHaveLength(1);
  });

  it("renders the four standalone type-'other' rows in 'Other Accounts' with their signs, and never double-shows a registry mirror there", async () => {
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [
          { id: "acct-discover", name: "Harbor Rewards Card", type: "other", kind: "asset", includedInPosition: true, latestBalance: { currentBalanceCents: -56976, asOf: "2026-09-01", provider: "manual", editable: true } },
          { id: "acct-email", name: "Prairie Store Card", type: "other", kind: "asset", includedInPosition: true, latestBalance: { currentBalanceCents: -87460, asOf: "2026-09-01", provider: "manual", editable: true } },
          { id: "acct-rave-b", name: "Summit Gift Card", type: "other", kind: "asset", includedInPosition: true, latestBalance: { currentBalanceCents: 14084, asOf: "2026-09-01", provider: "manual", editable: true } },
          { id: "acct-rave-j", name: "Cinder Collectible", type: "other", kind: "asset", includedInPosition: true, latestBalance: { currentBalanceCents: 6790, asOf: "2026-09-01", provider: "manual", editable: true } },
          // A registry mirror: same type, but its id IS an active asset's id --
          // it counts once through the Assets group below, never here.
          { id: "asset-tractor", name: "Tractor", type: "other", kind: "asset", includedInPosition: true, latestBalance: { currentBalanceCents: 500000, asOf: "2026-09-01", provider: "manual_asset", editable: false } },
        ],
        position: EMPTY_POSITION,
      },
      assets: {
        success: true,
        assets: [{ id: "asset-tractor", name: "Tractor", assetClass: "equipment", ownershipScope: "business", latestValuation: { amountCents: 500000, effectiveDate: "2026-09-01" } }],
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();
    expandGroup(mounted.container, "other");
    expandGroup(mounted.container, "assets");

    const otherGroup = mounted.container.querySelector('[data-account-category="other"]');
    expect(otherGroup).not.toBeNull();
    expect(otherGroup.textContent).toContain("Other Accounts");
    expect(otherGroup.textContent).toContain("Harbor Rewards Card");
    expect(otherGroup.textContent).toContain("-$569.76");
    expect(otherGroup.textContent).toContain("Prairie Store Card");
    expect(otherGroup.textContent).toContain("-$874.60");
    expect(otherGroup.textContent).toContain("Summit Gift Card");
    expect(otherGroup.textContent).toContain("$140.84");
    expect(otherGroup.textContent).toContain("Cinder Collectible");
    expect(otherGroup.textContent).toContain("$67.90");
    expect(otherGroup.textContent).not.toContain("Tractor");
    // The four standalone rows sum signed: -$569.76 - $874.60 + $140.84 + $67.90.
    expect(otherGroup.querySelector("button").textContent).toContain("-$1,235.62");

    // Mirror counted once, through Assets only.
    expect(mounted.container.querySelectorAll('[data-account-balance-row="asset-tractor"]')).toHaveLength(1);

    // Net worth: -$1,235.62 standalone other + $5,000.00 tractor.
    expect(mounted.container.querySelector("[data-net-worth]").textContent).toBe("$3,764.38");
  });

  it("opens a negative manual asset's editor with the negative value and saves it with the same sign", async () => {
    const fetchMock = stubFetch({
      accountBalances: {
        success: true,
        accounts: [
          { id: "acct-discover", name: "Harbor Rewards Card", type: "other", kind: "asset", includedInPosition: true, latestBalance: { currentBalanceCents: -56976, asOf: "2026-09-01", provider: "manual", editable: true } },
        ],
        position: EMPTY_POSITION,
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();
    expandGroup(mounted.container, "other");

    const row = mounted.container.querySelector('[data-account-balance-row="acct-discover"]');
    expect(row.textContent).toContain("-$569.76");
    const editButton = Array.from(row.querySelectorAll("button")).find((b) => b.textContent === "Edit");
    act(() => { editButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    // The editor opens on the negative number -- the old Math.abs here turned
    // -$802.35 into +$802.35 on save.
    const input = row.querySelector('input[type="number"]');
    expect(input.value).toBe("-569.76");

    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ success: true, balance: {} }) }));
    const form = row.querySelector("form");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/financial/account-balances", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"currentBalanceCents":-56976'),
    }));
  });

  it("displays and sums a negative stored liability as the debt owed, not as a credit", async () => {
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [
          { id: "acct-bank", name: "Business Checking", type: "depository", kind: "asset", includedInPosition: true, latestBalance: { currentBalanceCents: 100000, asOf: "2026-08-01", provider: "manual", editable: true } },
          // Stored negative (a sync artifact): still $200.00 of debt.
          { id: "acct-credit", name: "Chase Credit Card", type: "credit", kind: "liability", includedInPosition: true, latestBalance: { currentBalanceCents: -20000, asOf: "2026-08-01", provider: "manual", editable: true } },
          // Stored positive: also $15,000.00 of debt.
          { id: "acct-loan", name: "Auto Loan", type: "loan", kind: "liability", includedInPosition: true, latestBalance: { currentBalanceCents: 1500000, asOf: "2026-08-01", provider: "manual", editable: true } },
        ],
        position: EMPTY_POSITION,
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();
    expandGroup(mounted.container, "liabilities");

    const liabilitiesGroup = mounted.container.querySelector('[data-account-category="liabilities"]');
    expect(liabilitiesGroup.textContent).toContain("Chase Credit Card");
    expect(liabilitiesGroup.textContent).toContain("$200.00");
    expect(liabilitiesGroup.textContent).not.toContain("-$200.00");
    expect(liabilitiesGroup.querySelector("button").textContent).toContain("$15,200.00");

    // Net worth: $1,000.00 - $15,200.00.
    expect(mounted.container.querySelector("[data-net-worth]").textContent).toBe("-$14,200.00");
  });

  it("keeps a superseded registry mirror in the excluded section (not counted through the registry) and counts a contributing mirror once", async () => {
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [
          { id: "acct-bank", name: "Business Checking", type: "depository", kind: "asset", includedInPosition: true, latestBalance: { currentBalanceCents: 100000, asOf: "2026-08-01", provider: "manual", editable: true } },
          { id: "inv-superseded", name: "Superseded IRA", type: "investment", kind: "asset", includedInPosition: false, latestBalance: { currentBalanceCents: 900000, asOf: "2026-09-09", provider: "stripe_financial_connections", editable: false } },
          { id: "inv-live", name: "Live IRA", type: "investment", kind: "asset", includedInPosition: true, latestBalance: { currentBalanceCents: 500000, asOf: "2026-09-01", provider: "manual_investment", editable: false } },
        ],
        position: {
          supersededBalances: [{ id: "inv-superseded", name: "Superseded IRA", provider: "stripe_financial_connections", current_value: 9000, as_of: "2026-09-09T00:00:00.000Z" }],
          missingBalances: [],
        },
      },
      investmentAccounts: {
        success: true,
        accounts: [
          { id: "inv-superseded", name: "Superseded IRA", accountType: "ira", ownershipScope: "personal", latestValuation: { amountCents: 900000, effectiveDate: "2026-09-09" } },
          { id: "inv-live", name: "Live IRA", accountType: "ira", ownershipScope: "personal", latestValuation: { amountCents: 500000, effectiveDate: "2026-09-01" } },
        ],
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();
    expandGroup(mounted.container, "investments");
    expandGroup(mounted.container, "excluded");

    // The contributing mirror counts once, at its mirror balance.
    expect(mounted.container.querySelectorAll('[data-account-balance-row="inv-live"]')).toHaveLength(1);
    expect(mounted.container.querySelector('[data-account-category="investments"]').textContent).toContain("Live IRA");
    expect(mounted.container.querySelector('[data-account-category="investments"]').textContent).not.toContain("Superseded IRA");

    // The superseded mirror is disclosed in the excluded section, not hidden
    // and not re-entering through the registry endpoint.
    const excludedGroup = mounted.container.querySelector('[data-account-category="excluded"]');
    expect(excludedGroup.textContent).toContain("Superseded IRA");
    expect(excludedGroup.textContent).toContain("Duplicate — already counted once");
    expect(mounted.container.querySelectorAll('[data-account-balance-row="inv-superseded"]')).toHaveLength(1);

    // Net worth: $1,000.00 bank + $5,000.00 live IRA only.
    expect(mounted.container.querySelector("[data-net-worth]").textContent).toBe("$6,000.00");
  });

  it("counts two same-named investment mirrors once each, by exact id", async () => {
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [
          { id: "inv-a", name: "Harbor Investment Fund", type: "investment", kind: "asset", includedInPosition: true, latestBalance: { currentBalanceCents: 100000, asOf: "2026-09-01", provider: "manual_investment", editable: false } },
          { id: "inv-b", name: "Harbor Investment Fund", type: "investment", kind: "asset", includedInPosition: true, latestBalance: { currentBalanceCents: 200000, asOf: "2026-09-01", provider: "manual_investment", editable: false } },
        ],
        position: EMPTY_POSITION,
      },
      investmentAccounts: {
        success: true,
        accounts: [
          { id: "inv-a", name: "Harbor Investment Fund", accountType: "private_investment", ownershipScope: "business", latestValuation: { amountCents: 100000, effectiveDate: "2026-09-01" } },
          { id: "inv-b", name: "Harbor Investment Fund", accountType: "private_investment", ownershipScope: "business", latestValuation: { amountCents: 200000, effectiveDate: "2026-09-01" } },
        ],
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();
    expandGroup(mounted.container, "investments");

    expect(mounted.container.querySelectorAll('[data-account-balance-row="inv-a"]')).toHaveLength(1);
    expect(mounted.container.querySelectorAll('[data-account-balance-row="inv-b"]')).toHaveLength(1);
    // Each counted once: $1,000.00 + $2,000.00, not either one twice.
    expect(mounted.container.querySelector("[data-net-worth]").textContent).toBe("$3,000.00");
  });

  it("shows an account with no balance row as missing -- not as a zero -- and keeps its Add-balance control", async () => {
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [
          { id: "acct-summit-card", name: "Summit Rewards Card", type: "credit", kind: "liability", includedInPosition: false, latestBalance: null },
        ],
        position: {
          supersededBalances: [],
          missingBalances: [{ id: "acct-summit-card", name: "Summit Rewards Card", type: "credit" }],
        },
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();
    expandGroup(mounted.container, "excluded");

    const excludedGroup = mounted.container.querySelector('[data-account-category="excluded"]');
    expect(excludedGroup.textContent).toContain("Summit Rewards Card");
    expect(excludedGroup.textContent).toContain("Missing balance — not counted");
    const row = mounted.container.querySelector('[data-account-balance-row="acct-summit-card"]');
    expect(row).not.toBeNull();
    // The manual-entry control stays: the missing balance can be added here.
    expect(row.querySelector('input[type="number"]')).not.toBeNull();
    expect(mounted.container.querySelector("[data-net-worth]").textContent).toBe("$0.00");
  });

  it("treats a 0-cent balance as real data, counted at $0 -- not as a missing balance", async () => {
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [
          { id: "acct-empty", name: "Empty Savings", type: "depository", kind: "asset", includedInPosition: true, latestBalance: { currentBalanceCents: 0, asOf: "2026-09-01", provider: "manual", editable: true } },
        ],
        position: EMPTY_POSITION,
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();

    const bankingGroup = mounted.container.querySelector('[data-account-category="banking"]');
    expect(bankingGroup.textContent).toContain("Empty Savings");
    expect(bankingGroup.querySelector("button").textContent).toContain("$0.00");
    expect(mounted.container.querySelector('[data-account-category="excluded"]')).toBeNull();
    expect(mounted.container.querySelector("[data-net-worth]").textContent).toBe("$0.00");
  });

  it("discloses a registry-vs-mirror divergence and counts the mirror balance, not the valuation", async () => {
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [
          { id: "inv-1", name: "Traditional IRA", type: "investment", kind: "asset", includedInPosition: true, latestBalance: { currentBalanceCents: 17000000, asOf: "2026-09-01", provider: "manual_investment", editable: false } },
        ],
        position: EMPTY_POSITION,
      },
      investmentAccounts: {
        success: true,
        accounts: [
          { id: "inv-1", name: "Traditional IRA", accountType: "ira", ownershipScope: "personal", latestValuation: { amountCents: 17002500, effectiveDate: "2026-08-25" } },
        ],
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();
    expandGroup(mounted.container, "investments");

    // The row still displays the registry valuation...
    expect(mounted.container.textContent).toContain("$170,025.00");
    // ...but the mismatch is disclosed in plain words, and the totals use the
    // mirror balance -- never the valuation silently overriding the position.
    expect(mounted.container.textContent).toContain("Registry value $170,025.00 differs from linked account balance $170,000.00 — counting the linked balance.");
    expect(mounted.container.querySelector('[data-account-category="investments"]').querySelector("button").textContent).toContain("$170,000.00");
    expect(mounted.container.querySelector("[data-net-worth]").textContent).toBe("$170,000.00");
  });

  it("labels a stale live winner 'Stale · Synced from ...' instead of presenting it as fresh", async () => {
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [
          { id: "acct-stale", name: "Juniper Checking", type: "depository", kind: "asset", includedInPosition: true, degraded: true, sourceLabel: "stale", latestBalance: { currentBalanceCents: 512340, asOf: "2026-09-09", provider: "stripe_financial_connections", editable: false } },
          { id: "acct-csv", name: "Aldergrove Checking", type: "depository", kind: "asset", includedInPosition: true, degraded: true, sourceLabel: "last known / manual", latestBalance: { currentBalanceCents: 287415, asOf: "2026-08-25", provider: "manual", editable: true } },
        ],
        position: EMPTY_POSITION,
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();
    expandGroup(mounted.container, "banking");

    const bankingGroup = mounted.container.querySelector('[data-account-category="banking"]');
    expect(bankingGroup.textContent).toContain("Stale · Synced from Stripe");
    expect(bankingGroup.textContent).toContain("Last known / manual");
  });
});
