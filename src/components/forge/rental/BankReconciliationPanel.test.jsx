// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBankLedger } from "@/application/rental/bankLedger";
import BankReconciliationPanel from "./BankReconciliationPanel";

const ev = (id, date, kind, amount, cleared = false, clearedAt = null) => ({
  id, event_date: date, transaction_kind: kind, amount, description: id, cleared, cleared_at: clearedAt, status: "active",
});
const entries = buildBankLedger({
  financialEvents: [
    ev("open", "2026-08-01", "income", 1000, true, "2026-08-05T00:00:00Z"),
    ev("rent1", "2026-09-01", "income", 1500),
    ev("mortgage", "2026-09-05", "expense", 800),
    ev("rent2", "2026-09-30", "income", 1500),
  ],
}).entries;

const savedSept = {
  id: "rec_1", status: "active", period_start: "2026-09-01", period_end: "2026-09-30", created_at: "2026-10-03T00:00:00Z",
  statement_ending_balance_cents: 170000, cleared_balance_cents: 170000, book_balance_cents: 320000, difference_cents: 0,
  outstanding_count: 1, outstanding_deposits_cents: 150000, outstanding_payments_cents: 0,
  cleared_snapshot: [
    { eventId: "rent1", clearedBefore: false, clearedAtBefore: null, clearedAfter: true },
    { eventId: "mortgage", clearedBefore: false, clearedAtBefore: null, clearedAfter: true },
  ],
  cleared_event_ids: ["rent1", "mortgage"], outstanding_event_ids: ["rent2"],
};

function fakeApi({ reconciliations = [], available = true, failOn = null } = {}) {
  const calls = [];
  return {
    calls,
    list: vi.fn(async () => ({ available, reconciliations })),
    setCleared: vi.fn(async (id, cleared) => {
      calls.push(["patch", id, cleared]);
      if (failOn === id && cleared) throw new Error("network down");
    }),
    post: vi.fn(async (payload) => {
      calls.push(["post", payload]);
      return payload.action === "undo" ? { restored: 2 } : { reconciliation: { id: "rec_new" } };
    }),
  };
}

let container;
let root;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
});

async function render(api, onChanged = vi.fn()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<BankReconciliationPanel bankAccountId="acct_1" entries={entries} api={api} onChanged={onChanged} />); });
  return onChanged;
}

const setterFor = (el) => Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
async function type(label, value) {
  const el = container.querySelector(`input[aria-label="${label}"]`);
  await act(async () => {
    setterFor(el).call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(el) { await act(async () => { el.click(); }); }
const button = (text) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent.startsWith(text));
const figures = () => container.querySelector('dl[aria-label="Reconciliation figures"]').textContent;

async function enterStatement(balance = "1,700.00") {
  await type("Statement start", "2026-09-01");
  await type("Statement end", "2026-09-30");
  await type("Statement ending balance", balance);
}
async function mark(desc) {
  // Both the phone list and the table render a checkbox; either one toggles the item.
  await click(container.querySelector(`input[aria-label="Cleared: ${desc}"]`));
}
async function passGate() {
  await click(container.querySelector('input[aria-label="Acknowledge"]'));
  await type("Type CONFIRM", "CONFIRM");
}

describe("BankReconciliationPanel", () => {
  it("computes the difference live as items are marked, from the pure domain math", async () => {
    await render(fakeApi());
    await enterStatement();
    expect(figures()).toContain("$1,700.00"); // statement
    expect(figures()).toContain("$1,000.00"); // cleared so far
    expect(figures()).toContain("$700.00"); // difference
    await mark("rent1");
    await mark("mortgage");
    expect(figures()).toContain("$0.00");
    expect(container.querySelector("[data-proof]").textContent).toContain("1 item — deposits in transit $1,500.00");
  });

  it("writes nothing until the checkbox AND typed CONFIRM gate is passed", async () => {
    const api = fakeApi();
    await render(api);
    await enterStatement();
    await mark("rent1");
    await mark("mortgage");
    await click(button("Save reconciliation"));
    const apply = button("Apply and save");
    expect(apply.disabled).toBe(true);
    await click(container.querySelector('input[aria-label="Acknowledge"]'));
    expect(apply.disabled).toBe(true);
    await type("Type CONFIRM", "confirm");
    expect(apply.disabled).toBe(true);
    expect(api.setCleared).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("applies cleared changes through the existing PATCH, then saves with the pre-change snapshot", async () => {
    const api = fakeApi();
    const onChanged = await render(api);
    await enterStatement();
    await mark("rent1");
    await mark("mortgage");
    await click(button("Save reconciliation"));
    await passGate();
    await click(button("Apply and save"));
    expect(api.calls).toEqual([
      ["patch", "rent1", true],
      ["patch", "mortgage", true],
      ["post", {
        action: "save", confirm: "CONFIRM", bankAccountId: "acct_1", periodStart: "2026-09-01", periodEnd: "2026-09-30",
        statementEndingBalanceCents: 170000,
        snapshot: savedSept.cleared_snapshot,
      }],
    ]);
    expect(onChanged).toHaveBeenCalled();
    expect(container.textContent).toContain("Reconciled");
  });

  it("puts back already-applied changes and records nothing if a PATCH fails", async () => {
    const api = fakeApi({ failOn: "mortgage" });
    await render(api);
    await enterStatement();
    await mark("rent1");
    await mark("mortgage");
    await click(button("Save reconciliation"));
    await passGate();
    await click(button("Apply and save"));
    expect(api.calls).toEqual([["patch", "rent1", true], ["patch", "mortgage", true], ["patch", "rent1", false]]);
    expect(api.post).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]').textContent).toContain("nothing was saved");
  });

  it("shows a per-period report and undoes only behind the gate", async () => {
    const api = fakeApi({ reconciliations: [savedSept] });
    await render(api);
    await click(button("View report"));
    const report = container.querySelector("[data-reconciliation-report]");
    expect(report.textContent).toContain("Cleared on this statement (2)");
    expect(report.textContent).toContain("rent1");
    expect(report.textContent).toContain("Outstanding at statement end (1)");
    expect(report.textContent).toContain("rent2");

    await click(button("Undo"));
    expect(container.textContent).toContain("put 2 transaction(s) back");
    await type("Undo reason", "wrong statement");
    expect(button("Undo reconciliation").disabled).toBe(true);
    await passGate();
    await click(button("Undo reconciliation"));
    expect(api.post).toHaveBeenCalledWith({ action: "undo", confirm: "CONFIRM", id: "rec_1", reason: "wrong statement" });
    expect(container.textContent).toContain("2 transactions restored");
  });

  it("only offers undo on the latest active reconciliation and says when saving isn't enabled", async () => {
    const aug = { ...savedSept, id: "rec_0", period_start: "2026-08-01", period_end: "2026-08-31", cleared_snapshot: [] };
    await render(fakeApi({ reconciliations: [savedSept, aug] }));
    expect(Array.from(container.querySelectorAll("button")).filter((b) => b.textContent === "Undo")).toHaveLength(1);
    act(() => root.unmount());
    root = null;
    container.remove();
    await render(fakeApi({ available: false }));
    expect(container.textContent).toContain("needs a database update");
  });
});
