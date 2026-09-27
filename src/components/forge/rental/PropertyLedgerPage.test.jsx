// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import PropertyLedgerPage from "./PropertyLedgerPage";
import { clearSWRCache } from "../../../hooks/swrCache";

const ledgerPayload = {
  success: true,
  ledger: {
    propertyName: "308 Paula",
    entries: [],
    incomeCents: 0,
    expenseCents: 0,
    balanceCents: 0,
    entryCount: 0,
  },
};

const manualEntry = {
  id: "event:evt-1",
  sourceId: "evt-1",
  source: "manual",
  sourceLabel: "Manual entry",
  date: "2026-09-26",
  description: "Water heater replacement",
  debitCents: 45000,
  creditCents: 0,
  category: "Repairs",
  status: "active",
  balanceAfterCents: 45000,
};

const ledgerWithEntry = {
  success: true,
  ledger: { ...ledgerPayload.ledger, entries: [manualEntry], entryCount: 1 },
};

const fullEvent = {
  id: "evt-1",
  transactionKind: "expense",
  eventDate: "2026-09-26",
  amount: 450,
  description: "Water heater replacement",
  payee: "Gulf Coast Plumbing",
  checkNumber: "",
  bankAccountId: "",
  propertyId: "prop-1",
  tenantId: "",
  normalizedCategory: "property_repairs",
  memo: "",
  cleared: false,
  chargeTenant: false,
};

function stubFetch(handler) {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => handler(url, options)));
}

function renderPage(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <PropertyLedgerPage
        propertyId="prop-1"
        propertyLabel="308 Paula"
        properties={[{ id: "prop-1", label: "308 Paula" }]}
        tenants={[{ id: "tenant-1", display_name: "Eric Carrillo" }]}
        onClose={() => {}}
        {...props}
      />,
    );
  });
  return { container, root };
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearSWRCache();
  document.body.innerHTML = "";
});

