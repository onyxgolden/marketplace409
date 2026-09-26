// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.stubGlobal("fetch", vi.fn());
import LeftThisMonthPanel from "./LeftThisMonthPanel.jsx";
import { clearSWRCache } from "../../../hooks/swrCache.js";

function todayISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function recurringPattern(overrides) {
  return {
    accountId: "acct-1",
    accountName: "Checking",
    businessScope: "personal",
    category: "paycheck",
    cadence: "monthly",
    medianIntervalDays: 30,
    occurrences: 6,
    medianAmount: 100,
    nextExpectedDate: todayISO(),
    ...overrides,
  };
}

function mockApis({ patterns, lines }) {
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url) === "/api/financial/recurring") {
      return new Response(JSON.stringify({ success: true, patterns }), { status: 200 });
    }
    if (String(url).startsWith("/api/budgeting/plan")) {
      return new Response(JSON.stringify({ lines }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(<LeftThisMonthPanel />);
  });
  return container;
}

describe("LeftThisMonthPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSWRCache();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the spelled-out math from real recurring and budget data", async () => {
    mockApis({
      patterns: [
        recurringPattern({ direction: "inbound", category: "paycheck", medianAmount: 2000 }),
        recurringPattern({ direction: "outbound", category: "mortgage", medianAmount: 1500 }),
      ],
      lines: [{ plannedAmountCents: 80000, actualAmountCents: 65000 }],
    });
    const container = await mount();
    const text = container.textContent;
    // $2,000 income − $1,500 bills − $150 planned = $350 left
    expect(text).toContain("$2,000.00 expected income");
    expect(text).toContain("$1,500.00 expected bills");
    expect(text).toContain("$150.00 planned spending");
    expect(text).toContain("$350.00 left");
    expect(text).toContain("/day for");
  });

  it("explains each term's source instead of hiding the derivation", async () => {
    mockApis({
      patterns: [recurringPattern({ direction: "outbound", category: "mortgage", medianAmount: 1500 })],
      lines: [],
    });
    const container = await mount();
    const text = container.textContent;
    expect(text).toContain("detected from your transaction history");
    expect(text).toContain("No budget plan for");
  });

  it("shows the explanatory empty state -- never a $0 headline -- when there is no data", async () => {
    mockApis({ patterns: [], lines: [] });
    const container = await mount();
    const text = container.textContent;
    expect(text).toContain("Not enough data to say what’s left this month");
    expect(text).toContain("won’t guess");
    // Competitor-pattern drill-through: one tap to the plan that feeds the widget.
    const budgetLink = container.querySelector('a[href="/forge/budget"]');
    expect(budgetLink).not.toBeNull();
    expect(budgetLink.textContent).toContain("Set up a budget");
  });

  it("frames a negative residual as over budget", async () => {
    mockApis({
      patterns: [recurringPattern({ direction: "outbound", category: "mortgage", medianAmount: 1500 })],
      lines: [{ plannedAmountCents: 200000, actualAmountCents: 10000 }],
    });
    const container = await mount();
    // $0 income − $1,500 bills − $1,900 planned = $3,400 over budget
    expect(container.textContent).toContain("$3,400.00 over budget");
    expect(container.textContent).toContain("over budget for");
  });

  it("treats an unavailable budget as untracked planned spending, not zero", async () => {
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url) === "/api/financial/recurring") {
        return new Response(
          JSON.stringify({
            success: true,
            patterns: [recurringPattern({ direction: "inbound", medianAmount: 2000 })],
          }),
          { status: 200 },
        );
      }
      if (String(url).startsWith("/api/budgeting/plan")) {
        return new Response(
          JSON.stringify({ error: "Budgeting schema unavailable.", code: "budgeting_schema_unavailable" }),
          { status: 503 },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const container = await mount();
    const text = container.textContent;
    expect(text).toContain("$2,000.00 left");
    expect(text).toContain("planned spending not tracked yet");
  });

  it("renders 'not tracked yet' -- never a headline number -- when recurring data is missing", async () => {
    mockApis({
      patterns: [],
      lines: [{ plannedAmountCents: 50000, actualAmountCents: 10000 }],
    });
    const container = await mount();
    const text = container.textContent;
    // The budget alone must not produce a "$400 over budget" headline.
    expect(text).not.toContain("over budget");
    expect(text).toContain("not tracked yet");
    expect(text).toContain("expected income not tracked yet");
  });
});
