// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.stubGlobal("fetch", vi.fn());
import BootstrapConfirmPanel from "./BootstrapConfirmPanel.jsx";

const bill = (overrides = {}) => ({
  id: "videostream",
  payeeLabel: "VIDEOSTREAM",
  category: "subscriptions",
  displayLabel: "Subscriptions",
  cadence: "monthly",
  occurrences: 4,
  medianAmountCents: 1599,
  monthlyAmountCents: 1570,
  nextExpectedDate: "2026-10-05",
  ...overrides,
});

const incomeEntry = (overrides = {}) => ({
  id: "payroll-acme",
  payeeLabel: "PAYROLL ACME",
  category: "paycheck",
  displayLabel: "Paycheck",
  cadence: "biweekly",
  occurrences: 8,
  medianAmountCents: 250000,
  monthlyAmountCents: 541667,
  nextExpectedDate: "2026-10-09",
  ...overrides,
});

const payload = (overrides = {}) => ({
  success: true,
  scope: "personal",
  eventsAnalyzed: 240,
  lookbackStart: "2025-09-26",
  bills: [bill(), bill({ id: "power-co", payeeLabel: "POWER CO", category: "utilities_electric", displayLabel: "Electric", monthlyAmountCents: 12000 })],
  income: [incomeEntry()],
  ...overrides,
});

function jsonResponse(body, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

let container;
let root;

function renderPanel(props = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <BootstrapConfirmPanel scope="personal" month="2026-09" onConfirmed={() => {}} onDismissed={() => {}} {...props} />,
    );
  });
  return container;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function checkboxes() {
  return [...container.querySelectorAll('input[type="checkbox"]')];
}

beforeEach(() => {
  vi.clearAllMocks();
  fetch.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("BootstrapConfirmPanel", () => {
  it("pre-checks every detected bill and shows income as informational only", async () => {
    fetch.mockResolvedValueOnce(jsonResponse(payload()));
    renderPanel();
    await flush();

    const boxes = checkboxes();
    // Two bill checkboxes; the income entry has none.
    expect(boxes).toHaveLength(2);
    expect(boxes.every((box) => box.checked)).toBe(true);
    expect(container.textContent).toContain("PAYROLL ACME");
    expect(container.textContent).toContain("Add 2 to my budget");
  });

  it("deselecting a bill removes it from the confirm write", async () => {
    fetch.mockResolvedValueOnce(jsonResponse(payload()));
    const onConfirmed = vi.fn();
    renderPanel({ onConfirmed });
    await flush();

    // Uncheck the first bill (VIDEOSTREAM).
    await act(async () => {
      checkboxes()[0].click();
    });
    expect(checkboxes()[0].checked).toBe(false);
    expect(container.textContent).toContain("Add 1 to my budget");

    fetch.mockResolvedValueOnce(jsonResponse({ success: true, month: "2026-09", created: [], skipped: [] }));
    await act(async () => {
      container.querySelector('button[type="submit"]').click();
    });

    expect(fetch).toHaveBeenLastCalledWith(
      "/api/budgeting/bootstrap",
      expect.objectContaining({ method: "POST" }),
    );
    const sentBody = JSON.parse(fetch.mock.calls[1][1].body);
    // Only the kept POWER CO bill is written -- the deselected one never leaves the client.
    expect(sentBody.items).toEqual([
      { normalizedCategory: "utilities_electric", displayLabel: "Electric", plannedAmountCents: 12000 },
    ]);
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it("shows the honest no-history empty state when nothing was analyzed", async () => {
    fetch.mockResolvedValueOnce(jsonResponse(payload({ eventsAnalyzed: 0, bills: [], income: [] })));
    renderPanel();
    await flush();

    expect(container.textContent).toContain("No transaction history to learn from yet.");
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });

  it("shows a distinct empty state when history exists but nothing recurs", async () => {
    fetch.mockResolvedValueOnce(jsonResponse(payload({ eventsAnalyzed: 187, bills: [], income: [] })));
    renderPanel();
    await flush();

    expect(container.textContent).toContain("No steady recurring bills found.");
    expect(container.textContent).toContain("187 transactions");
  });

  it("dismisses to a blank start via the 'build it myself' action", async () => {
    fetch.mockResolvedValueOnce(jsonResponse(payload()));
    const onDismissed = vi.fn();
    renderPanel({ onDismissed });
    await flush();

    await act(async () => {
      [...container.querySelectorAll("button")].find((b) => b.textContent.includes("build it myself")).click();
    });
    expect(onDismissed).toHaveBeenCalledTimes(1);
  });

  it("surfaces a confirm failure without losing the checked state", async () => {
    fetch.mockResolvedValueOnce(jsonResponse(payload()));
    renderPanel();
    await flush();

    fetch.mockResolvedValueOnce(jsonResponse({ error: "Unable to save your budget." }, false));
    await act(async () => {
      container.querySelector('button[type="submit"]').click();
    });

    expect(container.textContent).toContain("Unable to save your budget.");
    // Checked state survives the failure -- the user can retry.
    expect(checkboxes().every((box) => box.checked)).toBe(true);
  });
});
