// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TenantLedgerPage from "./TenantLedgerPage";
import { clearSWRCache } from "../../../hooks/swrCache";

const ledgerPayload = {
  ledger: {
    entries: [
      { id: "charge:c1", kind: "charge", date: "2026-09-01", amountCents: 127500, balanceEffectCents: 127500,
        label: "Rent charge", status: "open", method: null, period: "2026-09", leaseId: "l1",
        propertyLabel: "145 Laxon", unitLabel: "Unit A", reference: "c1", balanceAfterCents: 127500, rentecEvidence: [] },
      { id: "payment:p1", kind: "payment", date: "2026-09-05", amountCents: 50000, balanceEffectCents: -50000,
        label: "Payment", status: "succeeded", method: "cash", period: null, leaseId: "l1", chargeId: "c1",
        propertyLabel: "145 Laxon", unitLabel: "Unit A", reference: "CHK-101", refundedAmountCents: 0,
        settlement: null, rentecEvidence: [], notes: "Partial September rent", balanceAfterCents: 77500 },
    ],
    last3: [], unassigned: [],
    totals: { chargedCents: 127500, paidCents: 50000, refundedCents: 0 },
    balanceCents: 77500,
  },
  deposits: { entries: [], heldCents: 0, requiredCents: 0 },
  importedHistory: {
    renterId: "1754498",
    rows: [
      { id: "evt-1", eventDate: "2026-08-05", amountCents: 127500, description: "Rent payment",
        category: "rent", propertyId: "prop-1", rentecTransactionId: "txn-1",
        source: "rentec", affectsBalance: false, attribution: "rentec_renter_id_match" },
      { id: "evt-2", eventDate: "2026-07-05", amountCents: 127500, description: "Rent payment",
        category: "rent", propertyId: "prop-1", rentecTransactionId: "txn-2",
        source: "rentec", affectsBalance: false, attribution: "rentec_renter_id_match" },
    ],
    totalCents: 255000,
  },
  openCharges: [
    { id: "c1", period: "2026-09", dueDate: "2026-09-01", chargeType: "rent", amountCents: 127500, paidCents: 50000, remainingCents: 77500, status: "open" },
  ],
};

function renderPage(props = {}, payloadOverride = null) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => payloadOverride || ledgerPayload })));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

