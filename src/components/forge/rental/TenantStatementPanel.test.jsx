// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TenantStatementPanel, { formatStatementDate, statementPeriodOptions } from "./TenantStatementPanel.jsx";

const statementBody = {
  success: true,
  statement: {
    tenantName: "Tenant A",
    propertyLabel: "prop_1",
    unitLabel: "Unit A",
    period: { start: "2026-10-01", end: "2026-10-31", label: "October 2026" },
    openingBalanceCents: 160000,
    entries: [
      { id: "charge:c2", kind: "charge", date: "2026-10-01", label: "Rent charge", status: "due", debitCents: 160000, creditCents: 0, balanceAfterCents: 320000 },
      { id: "payment:p1", kind: "payment", date: "2026-10-10", label: "Payment", status: "succeeded", debitCents: 0, creditCents: 160000, balanceAfterCents: 160000 },
    ],
    closingBalanceCents: 160000,
    totals: { chargedCents: 160000, paidCents: 160000, refundedCents: 0 },
  },
};

let container;
let root;
let fetchMock;
let requestedUrls;

function renderPanel() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(<TenantStatementPanel />); });
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  requestedUrls = [];
  fetchMock = vi.fn(async (url) => { requestedUrls.push(url); return { ok: true, json: async () => statementBody }; });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  if (root) act(() => { root.unmount(); });
  if (container) container.remove();
  root = null; container = null;
  vi.unstubAllGlobals();
});

describe("statementPeriodOptions", () => {
  it("lists the current month first, then the 11 prior months", () => {
    const options = statementPeriodOptions(12, new Date(2026, 9, 15)); // Oct 2026
    expect(options).toHaveLength(12);
    expect(options[0]).toEqual({ value: "2026-10", label: "October 2026" });
    expect(options[11]).toEqual({ value: "2025-11", label: "November 2025" });
  });
});

describe("formatStatementDate", () => {
  it("formats a YYYY-MM-DD date and blanks a missing one", () => {
    expect(formatStatementDate("2026-10-01")).toBe("Oct 1, 2026");
    expect(formatStatementDate(null)).toBe("—");
  });
});

describe("TenantStatementPanel", () => {
  it("fetches the current month and renders opening, line items, and closing balances", async () => {
    renderPanel();
    await flush();
    expect(requestedUrls[0]).toMatch(/\/api\/rental\/portal\/statement\?period=\d{4}-\d{2}$/);
    const text = container.textContent;
    expect(text).toContain("Tenant A");
    expect(text).toContain("October 2026");
    expect(text).toContain("Opening balance");
    expect(text).toContain("Closing balance");
    expect(text).toContain("$1,600.00"); // opening
    expect(text).toContain("$3,200.00"); // after the rent charge
    expect(text).toContain("Rent charge");
    expect(text).toContain("Payment");
    // The print button renders; print chrome (period selector + print button) is marked print:hidden.
    expect(container.querySelector("button")?.textContent).toContain("Print or save as PDF");
    expect(container.querySelector("select")).not.toBeNull();
  });

  it("re-fetches when the tenant picks another month", async () => {
    renderPanel();
    await flush();
    const select = container.querySelector("select");
    await act(async () => {
      select.value = "2026-09";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[1]).toContain("period=2026-09");
  });

  it("shows an empty-period message when the month has no activity", async () => {
    const empty = { ...statementBody, statement: { ...statementBody.statement, entries: [], openingBalanceCents: 0, closingBalanceCents: 0 } };
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => empty });
    renderPanel();
    await flush();
    expect(container.textContent).toContain("No activity in October 2026.");
  });

  it("shows an error state when the statement cannot load", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Unable to load your statement." }) });
    renderPanel();
    await flush();
    expect(container.textContent).toContain("Unable to load your statement.");
  });
});
