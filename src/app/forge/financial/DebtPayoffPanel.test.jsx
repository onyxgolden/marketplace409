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