describe("TenantLedgerPage", () => {
  let container;
  let root;

  // The stale-while-revalidate cache is module-global and keyed by tenant: clear
  // it so each test fetches its own stubbed payload instead of a previous
  // test's cached ledger.
  beforeEach(() => { clearSWRCache(); });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.unstubAllGlobals();
  });

  it("renders the Rentec-style columns with charges and payments in their own debit/credit columns", async () => {
    ({ container, root } = renderPage());
    await act(async () => root.render(<TenantLedgerPage tenantId="t1" tenantName="Paula" onClose={() => {}} />));
    const headers = [...container.querySelectorAll("[data-ledger-table] thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["Date", "Description", "Check #", "Debit", "Credit", "Balance", "C", "Edit"]);
    const rows = container.querySelectorAll("[data-ledger-table] tbody tr");
    expect(rows).toHaveLength(2);
    // Charge row: amount in the Debit column, dash in Credit.
    expect(rows[0].cells[3].textContent).toContain("$1,275.00");
    expect(rows[0].cells[4].textContent).toBe("—");
    // Payment row: amount in the Credit column, dash in Debit.
    expect(rows[1].cells[3].textContent).toBe("—");
    expect(rows[1].cells[4].textContent).toContain("$500.00");
  });

  it("shows the deposit state distinctly on payment rows — never conflated with settled money", async () => {
    const payload = {
      ...ledgerPayload,
      ledger: {
        ...ledgerPayload.ledger,
        entries: [
          { ...ledgerPayload.ledger.entries[0] },
          { ...ledgerPayload.ledger.entries[1], id: "payment:p1", depositState: "received" },
          { ...ledgerPayload.ledger.entries[1], id: "payment:p2", depositState: "deposited" },
        ],
      },
    };
    ({ container, root } = renderPage({}, payload));
    await act(async () => root.render(<TenantLedgerPage tenantId="t1" tenantName="Paula" onClose={() => {}} />));
    const rows = container.querySelectorAll("[data-ledger-table] tbody tr");
    expect(rows).toHaveLength(3);
    // Charge rows carry no deposit badge.
    expect(rows[0].textContent).not.toContain("Awaiting deposit");
    expect(rows[0].textContent).not.toContain("Deposited");
    // Payment rows show their own state at a glance.
    expect(rows[1].textContent).toContain("Awaiting deposit");
    expect(rows[2].textContent).toContain("Deposited");
  });

  it("shows the rolling balance per row, red while the tenant owes", async () => {
    ({ container, root } = renderPage());
    await act(async () => root.render(<TenantLedgerPage tenantId="t1" tenantName="Paula" onClose={() => {}} />));
    const rows = container.querySelectorAll("[data-ledger-table] tbody tr");
    expect(rows[0].cells[5].textContent).toContain("$1,275.00");
    expect(rows[1].cells[5].textContent).toContain("$775.00");
    expect(rows[1].cells[5].className).toContain("text-red-700");
    expect(container.textContent).toContain("owed");
  });

  it("keeps security deposits out of the transaction table in their own section", async () => {
    ({ container, root } = renderPage());
    await act(async () => root.render(<TenantLedgerPage tenantId="t1" tenantName="Paula" onClose={() => {}} />));
    expect(container.querySelector("[data-ledger-deposits]").textContent).toContain("never rent");
    expect(container.querySelector("[data-ledger-deposits]").textContent).toContain("Currently held: $0.00");
  });

  it("opens a read-only transaction detail when a row's description is clicked", async () => {
    ({ container, root } = renderPage());
    await act(async () => root.render(<TenantLedgerPage tenantId="t1" tenantName="Paula" onClose={() => {}} />));
    const descriptionButton = container.querySelectorAll("[data-ledger-table] tbody tr")[1]
      .querySelector("button[title='View transaction detail']");
    await act(async () => descriptionButton.click());
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Transaction detail");
    expect(dialog.textContent).toContain("CHK-101");
    expect(dialog.textContent).toContain("Partial September rent");
    expect(dialog.textContent).toContain("Payment · cash");
    expect(dialog.textContent).toContain("Tenant payment ledger");
    // Close affordance works.
    await act(async () => dialog.querySelector('button[aria-label="Close transaction detail"]').click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("toggles the Post Income form from the toolbar", async () => {
    ({ container, root } = renderPage());
    await act(async () => root.render(<TenantLedgerPage tenantId="t1" tenantName="Paula" onClose={() => {}} />));
    expect(container.querySelector("[data-post-income-form]")).toBeNull();
    const postIncome = [...container.querySelectorAll("button")].find((b) => b.textContent === "Post Income");
    await act(async () => postIncome.click());
    expect(container.querySelector("[data-post-income-form]")).not.toBeNull();
    expect(container.querySelector("[data-post-income-form]").textContent).toContain("Paula");
  });

  it("renders the Imported Rentec Transactions section when the tenant has linked Rentec history", async () => {
    ({ container, root } = renderPage());
    await act(async () => root.render(<TenantLedgerPage tenantId="t1" tenantName="Paula" onClose={() => {}} />));
    const section = container.querySelector("[data-imported-rentec-transactions]");
    expect(section).not.toBeNull();
    expect(section.textContent).toContain("Imported Rentec Transactions");
    expect(section.textContent).toContain("accounting history only");
    const rows = section.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0].cells[1].textContent).toContain("Rent payment");
    expect(rows[0].cells[3].textContent).toContain("$1,275.00");
    expect(section.textContent).toContain("2 transactions");
    expect(section.textContent).toContain("$2,550.00");
  });

  it("hides the Imported Rentec Transactions section when the tenant has no linked Rentec history", async () => {
    const emptyPayload = { ...ledgerPayload, importedHistory: { renterId: "1754498", rows: [], totalCents: 0 } };
    ({ container, root } = renderPage({}, emptyPayload));
    await act(async () => root.render(<TenantLedgerPage tenantId="t1" tenantName="Paula" onClose={() => {}} />));
    expect(container.querySelector("[data-imported-rentec-transactions]")).toBeNull();
  });

  it("shows a clear error when the ledger cannot load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "Tenant was not found." }) })));
    const local = document.createElement("div");
    document.body.appendChild(local);
    const localRoot = createRoot(local);
    await act(async () => localRoot.render(<TenantLedgerPage tenantId="missing" tenantName="?" onClose={() => {}} />));
    expect(local.querySelector('[role="alert"]').textContent).toContain("Tenant was not found");
    act(() => localRoot.unmount());
    local.remove();
  });
});

