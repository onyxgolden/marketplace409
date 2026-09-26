// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.stubGlobal("fetch", vi.fn());
import CashForecastPanel from "./CashForecastPanel.jsx";
import { clearSWRCache } from "../../../hooks/swrCache.js";

function confidence(overrides = {}) {
  return {
    confident: false,
    windowDays: 90,
    daysOfHistory: 12,
    transactionCount: 8,
    minHistoryDays: 45,
    minTransactions: 20,
    explanation:
      "Not enough history to project reliably — only 12 of the last 90 days have transaction history and only 8 transactions to learn from.",
    ...overrides,
  };
}

function payload(burnConfidenceValue) {
  return {
    success: true,
    data: {
      accounts: [
        {
          accountId: "a1",
          name: "Checking",
          startingBalance: 5000,
          dailyBurn: 40,
          minBalance: 1200,
          minBalanceDate: "2026-10-15",
          checkpoints: [
            { date: "2026-09-26", projectedBalance: 5000 },
            { date: "2026-12-25", projectedBalance: 1400 },
          ],
          warnings: [],
        },
      ],
      warnings: [],
      meta: {
        startDate: "2026-09-26",
        days: 90,
        safetyBuffer: 1000,
        burnConfidence: burnConfidenceValue,
      },
      recurringPatterns: [],
      burnByFamily: {},
      accountsSkippedWithoutBalance: 0,
      patternCount: 0,
    },
  };
}

function mockForecast(burnConfidenceValue) {
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).startsWith("/api/financial/forecast")) {
      return new Response(JSON.stringify(payload(burnConfidenceValue)), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(<CashForecastPanel />);
  });
  return container;
}

function assumeInput(container) {
  return container.querySelector('input[aria-label="Assume daily spend for Checking"]');
}

async function typeAssume(container, value) {
  const input = assumeInput(container);
  expect(input).not.toBeNull();
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  await act(async () => {
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const applyButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Apply",
  );
  expect(applyButton).not.toBeUndefined();
  await act(async () => {
    applyButton.click();
  });
}

describe("CashForecastPanel low-confidence burn withholding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSWRCache();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("withholds the burn metric as a dash with a plain-language explanation on thin data", async () => {
    mockForecast(confidence());
    const container = await mount();
    expect(container.textContent).toContain("Burn withheld");
    expect(container.textContent).toContain("Not enough history to project reliably");
    expect(container.textContent).toContain("only 12 of the last 90 days");
    // The burn figure is a dash, never the fabricated $40.00/day.
    expect(container.textContent).not.toContain("$40.00/day");
    // The assumption input is exposed next to the withheld metric.
    expect(assumeInput(container)).not.toBeNull();
  });

  it("shows the computed burn normally when history is sufficient", async () => {
    mockForecast(confidence({ confident: true, explanation: null }));
    const container = await mount();
    expect(container.textContent).toContain("$40.00/day");
    expect(container.textContent).not.toContain("Burn withheld");
    expect(assumeInput(container)).toBeNull();
  });

  it("flips the withheld metric to shown (labeled as the user's estimate) when an assumption is applied", async () => {
    mockForecast(confidence());
    const container = await mount();
    await typeAssume(container, "100");
    // The metric is now shown as the user's assumption, labeled as such...
    expect(container.textContent).toContain("your estimate");
    expect(container.textContent).toContain("$100.00/day");
    // ...and the withheld state is gone: no more dash block or apply form.
    expect(container.textContent).not.toContain("Burn withheld");
    expect(assumeInput(container)).toBeNull();
    // The projection re-ran under the assumption: 5000 - 90*100 = -4000 lowest.
    expect(container.textContent).toContain("-$4,000.00");
  });

  it("keeps the withheld metric withheld when the assumption is invalid", async () => {
    mockForecast(confidence());
    const container = await mount();
    await typeAssume(container, "-5");
    expect(container.textContent).toContain("Burn withheld");
    expect(container.textContent).not.toContain("your estimate");
  });

  it("withholds the sparkline trajectory when burn is withheld (no silent projection leak)", async () => {
    mockForecast(confidence());
    const container = await mount();
    // The payload carries two checkpoints — previously these still drew a
    // trajectory from the unreliable burn even though the number was hidden.
    expect(container.querySelector('svg[role="img"]')).toBeNull();
    expect(container.textContent).toContain("Projection withheld");
    // And the all-clear must not print a false reassurance.
    expect(container.textContent).not.toContain("No shortfalls or tight spots");
    expect(container.textContent).toContain("Shortfall warnings are withheld for all accounts");
  });

  it("suppresses server shortfall warnings derived from the withheld burn", async () => {
    const warned = payload(confidence());
    warned.data.accounts[0].warnings = [
      {
        accountId: "a1",
        accountName: "Checking",
        type: "shortfall",
        date: "2026-11-01",
        projectedBalance: -500,
        daysFromStart: 36,
      },
    ];
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url).startsWith("/api/financial/forecast")) {
        return new Response(JSON.stringify(warned), { status: 200 });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const container = await mount();
    expect(container.textContent).not.toContain("goes negative");
    expect(container.textContent).toContain("Shortfall warnings are withheld for all accounts");
  });

  it("restores the sparkline and warnings once an assumption is applied", async () => {
    mockForecast(confidence());
    const container = await mount();
    await typeAssume(container, "100");
    // The re-run projection under the user's number draws again...
    expect(container.querySelector('svg[role="img"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Projection withheld");
    // ...and its warnings return too — $100/day for 90 days from $5,000
    // genuinely goes negative, and this warning is legitimate because it is
    // derived from the user's own labeled estimate, not the withheld burn.
    expect(container.textContent).toContain("goes negative");
    expect(container.textContent).toContain("your estimate");
  });
});
