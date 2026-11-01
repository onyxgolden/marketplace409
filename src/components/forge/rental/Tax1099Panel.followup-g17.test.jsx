// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import Tax1099Panel from "./Tax1099Panel";

// Controls-sweep follow-up G17 (M-23): the entries list + per-entry
// void/correct. "Correct" voids the original with a reason and opens the
// entry form prefilled — saving posts the replacement as a new entry.
const OWNER = { id: "rec-a", kind: "owner", displayName: "Owner A", entityType: "individual", tinMasked: "***-**-1234" };

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
function setSelectValue(select, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  act(() => { setter.call(select, value); select.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function flush(times = 8) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
function click(button) {
  act(() => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

describe("Tax1099Panel follow-up G17", () => {
  let container;
  let root;
  let fetchMock;
  let entries;
  let summaryCalls;

  function installFetch() {
    entries = [
      { id: "e1", recipient_id: "rec-a", tax_year: 2026, payment_date: "2026-01-15", amount_cents: 160000,
        source: "manual", source_ref: null, memo: "Q1 distribution", status: "active", void_reason: null, voided_at: null },
      { id: "e2", recipient_id: "rec-a", tax_year: 2026, payment_date: "2026-04-15", amount_cents: 160000,
        source: "manual", source_ref: null, memo: "Q2 distribution", status: "active", void_reason: null, voided_at: null },
    ];
    summaryCalls = 0;
    fetchMock = vi.fn(async (url, options = {}) => {
      if (String(url).startsWith("/api/rental/1099/summary")) {
        summaryCalls += 1;
        const active = entries.filter((e) => e.status === "active");
        const total = active.reduce((sum, e) => sum + e.amount_cents, 0);
        return { ok: true, json: async () => ({
          rows: [{ recipientId: "rec-a", displayName: "Owner A", kind: "owner", entityType: "individual",
            formType: "1099-MISC", totalCents: total, paymentCount: active.length, tinMasked: "***-**-1234",
            reportable: total >= 60000, exclusionReason: null, filingStatus: "not_started", linkedPropertyCount: 1 }],
          summary: { recipientCount: 1, reportableCount: total >= 60000 ? 1 : 0, belowThresholdCount: 0, corpExcludedCount: 0,
            totalsByFormType: { "1099-MISC": total, "1099-NEC": 0 } },
        }) };
      }
      if (String(url).startsWith("/api/rental/1099/payment-entries?")) {
        return { ok: true, json: async () => ({ entries: [...entries] }) };
      }
      if (String(url).startsWith("/api/rental/1099/payment-entries/") && options.method === "PATCH") {
        const id = decodeURIComponent(String(url).split("/").pop());
        const body = JSON.parse(options.body);
        const entry = entries.find((e) => e.id === id);
        entry.status = "voided";
        entry.void_reason = body.voidReason;
        return { ok: true, json: async () => ({ success: true, entry }) };
      }
      if (String(url) === "/api/rental/1099/payment-entries" && options.method === "POST") {
        const body = JSON.parse(options.body);
        const entry = { id: `e${entries.length + 1}`, recipient_id: body.recipientId, tax_year: body.taxYear,
          payment_date: body.paymentDate, amount_cents: body.amountCents, source: "manual", source_ref: null,
          memo: body.memo, status: "active", void_reason: null, voided_at: null };
        entries.push(entry);
        return { ok: true, json: async () => ({ success: true, entry }) };
      }
      if (String(url).startsWith("/api/rental/1099/recipients")) return { ok: true, json: async () => ({ recipients: [OWNER] }) };
      if (String(url).startsWith("/api/rental/vendors")) return { ok: true, json: async () => ({ vendors: [] }) };
      if (String(url).startsWith("/api/rental/1099/payer-profile")) return { ok: true, json: async () => ({ profile: null }) };
      if (String(url).startsWith("/api/rental/1099/efile-status")) return { ok: true, json: async () => ({ efile: null }) };
      if (String(url).startsWith("/api/rental")) return { ok: true, json: async () => ({ units: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
  }

  async function renderRecipients() {
    installFetch();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<Tax1099Panel initialTab="recipients" />); });
    await flush();
  }

  function entryRow(memo) {
    const section = container.querySelector("[data-1099-entries]");
    expect(section).not.toBeNull();
    return [...section.querySelectorAll("tbody tr")].find((tr) => tr.textContent.includes(memo));
  }

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.unstubAllGlobals();
  });

  it("M-23: the list shows saved entries and voiding one updates the aggregates", async () => {
    await renderRecipients();
    expect(entryRow("Q1 distribution")).toBeTruthy();
    expect(entryRow("Q2 distribution")).toBeTruthy();
    expect(container.textContent).toContain("Owner distribution entries");
    const callsBefore = summaryCalls;
    const row = entryRow("Q1 distribution");
    click([...row.querySelectorAll("button")].find((b) => b.textContent === "Void"));
    await flush();
    const reason = container.querySelector("[data-1099-entries] input[placeholder='Reason for voiding']");
    expect(reason).toBeTruthy();
    setInputValue(reason, "Duplicate entry");
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Confirm void"));
    await flush();
    expect(container.textContent).toContain("Distribution entry voided.");
    expect(summaryCalls).toBeGreaterThan(callsBefore);
    const voided = entryRow("Q1 distribution");
    expect(voided.textContent).toContain("Voided");
    expect(voided.textContent).toContain("Duplicate entry");
    expect([...voided.querySelectorAll("button")]).toHaveLength(0);
    // Aggregates: the summary tab now totals only the surviving entry.
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Year summary"));
    await flush();
    expect(container.textContent).toContain("$1,600.00");
    expect(container.textContent).not.toContain("$3,200.00");
  });

  it("M-23: correcting voids the original and prefills the replacement form", async () => {
    await renderRecipients();
    const row = entryRow("Q2 distribution");
    click([...row.querySelectorAll("button")].find((b) => b.textContent === "Correct"));
    await flush();
    const reason = container.querySelector("[data-1099-entries] input[placeholder='Reason for correction']");
    expect(reason).toBeTruthy();
    setInputValue(reason, "Wrong amount");
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Void & correct"));
    await flush();
    expect(container.textContent).toContain("Original entry voided — save the corrected entry below");
    const form = [...container.querySelectorAll("form")].find((f) => f.textContent.includes("Record owner distribution"));
    expect(form).toBeTruthy();
    const amountInput = [...form.querySelectorAll("input")].find((i) => i.value === "1600.00");
    expect(amountInput).toBeTruthy();
    setInputValue(amountInput, "1700.00");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(container.textContent).toContain("Distribution entry recorded.");
    expect(entries.filter((e) => e.status === "active")).toHaveLength(2);
    expect(entries.find((e) => e.amount_cents === 170000)).toBeTruthy();
  });
});
