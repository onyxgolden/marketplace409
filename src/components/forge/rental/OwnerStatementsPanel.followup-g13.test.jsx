// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import OwnerStatementsPanel from "./OwnerStatementsPanel";

// Controls-sweep follow-up G13 (M-19): active movements editable with an
// edit trail; voided movements stay uneditable.
const activeRow = { id: "m1", propertyId: null, kind: "disbursement", amount: 300, movementDate: "2026-09-12",
  method: "check", memo: "Owner draw", status: "active", editCount: 1, lastEditedAt: "2026-09-15T10:00:00Z" };
const voidedRow = { id: "m2", propertyId: null, kind: "disbursement", amount: 100, movementDate: "2026-09-01",
  method: "ach", memo: "Old draw", status: "voided" };

let fetchMock;
function stubFetch() {
  fetchMock = vi.fn(async (url, options) => {
    if (String(url).includes("/api/rental/owner-movement-edits")) {
      return { ok: true, json: async () => ({ success: true, edits: [{ id: "e1", movementId: "m1",
        editedBy: "user-1", editedAt: "2026-09-15T10:00:00Z", oldAmount: 250, newAmount: 300,
        oldMovementDate: "2026-09-12", newMovementDate: "2026-09-12", oldMethod: "check", newMethod: "check",
        oldMemo: "Owner draw", newMemo: "Owner draw" }] }) };
    }
    if (String(url).includes("/api/rental/owner-movements") && options?.method === "PUT") {
      return { ok: true, json: async () => ({ success: true, movement: { ...activeRow, amount: 350 } }) };
    }
    if (String(url).includes("/api/rental/owner-movements")) {
      return { ok: true, json: async () => ({ movements: [activeRow, voidedRow],
        balance: { balanceCents: 50000, incomeCents: 100000, expenseCents: 20000, disbursementCents: 40000, contributionCents: 10000 } }) };
    }
    if (String(url).includes("/api/rental/owner-statement")) {
      return { ok: true, json: async () => ({ periodStart: "2026-10-01", periodEnd: "2026-10-31" }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

async function flush(times = 8) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

function click(button) {
  act(() => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function renderDisbursements() {
  stubFetch();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(<OwnerStatementsPanel />); });
  await flush();
  const tab = [...container.querySelectorAll("button")].find((item) => item.textContent === "Disbursements");
  expect(tab).toBeTruthy();
  click(tab);
  await flush();
  return { container, root };
}

describe("OwnerStatementsPanel follow-up G13", () => {
  it("M-19: editing an active movement PUTs the new values and confirms", async () => {
    const { container, root } = await renderDisbursements();
    const edit = [...container.querySelectorAll("button")].find((item) => item.textContent === "Edit");
    expect(edit).toBeTruthy();
    click(edit);
    await flush();
    const form = container.querySelector("form");
    expect(form).toBeTruthy();
    expect(form.textContent).toContain("Edit disbursement");
    const amountInput = form.querySelector('input[type="number"]');
    expect(amountInput.value).toBe("300");
    setInputValue(amountInput, "350");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    const put = fetchMock.mock.calls.find(([, options]) => options?.method === "PUT");
    expect(put).toBeTruthy();
    expect(JSON.parse(put[1].body)).toMatchObject({ id: "m1", amount: 350, movementDate: "2026-09-12", method: "check", memo: "Owner draw" });
    expect(container.textContent).toContain("Owner movement updated.");
    act(() => root.unmount());
  });

  it("M-19: voided movements stay uneditable", async () => {
    const { container, root } = await renderDisbursements();
    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows.length).toBe(2);
    const voidedRowEl = rows.find((row) => row.textContent.includes("Old draw"));
    expect(voidedRowEl).toBeTruthy();
    expect([...voidedRowEl.querySelectorAll("button")].some((b) => b.textContent === "Edit")).toBe(false);
    expect([...voidedRowEl.querySelectorAll("button")].some((b) => b.textContent === "Void")).toBe(false);
    act(() => root.unmount());
  });

  it("M-19: edited rows show an edit badge and a before→after trail", async () => {
    const { container, root } = await renderDisbursements();
    expect(container.textContent).toContain("Edited");
    const viewEdits = [...container.querySelectorAll("button")].find((item) => item.textContent === "View edits");
    expect(viewEdits).toBeTruthy();
    click(viewEdits);
    await flush();
    const trail = container.querySelector("[data-movement-edits]");
    expect(trail).toBeTruthy();
    expect(trail.textContent).toContain("$250.00 → $300.00");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/rental/owner-movement-edits?movementId=m1"))).toBe(true);
    act(() => root.unmount());
  });
});
