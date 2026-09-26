// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.stubGlobal("fetch", vi.fn());
import DebtPayoffPanel from "./DebtPayoffPanel.jsx";
import { clearSWRCache } from "../../../hooks/swrCache.js";

function plan(overrides = {}) {
  return {
    strategy: "avalanche",
    order: [{ id: "a", name: "High Rate Card", payoffMonth: 2, totalInterest: 40.5 }],
    totalInterest: 40.5,
    monthsToDebtFree: 2,
    converged: true,
    monthlySurplus: 500,
    marginalTaxRate: 0,
    ...overrides,
  };
}

function payload(suggestionsEnabled) {
  return {
    success: true,
    data: {
      eligible: [
        { id: "a", name: "High Rate Card", balance: 1000, apr: 24, effectiveApr: 24, minimumPayment: 75, taxDeductible: false },
      ],
      needsTerms: [],
      strategies: {
        avalanche: plan({ strategy: "avalanche" }),
        snowball: plan({ strategy: "snowball" }),
        minimums: plan({ strategy: "minimums", totalInterest: 210.75, monthsToDebtFree: 15 }),
      },
      interestSavedVsMinimums: { avalanche: 170.25, snowball: 160.1 },
      topMove: {
        debtId: "a",
        debtName: "High Rate Card",
        extraPerMonth: 500,
        interestSaved: 170.25,
        monthsSaved: 13,
        strategy: "avalanche",
      },
      suggestionsEnabled,
      monthlySurplus: 500,
      marginalTaxRate: 0,
    },
  };
}

function mockGet(suggestionsEnabled) {
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).startsWith("/api/financial/debt-payoff?") && (!init || !init.method || init.method === "GET")) {
      return new Response(JSON.stringify(payload(suggestionsEnabled)), { status: 200 });
    }
    if (String(url) === "/api/financial/debt-payoff/preferences") {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({ success: true, data: { suggestionsEnabled: body.suggestionsEnabled } }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(<DebtPayoffPanel />);
  });
  return container;
}

describe("DebtPayoffPanel suggestions preference", () => {
  beforeEach(() => { vi.clearAllMocks(); clearSWRCache(); });
  afterEach(() => document.body.innerHTML = "");

  it("shows the checkbox checked when suggestions are enabled", async () => {
    mockGet(true);
    const container = await mount();
    const checkbox = container.querySelector("#debt-payoff-suggestions");
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(true);
    expect(container.textContent).toContain("Avalanche");
  });

  it("shows the checkbox unchecked when the owner opted out", async () => {
    mockGet(false);
    const container = await mount();
    expect(container.querySelector("#debt-payoff-suggestions").checked).toBe(false);
  });

  it("persists the toggle through the preferences API", async () => {
    mockGet(true);
    const container = await mount();
    const checkbox = container.querySelector("#debt-payoff-suggestions");
    await act(async () => {
      checkbox.click();
    });
    const putCall = vi.mocked(fetch).mock.calls.find(([url, init]) => init?.method === "PUT");
    expect(putCall?.[0]).toBe("/api/financial/debt-payoff/preferences");
    expect(JSON.parse(putCall[1].body)).toEqual({ suggestionsEnabled: false });
    expect(container.querySelector("#debt-payoff-suggestions").checked).toBe(false);
  });
});

describe("DebtPayoffPanel clear-terms confirmation", () => {
  beforeEach(() => { vi.clearAllMocks(); clearSWRCache(); });
  afterEach(() => document.body.innerHTML = "");

  function mockGetWithDebtTerms() {
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).startsWith("/api/financial/debt-payoff?") && (!init || !init.method || init.method === "GET")) {
        return new Response(JSON.stringify(payload(true)), { status: 200 });
      }
      if (String(url).startsWith("/api/financial/debt-terms") && init?.method === "DELETE") {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${url} ${init?.method}`);
    });
  }

  async function openTermsForm(container) {
    const editButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Edit terms");
    expect(editButton).not.toBeUndefined();
    await act(async () => { editButton.click(); });
    const clearButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Clear terms");
    expect(clearButton).not.toBeUndefined();
    return clearButton;
  }

  it("labels the destructive action 'Clear terms' and gates it behind a confirm naming what is cleared", async () => {
    mockGetWithDebtTerms();
    const container = await mount();
    const clearButton = await openTermsForm(container);
    await act(async () => { clearButton.click(); });
    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("High Rate Card");
    expect(dialog.textContent).toContain("manually entered APR");
    expect(dialog.textContent).toContain("minimum payment");
    // No DELETE fires until the confirmation is confirmed.
    const deletes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "DELETE");
    expect(deletes).toHaveLength(0);
  });

  it("issues the DELETE only after the clear confirmation is confirmed", async () => {
    mockGetWithDebtTerms();
    const container = await mount();
    const clearButton = await openTermsForm(container);
    await act(async () => { clearButton.click(); });
    const confirmButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Confirm clear");
    await act(async () => { confirmButton.click(); });
    const deletes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "DELETE");
    expect(deletes).toHaveLength(1);
    expect(String(deletes[0][0])).toContain("/api/financial/debt-terms");
    expect(String(deletes[0][0])).toContain("financialAccountId=a");
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("cancelling the clear confirmation never issues the DELETE", async () => {
    mockGetWithDebtTerms();
    const container = await mount();
    const clearButton = await openTermsForm(container);
    await act(async () => { clearButton.click(); });
    const cancelButton = [...container.querySelector('[role="alertdialog"]').querySelectorAll("button")]
      .find((b) => b.textContent === "Cancel");
    await act(async () => { cancelButton.click(); });
    const deletes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "DELETE");
    expect(deletes).toHaveLength(0);
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });
});

describe("DebtPayoffPanel question chips", () => {
  beforeEach(() => { vi.clearAllMocks(); clearSWRCache(); });
  afterEach(() => document.body.innerHTML = "");

  it("renders the four preselected questions and answers inline on tap", async () => {
    mockGet(true);
    const container = await mount();
    for (const label of [
      "Which debt should I target first?",
      "How much interest will I save?",
      "When will I be debt-free?",
      "What if I pay extra each month?",
    ]) {
      expect(container.textContent).toContain(label);
    }
    const chip = [...container.querySelectorAll("button")].find((b) =>
      b.textContent.includes("Which debt should I target first?"),
    );
    await act(async () => {
      chip.dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("Target High Rate Card first");
  });

  it("models a hypothetical extra payment deterministically", async () => {
    mockGet(true);
    const container = await mount();
    const chip = [...container.querySelectorAll("button")].find((b) =>
      b.textContent.includes("What if I pay extra each month?"),
    );
    await act(async () => {
      chip.dispatchEvent(new Event("click", { bubbles: true }));
    });
    const input = container.querySelector('[aria-label="Extra dollars per month to model"]');
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "300");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("With $300.00/mo extra");
  });
});