describe("TenantLedgerPage — reference parity (slice 2)", () => {
  let container;
  let root;
  beforeEach(() => { clearSWRCache(); });
  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.unstubAllGlobals();
  });

  const chargeRow = {
    id: "c1", leaseId: "l1", tenantId: "t1", chargeType: "rent", amountCents: 127500,
    dueDate: "2026-09-01", notes: "September rent", paidCents: 50000, status: "open",
  };

  function stubRoutes(payloadOverride = null) {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).startsWith("/api/rental/tenant-charges")) {
        if (init?.method === "PATCH") {
          return { ok: true, json: async () => ({ charge: { ...chargeRow, ...JSON.parse(init.body) } }) };
        }
        return { ok: true, json: async () => ({ charge: chargeRow }) };
      }
      if (String(url) === "/api/rental" && init?.method === "POST") return { ok: true, json: async () => ({ ok: true }) };
      return { ok: true, json: async () => payloadOverride || ledgerPayload };
    }));
    return calls;
  }

  async function renderLedger(props = {}, payloadOverride = null) {
    stubRoutes(payloadOverride);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<TenantLedgerPage tenantId="t1" tenantName="Paula" onClose={() => {}} {...props} />));
  }

  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function openInvoiceEditor() {
    const editButton = container.querySelector('button[aria-label^="Edit invoice"]');
    expect(editButton).not.toBeNull();
    await act(async () => editButton.click());
    expect(container.querySelector("[data-invoice-editor]")).not.toBeNull();
  }

  it("shows the breadcrumb, Ledger heading, and the Post Income / Post Charge / On Deposit actions", async () => {
    await renderLedger();
    const page = container.querySelector("[data-tenant-ledger-page]");
    expect(page.textContent).toContain("Tenants");
    expect(page.querySelector("h2").textContent).toBe("Ledger");
    expect([...page.querySelectorAll("button")].map((b) => b.textContent)).toContain("Post Income");
    expect([...page.querySelectorAll("button")].map((b) => b.textContent)).toContain("Post Charge");
    expect([...page.querySelectorAll("button")].map((b) => b.textContent)).toContain("On Deposit: $0.00");
  });

  it("reads the On Deposit pill from the held security-deposit total", async () => {
    const payload = {
      ...ledgerPayload,
      deposits: {
        entries: [{ id: "d1", label: "Security deposit", date: "2026-08-01", amountCents: 160000, balanceAfterCents: 160000 }],
        heldCents: 160000, requiredCents: 160000,
      },
    };
    await renderLedger({}, payload);
    expect([...container.querySelectorAll("button")].map((b) => b.textContent)).toContain("On Deposit: $1,600.00");
    expect(container.querySelector("[data-ledger-deposits]").textContent).toContain("Currently held: $1,600.00");
  });

  it("highlights the deposits section when the On Deposit pill is clicked", async () => {
    // Regression: the pill scrolled with no visible feedback, so the click looked dead.
    await renderLedger();
    const pill = [...container.querySelectorAll("button")].find((b) => b.textContent.startsWith("On Deposit:"));
    expect(pill).not.toBeUndefined();
    const depositsSection = container.querySelector("[data-ledger-deposits]");
    expect(depositsSection.className).not.toContain("shadow-[0_0_0_4px_rgba(56,189,248,0.35)]");
    await act(async () => { pill.click(); });
    expect(container.querySelector("[data-ledger-deposits]").className).toContain("shadow-[0_0_0_4px_rgba(56,189,248,0.35)]");
  });

  it("filters the table by transaction kind", async () => {
    await renderLedger();
    expect(container.querySelectorAll("[data-ledger-table] tbody tr")).toHaveLength(2);
    const filter = container.querySelector('select[aria-label="Filter transactions"]');
    await act(async () => {
      filter.value = "payments";
      filter.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const rows = container.querySelectorAll("[data-ledger-table] tbody tr");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Payment");
    expect(container.textContent).toContain("Showing 1 of 2 entries.");
  });

  it("filters the table by date range", async () => {
    await renderLedger();
    const range = container.querySelector('select[aria-label="Date range"]');
    // Both stub entries are September 2026 — "last month" (August 2026) shows none.
    await act(async () => {
      range.value = "lastMonth";
      range.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelectorAll("[data-ledger-table] tbody tr")).toHaveLength(0);
    expect(container.textContent).toContain("No charges or payments on record for this tenant yet.");
  });

  it("shows payment references in the Check # column", async () => {
    await renderLedger();
    const rows = container.querySelectorAll("[data-ledger-table] tbody tr");
    expect(rows[0].cells[2].textContent).toBe("—");
    expect(rows[1].cells[2].textContent).toContain("CHK-101");
  });

  it("opens Post Charge as the inline charge form", async () => {
    await renderLedger();
    expect(container.querySelector("[data-add-tenant-charge-form]")).toBeNull();
    const postCharge = [...container.querySelectorAll("button")].find((b) => b.textContent === "Post Charge");
    await act(async () => postCharge.click());
    expect(container.querySelector("[data-add-tenant-charge-form]")).not.toBeNull();
  });

  it("opens the invoice editor from a charge row's edit button", async () => {
    await renderLedger();
    await openInvoiceEditor();
    const editor = container.querySelector("[data-invoice-editor]");
    expect(editor.textContent).toContain("Edit Invoice");
    expect(editor.textContent).toContain("Invoice Details");
    expect(editor.textContent).toContain("Charge Lines");
    expect(editor.textContent).toContain("Delete Invoice");
    expect(editor.textContent).toContain("+ Add Charge");
    // One line (the charge itself), total recalculated from the lines.
    expect(editor.querySelectorAll("[data-invoice-line]")).toHaveLength(1);
    expect(editor.querySelector('input[aria-readonly]').value).toBe("$1,275.00");
  });

  it("adds and removes charge lines with the total recalculating", async () => {
    await renderLedger();
    await openInvoiceEditor();
    const editor = container.querySelector("[data-invoice-editor]");
    const addCharge = [...editor.querySelectorAll("button")].find((b) => b.textContent === "+ Add Charge");
    await act(async () => addCharge.click());
    expect(editor.querySelectorAll("[data-invoice-line]")).toHaveLength(2);
    const newLine = editor.querySelector('[data-invoice-line="new"]');
    const amountInput = newLine.querySelector('input[type="number"]');
    await act(async () => setInputValue(amountInput, "100.00"));
    expect(editor.querySelector('input[aria-readonly]').value).toBe("$1,375.00");
    const removeButton = newLine.querySelector('button[aria-label="Remove charge line"]');
    await act(async () => removeButton.click());
    expect(editor.querySelectorAll("[data-invoice-line]")).toHaveLength(1);
    expect(editor.querySelector('input[aria-readonly]').value).toBe("$1,275.00");
  });

  it("blocks saving an invoice line below already-applied payments", async () => {
    await renderLedger();
    await openInvoiceEditor();
    const editor = container.querySelector("[data-invoice-editor]");
    const amountInput = editor.querySelector('[data-invoice-line="existing"] input[type="number"]');
    await act(async () => setInputValue(amountInput, "400.00"));
    const save = [...editor.querySelectorAll("button")].find((b) => b.textContent.includes("Save Changes"));
    await act(async () => save.click());
    expect(editor.querySelector('[role="alert"]').textContent).toContain("already applied");
  });

  it("deletes the invoice in two steps through the void endpoint", async () => {
    const calls = stubRoutes();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<TenantLedgerPage tenantId="t1" tenantName="Paula" onClose={() => {}} />));
    await openInvoiceEditor();
    const editor = container.querySelector("[data-invoice-editor]");
    const deleteButton = [...editor.querySelectorAll("button")].find((b) => b.textContent === "Delete Invoice");
    await act(async () => deleteButton.click());
    // First click arms the confirm; second click fires.
    expect([...editor.querySelectorAll("button")].some((b) => b.textContent === "Confirm delete invoice")).toBe(true);
    expect(editor.querySelector('[role="alert"]').textContent).toContain("Deleting voids this invoice");
    const confirmButton = [...editor.querySelectorAll("button")].find((b) => b.textContent === "Confirm delete invoice");
    await act(async () => confirmButton.click());
    const voidCall = calls.find((call) => call.url === "/api/rental" && call.init?.method === "POST");
    expect(voidCall).toBeDefined();
    const body = JSON.parse(voidCall.init.body);
    expect(body.operation).toBe("void-charge");
    expect(body.chargeId).toBe("c1");
  });

  it("saves invoice changes through the tenant-charges PATCH endpoint", async () => {
    const calls = stubRoutes();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<TenantLedgerPage tenantId="t1" tenantName="Paula" onClose={() => {}} />));
    await openInvoiceEditor();
    const editor = container.querySelector("[data-invoice-editor]");
    const amountInput = editor.querySelector('[data-invoice-line="existing"] input[type="number"]');
    await act(async () => setInputValue(amountInput, "1300.00"));
    const save = [...editor.querySelectorAll("button")].find((b) => b.textContent.includes("Save Changes"));
    await act(async () => save.click());
    const patchCall = calls.find((call) => String(call.url).startsWith("/api/rental/tenant-charges") && call.init?.method === "PATCH");
    expect(patchCall).toBeDefined();
    const body = JSON.parse(patchCall.init.body);
    expect(body.chargeId).toBe("c1");
    expect(body.amountCents).toBe(130000);
    expect(body.dueDate).toBe("2026-09-01");
    expect(editor.textContent).toContain("Invoice saved");
  });

  it("hides the edit affordance on voided charges", async () => {
    const payload = {
      ...ledgerPayload,
      ledger: {
        ...ledgerPayload.ledger,
        entries: [{ ...ledgerPayload.ledger.entries[0], status: "void" }],
      },
    };
    await renderLedger({}, payload);
    expect(container.querySelector('button[aria-label^="Edit invoice"]')).toBeNull();
  });

  it("opens the property ledger cross-link with the property key", async () => {
    const spy = vi.fn();
    await renderLedger({ onOpenPropertyLedger: spy });
    const link = [...container.querySelectorAll("button")].find((b) => b.textContent === "Open property ledger");
    expect(link).not.toBeNull();
    await act(async () => link.click());
    expect(spy).toHaveBeenCalledWith("145 Laxon", expect.any(String));
  });

  it("links deposited payments to the bank ledger", async () => {
    const spy = vi.fn();
    const payload = {
      ...ledgerPayload,
      ledger: {
        ...ledgerPayload.ledger,
        entries: [
          ledgerPayload.ledger.entries[0],
          { ...ledgerPayload.ledger.entries[1], depositState: "deposited" },
        ],
      },
    };
    await renderLedger({ onOpenBankLedger: spy }, payload);
    const link = [...container.querySelectorAll("button")].find((b) => b.textContent === "View in bank ledger");
    expect(link).not.toBeNull();
    await act(async () => link.click());
    expect(spy).toHaveBeenCalled();
  });
});