describe("PropertyLedgerPage post buttons", () => {
  it("opens the transaction form modal on Post Income and closes it on cancel", async () => {
    stubFetch(async (url) => {
      if (url === "/api/rental/property-ledger?propertyId=prop-1") {
        return { ok: true, json: async () => ledgerPayload };
      }
      if (url === "/api/rental/bank-accounts") {
        return { ok: true, json: async () => ({ accounts: [] }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const { container } = renderPage();
    await act(async () => {});

    const postIncome = Array.from(container.querySelectorAll("button")).find((el) => el.textContent === "Post Income");
    act(() => { postIncome.click(); });
    // Modal title uses sentence case; the page button uses title case.
    expect(container.querySelector('[role="dialog"] h3')?.textContent).toBe("Post income");
    expect(container.textContent).toMatch(/Links this transaction to the tenant/);

    const closeButton = container.querySelector('[aria-label="Close transaction form"]');
    act(() => { closeButton.click(); });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("defers to host overrides when onPostIncome is provided", async () => {    stubFetch(async (url) => {
      if (url === "/api/rental/property-ledger?propertyId=prop-1") {
        return { ok: true, json: async () => ledgerPayload };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const onPostIncome = vi.fn();
    const { container } = renderPage({ onPostIncome });
    await act(async () => {});
    const postIncome = Array.from(container.querySelectorAll("button")).find((el) => el.textContent === "Post Income");
    act(() => { postIncome.click(); });
    expect(onPostIncome).toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("PropertyLedgerPage edit and delete", () => {
  function stubLedger(handler) {
    stubFetch(async (url, options) => {
      if (url === "/api/rental/property-ledger?propertyId=prop-1") {
        return { ok: true, json: async () => ledgerWithEntry };
      }
      if (url === "/api/rental/bank-accounts") {
        return { ok: true, json: async () => ({ accounts: [] }) };
      }
      return handler(url, options);
    });
  }

  function openDetail(container) {
    const descriptionButton = container.querySelector('[data-ledger-entry="manual"] button[title="View transaction detail"]');
    act(() => { descriptionButton.click(); });
  }

  async function waitForEntry(container) {
    for (let i = 0; i < 20; i += 1) {
      if (container.querySelector('[data-ledger-entry="manual"]')) return;
      await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 25); }); });
    }
    throw new Error("ledger entry never rendered");
  }

  it("loads the full event and opens the edit form for a manual entry", async () => {
    stubLedger(async (url) => {
      if (url === "/api/rental/transactions?eventId=evt-1") {
        return { ok: true, json: async () => ({ success: true, event: fullEvent }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const { container } = renderPage();
    await waitForEntry(container);
    openDetail(container);
    expect(container.textContent).toMatch(/Transaction detail/);

    const editButton = Array.from(container.querySelectorAll("button")).find((el) => el.textContent === "Edit");
    await act(async () => { editButton.click(); });

    const dialogTitle = container.querySelector('[role="dialog"] h3');
    expect(dialogTitle?.textContent).toBe("Edit transaction");
    const payeeLabel = Array.from(container.querySelectorAll('[role="dialog"] label'))
      .find((el) => el.textContent.trim().startsWith("Payee"));
    expect(payeeLabel?.querySelector("input")?.value).toBe("Gulf Coast Plumbing");
  });

  it("soft-deletes through the two-step confirm and refreshes the ledger", async () => {
    let deletedEventId = null;
    let ledgerCalls = 0;
    stubFetch(async (url, options) => {
      if (url === "/api/rental/property-ledger?propertyId=prop-1") {
        ledgerCalls += 1;
        return { ok: true, json: async () => ledgerWithEntry };
      }
      if (url === "/api/rental/transactions?eventId=evt-1" && options?.method === "DELETE") {
        deletedEventId = "evt-1";
        return { ok: true, json: async () => ({ success: true }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const { container } = renderPage();
    await waitForEntry(container);
    openDetail(container);

    const deleteButton = Array.from(container.querySelectorAll("button")).find((el) => el.textContent === "Delete");
    act(() => { deleteButton.click(); });
    // First click only arms the confirm — nothing is deleted yet.
    expect(deletedEventId).toBeNull();
    expect(container.textContent).toMatch(/Delete this transaction\?/);

    const confirmButton = Array.from(container.querySelectorAll("button")).find((el) => el.textContent === "Confirm delete");
    await act(async () => { confirmButton.click(); });
    expect(deletedEventId).toBe("evt-1");
    expect(ledgerCalls).toBeGreaterThan(1);
  });

  it("shows no edit or delete controls for imported entries", async () => {
    const importedEntry = { ...manualEntry, source: "rentec_import", sourceLabel: "Rentec import" };
    stubFetch(async (url) => {
      if (url === "/api/rental/property-ledger?propertyId=prop-1") {
        return { ok: true, json: async () => ({ success: true, ledger: { ...ledgerPayload.ledger, entries: [importedEntry], entryCount: 1 } }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const { container } = renderPage();
    for (let i = 0; i < 20; i += 1) {
      if (container.querySelector('[data-ledger-entry="rentec_import"]')) break;
      await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 25); }); });
    }
    const descriptionButton = container.querySelector('[data-ledger-entry="rentec_import"] button[title="View transaction detail"]');
    act(() => { descriptionButton.click(); });
    expect(container.textContent).toMatch(/Transaction detail/);
    const buttons = Array.from(container.querySelectorAll("button")).map((el) => el.textContent);
    expect(buttons).not.toContain("Edit");
    expect(buttons).not.toContain("Delete");
  });
});

describe("PropertyLedgerPage split display", () => {
  it("shows split lines in the transaction detail for a manual entry", async () => {
    const entry = {
      id: "event:evt-1", sourceId: "evt-1", source: "manual", sourceLabel: "Manual entry",
      date: "2026-09-26", description: "Split expense", debitCents: 45000, creditCents: 0,
      category: "Repairs", status: "active", balanceAfterCents: 45000,
    };
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url === "/api/rental/property-ledger?propertyId=prop-1") {
        return { ok: true, json: async () => ({ success: true, ledger: { propertyName: "308 Paula", entries: [entry], incomeCents: 0, expenseCents: 45000, balanceCents: -45000, entryCount: 1 } }) };
      }
      if (url === "/api/rental/transaction-splits?eventId=evt-1") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            splits: [
              { id: "split-1", normalized_category: "property_repairs", amount: 300, memo: null },
              { id: "split-2", normalized_category: "supplies", amount: 150, memo: "Filters" },
            ],
          }),
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<PropertyLedgerPage propertyId="prop-1" propertyLabel="308 Paula" onClose={() => {}} />);
    });
    for (let i = 0; i < 20; i += 1) {
      if (container.querySelector('[data-ledger-entry="manual"]')) break;
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 25); }); });
    }
    const descriptionButton = container.querySelector('[data-ledger-entry="manual"] button[title="View transaction detail"]');
    act(() => { descriptionButton.click(); });
    for (let i = 0; i < 20; i += 1) {
      if (container.textContent.includes("Split lines")) break;
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 25); }); });
    }
    expect(container.textContent).toMatch(/Split lines/);
    expect(container.textContent).toMatch(/\$300\.00/);
    expect(container.textContent).toMatch(/Filters/);
  });
});
