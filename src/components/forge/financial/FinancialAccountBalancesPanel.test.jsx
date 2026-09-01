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
// All groups/sub-groups start collapsed -- expand the one at `path` (e.g. "banking" or
// "investments.retirement") by clicking its own header button.
function expand(container, path) {
  const toggle = container.querySelector(`[data-account-category="${path}"]`).querySelector("button");
  act(() => { toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

const EMPTY = { accountBalances: { success: true, accounts: [] }, assets: { success: true, assets: [] }, investmentAccounts: { success: true, accounts: [] } };

// Routes each fetch() call to the matching fixture by URL, independent of call order, so a test
// only needs to override the endpoint(s) it actually cares about.
function stubFetch(overrides = {}) {
  const responses = { ...EMPTY, ...overrides };
  const fetchMock = vi.fn(async (url, init) => {
    if (url === "/api/financial/account-balances") return { ok: true, json: async () => responses.accountBalances };
    if (url === "/api/financial/assets" && (!init || init.method === undefined)) return { ok: true, json: async () => responses.assets };
    if (url === "/api/financial/assets" && init?.method === "POST") {
      return { ok: true, json: async () => ({ success: true, assetId: "financial_asset_new" }) };
    }
    if (url === "/api/financial/assets" && init?.method === "PATCH") {
      return { ok: true, json: async () => ({ success: true }) };
    }
    if (url === "/api/financial/investment-accounts") return { ok: true, json: async () => responses.investmentAccounts };
    if (url === "/api/financial/accounts" && init?.method === "POST") {
      return { ok: true, json: async () => ({ success: true, accountId: "financial_account_manual_new" }) };
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
    expand(mounted.container, "liabilities");

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
    expand(mounted.container, "banking");

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
    expand(mounted.container, "banking");

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
    expand(mounted.container, "banking");

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

    // Top-level group headers (label + subtotal) are always visible, even collapsed.
    const collapsedText = mounted.container.textContent;
    expect(collapsedText).toContain("Banking");
    expect(collapsedText).toContain("Investments");
    expect(collapsedText).toContain("Assets");
    expect(collapsedText).toContain("Liabilities");
    // Liabilities is one combined group -- credit and loan are not split into separate top-level groups.
    expect(collapsedText).not.toContain("Credit Cards");
    expect(collapsedText).not.toContain("Loans");

    // Liabilities combined subtotal: $200.00 credit + $15,000.00 loan = $15,200.00 on the group header.
    const liabilitiesGroup = mounted.container.querySelector('[data-account-category="liabilities"]');
    expect(liabilitiesGroup.querySelector("button").textContent).toContain("$15,200.00");

    // Sub-group labels need their parent top-level group expanded; account rows need the
    // sub-group itself expanded too.
    expand(mounted.container, "investments");
    expand(mounted.container, "assets");
    expand(mounted.container, "investments.retirement");
    expand(mounted.container, "assets.real_estate");
    expand(mounted.container, "assets.other_assets");

    const expandedText = mounted.container.textContent;
    expect(expandedText).toContain("Linked Accounts");
    expect(expandedText).toContain("Retirement");
    expect(expandedText).toContain("Real Estate");
    expect(expandedText).toContain("Vehicles");
    expect(expandedText).toContain("Other Assets");
    expect(expandedText).toContain("Traditional IRA");
    expect(expandedText).toContain("145 Laxon");
    expect(expandedText).toContain("Box Trailer");
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

    // Net worth is computed from the full data regardless of collapse state: $1,000.00 bank +
    // $170,017.42 LLC, counted once each -- not $340,034.84 from a double-count.
    expect(mounted.container.querySelector("[data-net-worth]").textContent).toBe("$171,017.42");

    expand(mounted.container, "investments");
    expect(mounted.container.querySelector('[data-account-category="investments"]').textContent).not.toContain("Linked Accounts");
    expect(mounted.container.querySelector('[data-account-category="investments.other_investments"]').textContent).toContain("Other Investments");

    expand(mounted.container, "investments.other_investments");
    expect(mounted.container.querySelectorAll('[data-account-balance-row="investment_account_llc"]')).toHaveLength(1);
  });

  it("starts collapsed, and expands/collapses a top-level group on click", async () => {
    stubFetch({
      accountBalances: {
        success: true,
        accounts: [{ id: "acct-1", name: "Business Checking", type: "depository", kind: "asset", latestBalance: { currentBalanceCents: 100000, asOf: "2026-08-01", provider: "manual", editable: true } }],
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();

    const group = mounted.container.querySelector('[data-account-category="banking"]');
    const toggle = group.querySelector("button");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(group.querySelector('[data-account-balance-row="acct-1"]')).toBeNull();

    act(() => { toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(group.querySelector('[data-account-balance-row="acct-1"]')).not.toBeNull();

    act(() => { toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(group.querySelector('[data-account-balance-row="acct-1"]')).toBeNull();
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
    expand(mounted.container, "liabilities");

    const group = mounted.container.querySelector('[data-account-category="liabilities"]');
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

  it("lets an existing asset's value be edited via the Edit link", async () => {
    stubFetch({
      assets: {
        success: true,
        assets: [{
          id: "asset-1", name: "2016 Lexus GX 460", assetClass: "vehicle", ownershipScope: "personal",
          purchaseCostCents: null, purchaseDate: null, linkedPropertyId: null, notes: null,
          latestValuation: { amountCents: 1800000, effectiveDate: "2026-08-25" },
        }],
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();
    expand(mounted.container, "assets");
    expand(mounted.container, "assets.vehicles");

    const row = mounted.container.querySelector('[data-account-balance-row="asset-1"]');
    expect(row.querySelector("form")).toBeNull();
    const editButton = Array.from(row.querySelectorAll("button")).find((b) => b.textContent === "Edit");
    act(() => { editButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(row.querySelector("form")).not.toBeNull();
  });

  it("submits a full record (name/class/scope preserved) when saving an edited asset value", async () => {
    const fetchMock = stubFetch({
      assets: {
        success: true,
        assets: [{
          id: "asset-1", name: "2016 Lexus GX 460", assetClass: "vehicle", ownershipScope: "personal",
          purchaseCostCents: null, purchaseDate: null, linkedPropertyId: null, notes: null,
          latestValuation: { amountCents: 1800000, effectiveDate: "2026-08-25" },
        }],
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();
    expand(mounted.container, "assets");
    expand(mounted.container, "assets.vehicles");

    const row = mounted.container.querySelector('[data-account-balance-row="asset-1"]');
    act(() => { Array.from(row.querySelectorAll("button")).find((b) => b.textContent === "Edit").dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const valueInput = row.querySelector('input[type="number"]');
    act(() => {
      nativeInputValueSetter.call(valueInput, "19000");
      valueInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = row.querySelector("form");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/financial/assets", expect.objectContaining({
      method: "PATCH",
      body: expect.stringContaining('"assetId":"asset-1"'),
    }));
    const patchCall = fetchMock.mock.calls.find(([url, init]) => url === "/api/financial/assets" && init?.method === "PATCH");
    const submittedBody = JSON.parse(patchCall[1].body);
    expect(submittedBody).toMatchObject({ name: "2016 Lexus GX 460", assetClass: "vehicle", ownershipScope: "personal", valueCents: 1900000 });
  });

  it("lets a new asset be added from the Assets group", async () => {
    const fetchMock = stubFetch({
      assets: {
        success: true,
        assets: [{
          id: "asset-1", name: "145 Laxon", assetClass: "real_estate", ownershipScope: "business",
          purchaseCostCents: null, purchaseDate: null, linkedPropertyId: null, notes: null,
          latestValuation: { amountCents: 15000000, effectiveDate: "2026-08-25" },
        }],
      },
    });
    mounted = mount(<FinancialAccountBalancesPanel />);
    await flush();
    expand(mounted.container, "assets");

    const group = mounted.container.querySelector('[data-account-category="assets"]');
    const addToggle = Array.from(group.querySelectorAll("button")).find((b) => b.textContent === "+ Add asset");
    act(() => { addToggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    const form = group.querySelector("form");
    expect(form).not.toBeNull();
    const [classSelect, scopeSelect] = form.querySelectorAll("select");
    expect(Array.from(classSelect.options).map((option) => option.value)).toEqual(
      ["real_estate", "vehicle", "equipment", "trailer", "collectible", "crypto", "other"],
    );
    expect(classSelect.value).toBe("vehicle");

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const nameInput = form.querySelector("input");
    const valueInput = form.querySelector('input[type="number"]');
    act(() => {
      nativeInputValueSetter.call(nameInput, "2015 Toyota Tacoma");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      nativeInputValueSetter.call(valueInput, "18000");
      valueInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/financial/assets", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"name":"2015 Toyota Tacoma"'),
    }));
    const postCall = fetchMock.mock.calls.find(([url, init]) => url === "/api/financial/assets" && init?.method === "POST");
    // purchaseCostCents must be an explicit null, not omitted -- the API's optional-field parsing
    // (`body?.purchaseCostCents === null || === "" ? null : Number(...)`) turns an omitted/undefined
    // field into Number(undefined) = NaN, which then fails "must be whole cents" validation.
    expect(JSON.parse(postCall[1].body)).toMatchObject({ assetClass: "vehicle", ownershipScope: "business", valueCents: 1800000, purchaseCostCents: null });
  });
});
