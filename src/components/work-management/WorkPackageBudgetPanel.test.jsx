// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import WorkPackageBudgetPanel from "./WorkPackageBudgetPanel.jsx";

const SUMMARY = {
  packageId: "forge_wp_1",
  packagePropertyId: "1900-w-decker",
  scope: "assigned_property",
  plannedCostCents: 15000,
  actualCostCents: 20000,
  varianceCents: 5000,
  hasPlan: true,
  includedEventCount: 2,
  includedEventIds: ["event_1", "event_2"],
  linkedEventCount: 2,
  excludedEventCount: 0,
  excludedEvents: [],
  ambiguousEventCount: 0,
  ambiguousEventIds: [],
  duplicateLinkCount: 0,
  suppressedContractorEventCount: 0,
  suppressedContractorAmountCents: 0,
  warnings: [],
  packageStatus: "in_progress",
  packageVersion: 3,
  packageUpdatedAt: "2026-10-08T12:00:00.000Z",
  budgetRevisions: [],
};

function stubFetch({ summary = SUMMARY, failSummary = false } = {}) {
  const patches = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    if (url === "/api/work-packages/forge_wp_1/cost-summary") {
      if (failSummary) return { ok: false, json: async () => ({ error: "summary unavailable" }) };
      return { ok: true, json: async () => ({ summary }) };
    }
    if (url === "/api/work-packages/forge_wp_1" && options.method === "PATCH") {
      patches.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ package: { id: "forge_wp_1", planned_cost_cents: 125000, version: 4 } }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
  return { patches };
}

function renderPanel(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<WorkPackageBudgetPanel packageId="forge_wp_1" {...props} />);
  });
  return { container, root };
}

async function settle() {
  await act(async () => {});
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("WorkPackageBudgetPanel (Slice 3)", () => {
  it("shows planned, recorded spending, and Over budget by without a signed variance", async () => {
    stubFetch();
    const { container } = renderPanel();
    expect(container.textContent).toContain("Loading budget and spending…");
    await settle();
    expect(container.textContent).toContain("Planned budget");
    expect(container.textContent).toContain("$150.00");
    expect(container.textContent).toContain("$200.00 recorded");
    expect(container.textContent).toContain("Over budget by $50.00");
    expect(container.textContent).toContain("2 linked financial events included.");
    expect(container.querySelector('a[href="#work-package-links"]')).not.toBeNull();
  });

  it("distinguishes no budget and $0.00 recorded from no linked events", async () => {
    stubFetch({
      summary: {
        ...SUMMARY,
        plannedCostCents: null,
        actualCostCents: 0,
        varianceCents: null,
        hasPlan: false,
        includedEventCount: 0,
        includedEventIds: [],
        linkedEventCount: 0,
      },
    });
    const { container } = renderPanel();
    await settle();
    expect(container.textContent).toContain("No budget set");
    expect(container.textContent).toContain("$0.00 recorded");
    expect(container.textContent).toContain("No eligible linked financial events yet.");
  });

  it("shows exclusion and ambiguity warnings plus budget history", async () => {
    stubFetch({
      summary: {
        ...SUMMARY,
        excludedEventCount: 1,
        ambiguousEventCount: 1,
        ambiguousEventIds: ["event_3"],
        warnings: [
          { code: "ambiguous_multiple_packages", eventId: "event_3", message: "This financial event is linked to multiple packages, so it is excluded from package actuals until the attribution is resolved." },
          { code: "contractor_payment_recorded_separately", eventId: "event_4", message: "Contractor payout recorded separately; not included in package actuals" },
        ],
        budgetRevisions: [{
          id: "rev_1", actor: "user_9", at: "2026-10-08T12:00:00.000Z",
          old_planned_cost_cents: null, new_planned_cost_cents: 15000, reason: "Initial budget",
        }],
      },
    });
    const { container } = renderPanel();
    await settle();
    expect(container.textContent).toContain("1 ambiguous event was excluded from all package totals.");
    expect(container.textContent).toContain("Contractor payout recorded separately; not included in package actuals");
    expect(container.textContent).toContain("Budget history");
    expect(container.textContent).toContain("No budget set → $150.00 — Initial budget");
  });

  it("shows a load error with retry", async () => {
    stubFetch({ failSummary: true });
    const { container } = renderPanel();
    await settle();
    expect(container.textContent).toContain("Budget and spending could not be loaded (summary unavailable)");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Retry")).toBe(true);
  });

  it("saves a confirmed budget revision with reason and optimistic version", async () => {
    const { patches } = stubFetch();
    const onBudgetSaved = vi.fn(async () => {});
    const { container } = renderPanel({ onBudgetSaved });
    await settle();

    const budget = container.querySelector("#planned_budget");
    const reason = container.querySelector("#budget_reason");
    const confirmation = [...container.querySelectorAll('input[type="checkbox"]')][0];
    act(() => {
      setInputValue(budget, "1250.00");
      setInputValue(reason, "Revised estimate");
      confirmation.click();
    });
    const save = [...container.querySelectorAll("button")].find((button) => button.textContent === "Save budget");
    await act(async () => { save.click(); });
    await settle();

    expect(patches).toEqual([{
      planned_budget: "1250.00",
      budget_reason: "Revised estimate",
      expected_version: 3,
    }]);
    expect(onBudgetSaved).toHaveBeenCalledTimes(1);
  });

  it("hides the budget form for terminal packages", async () => {
    stubFetch();
    const { container } = renderPanel({ isTerminal: true });
    await settle();
    expect(container.textContent).toContain("This package is closed, so its planned budget cannot be edited.");
    expect(container.querySelector("#planned_budget")).toBeNull();
  });
});
