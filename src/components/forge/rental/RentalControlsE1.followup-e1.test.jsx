// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache } from "../../../hooks/swrCache";
import RentalLeasePanel from "./RentalLeasePanel";
import RentalTenantPanel from "./RentalTenantPanel";
import RentalPaymentsPanel from "./RentalPaymentsPanel";
import TenantCreditSection from "./TenantCreditSection";
import PropertyLedgerPage from "./PropertyLedgerPage";
import BankReconciliationPanel from "./BankReconciliationPanel";
import ChartOfAccountsPage from "./ChartOfAccountsPage";
import ReservationsPanel from "./ReservationsPanel";
import RentalTeamPanel from "./RentalTeamPanel";
import RentalInsurancePanel from "./RentalInsurancePanel";
import CustomFieldsEditor from "./CustomFieldsEditor";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const response = (body) => ({ ok: true, json: async () => body });
async function flush(times = 6) { for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
function click(el) { return act(async () => { el.click(); await Promise.resolve(); await Promise.resolve(); }); }

let root;
afterEach(() => { if (root) act(() => root.unmount()); root = null; document.body.innerHTML = ""; vi.unstubAllGlobals(); clearSWRCache(); });
function mount(node) {
  const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  act(() => root.render(node)); return container;
}

describe("controls-sweep follow-up E1 explanation pass", () => {
  it("L-11: empty-units/tenants banner links to Properties and Tenants", () => {
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={{ units: [], tenants: [], leases: [], schedules: [], leaseMemberships: [] }} loadOnMount={false} />);
    expect(markup).toContain("section=properties");
    expect(markup).toContain("section=tenants");
  });

  it("L-11: none-selected unit explains the disabled save", () => {
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={{ units: [{ id: "unit_1", label: "Unit A", property_id: "p1" }, { id: "unit_2", label: "Unit B", property_id: "p2" }], tenants: [{ id: "tenant_1", display_name: "Tenant One", email: "t@example.test" }], leases: [], schedules: [], leaseMemberships: [] }} loadOnMount={false} />);
    expect(markup).toContain("Select a rental unit above to enable saving.");
  });

  it("L-13/L-18: primary card states the removal rule and points at the other lease", async () => {
    const tenants = [
      { id: "tenant_1", display_name: "Tenant One", email: "one@example.test" },
      { id: "tenant_2", display_name: "Tenant Two", email: "two@example.test" },
    ];
    const data = {
      tenants,
      leases: [
        { id: "lease_1", unit_id: "unit_1", status: "active" },
        { id: "lease_2", unit_id: "unit_2", status: "draft" },
      ],
      leaseMemberships: [
        { lease_id: "lease_1", tenant_id: "tenant_1", occupancy_role: "primary" },
        { lease_id: "lease_1", tenant_id: "tenant_2", occupancy_role: "co_tenant" },
        { lease_id: "lease_2", tenant_id: "tenant_1", occupancy_role: "co_tenant" },
      ],
      units: [{ id: "unit_1", label: "Unit A" }, { id: "unit_2", label: "Unit B" }],
      openCharges: [],
    };
    vi.stubGlobal("fetch", vi.fn(async () => response(data)));
    const container = mount(<RentalTenantPanel initialTenants={tenants} recordContext={{ recordType: "tenant", recordId: "tenant_1" }} />);
    await flush();
    expect(container.textContent).toContain("The primary tenant cannot be removed from a lease. Change the primary tenant first.");
    expect(container.textContent).toContain("also on another lease (Unit B)");
  });

  it("L-15: no lease means create-a-lease guidance; all-on-lease means create-a-tenant guidance", async () => {
    const noLeaseTenants = [{ id: "tenant_3", display_name: "Tenant Three", email: "three@example.test" }];
    const noLeaseData = { tenants: noLeaseTenants, leases: [], leaseMemberships: [], units: [], openCharges: [] };
    vi.stubGlobal("fetch", vi.fn(async () => response(noLeaseData)));
    const containerA = mount(<RentalTenantPanel initialTenants={noLeaseTenants} recordContext={{ recordType: "tenant", recordId: "tenant_3" }} />);
    await flush();
    expect(containerA.textContent).toContain("Create a lease first");
    if (root) act(() => root.unmount()); root = null; document.body.innerHTML = ""; vi.unstubAllGlobals(); clearSWRCache();

    const soloTenants = [{ id: "tenant_1", display_name: "Tenant One", email: "one@example.test" }];
    const soloData = {
      tenants: soloTenants,
      leases: [{ id: "lease_1", unit_id: "unit_1", status: "active" }],
      leaseMemberships: [{ lease_id: "lease_1", tenant_id: "tenant_1", occupancy_role: "primary" }],
      units: [{ id: "unit_1", label: "Unit A" }],
      openCharges: [],
    };
    vi.stubGlobal("fetch", vi.fn(async () => response(soloData)));
    const containerB = mount(<RentalTenantPanel initialTenants={soloTenants} recordContext={{ recordType: "tenant", recordId: "tenant_1" }} />);
    await flush();
    expect(containerB.textContent).toContain("create a new tenant record first");
  });

  it("L-14: delete-unused-duplicate dialog names the portal-claimed exclusion", async () => {
    const tenants = [{ id: "tenant_3", display_name: "Tenant Three", email: "three@example.test" }];
    vi.stubGlobal("fetch", vi.fn(async () => response({ tenants, leases: [], leaseMemberships: [], units: [], openCharges: [] })));
    const container = mount(<RentalTenantPanel initialTenants={tenants} recordContext={{ recordType: "tenant", recordId: "tenant_3" }} />);
    await flush();
    const deleteButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Delete unused duplicate");
    expect(deleteButton).toBeDefined();
    await click(deleteButton);
    expect(container.querySelector("[role='alertdialog']").textContent).toContain("claimed the portal");
  });

  it("L-19: zero custom fields point at Properties settings instead of vanishing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ fields: [], values: {} })));
    const container = mount(<CustomFieldsEditor groups={[{ entity: "tenant", recordId: "tenant_1" }]} />);
    await flush();
    expect(container.textContent).toContain("No custom fields are defined yet");
    expect(container.textContent).toContain("Properties → settings");
  });

  it("M-25: a charge with a paid balance explains voiding and points at Refund/credit", () => {
    const markup = renderToStaticMarkup(<RentalPaymentsPanel initialData={{
      openCharges: [{ id: "charge_1", lease_id: "lease_1", period: "2026-10", status: "partially_paid", amount_cents: 130000, paid_amount_cents: 50000, due_date: "2026-10-01", charge_type: "rent" }],
      payments: [], settlements: [],
      leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "property-1", status: "active" }],
      units: [{ id: "unit_1", label: "Unit A", property_id: "property-1" }],
      tenants: [{ id: "tenant_1", display_name: "Tenant One" }],
      leaseMemberships: [{ lease_id: "lease_1", tenant_id: "tenant_1" }],
      schedules: [{ id: "schedule_1", lease_id: "lease_1", amount_cents: 130000, due_day: 1, status: "active" }],
    }} initialAccount={null} />);
    expect(markup).toContain("A charge with a paid balance cannot be voided");
    expect(markup).toContain("use Refund");
  });

  it("M-27: a non-money-moved payment explains the missing deposit toggle", () => {
    const markup = renderToStaticMarkup(<RentalPaymentsPanel initialData={{
      openCharges: [],
      payments: [{ id: "pay_1", lease_id: "lease_1", amount_cents: 130000, refunded_amount_cents: 0, status: "pending", payment_method: "cash", provider: "offline", received_at: "2026-08-02T12:00:00Z", created_at: "2026-08-02T12:00:00Z", deposit_state: "received", settlement: null }],
      settlements: [],
      leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "property-1", status: "active" }],
      units: [{ id: "unit_1", label: "Unit A", property_id: "property-1" }],
      tenants: [{ id: "tenant_1", display_name: "Tenant One" }],
      leaseMemberships: [{ lease_id: "lease_1", tenant_id: "tenant_1" }],
      schedules: [],
    }} initialAccount={null} />);
    expect(markup).toContain("Deposit state can only change once funds have moved.");
    expect(markup).not.toContain("Mark as deposited");
  });

  it("M-26: an open credit with no open charges says it will auto-apply", () => {
    const markup = renderToStaticMarkup(<TenantCreditSection credits={[{ id: "credit_1", status: "open", remaining_cents: 5000 }]} creditApplications={[]} openCharges={[]} />);
    expect(markup).toContain("Nothing to apply to yet — this credit will auto-apply to the next charge.");
  });

  it("M-28: imported ledger rows carry the read-only title and modal note", async () => {
    const importedEntry = {
      id: "event:evt-9", sourceId: "evt-9", source: "rentec", sourceLabel: "Rentec import",
      date: "2026-09-26", description: "Imported rent", debitCents: 0, creditCents: 130000,
      category: "Rent", status: "active", balanceAfterCents: 130000,
    };
    vi.stubGlobal("fetch", vi.fn(async () => response({ success: true, ledger: { propertyName: "308 Paula", entries: [importedEntry], incomeCents: 130000, expenseCents: 0, balanceCents: 130000, entryCount: 1 } })));
    const container = mount(<PropertyLedgerPage propertyId="prop-1" propertyLabel="308 Paula" properties={[{ id: "prop-1", label: "308 Paula" }]} tenants={[]} onClose={() => {}} />);
    await flush();
    const readOnlyCell = container.querySelector("[title='Imported transactions are read-only here']");
    expect(readOnlyCell).not.toBeNull();
    await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Imported rent"));
    await flush();
    expect(container.textContent).toContain("Imported transactions are read-only here.");
  });

  it("M-29: only the latest reconciliation offers Undo; older active rows explain why", async () => {
    const api = {
      list: vi.fn(async () => ({ available: true, reconciliations: [
        { id: "rec_new", status: "active", difference_cents: 0, cleared_snapshot: [] },
        { id: "rec_old", status: "active", difference_cents: 0, cleared_snapshot: [] },
      ] })),
      setCleared: vi.fn(async () => {}),
      post: vi.fn(async () => ({ restored: 0 })),
    };
    const container = mount(<BankReconciliationPanel bankAccountId="acct_1" entries={[]} api={api} onChanged={vi.fn()} />);
    await flush();
    expect(container.textContent).toContain("Only the latest reconciliation can be undone.");
    expect([...container.querySelectorAll("button")].filter((b) => b.textContent === "Undo").length).toBe(1);
  });

  it("M-30: fallback accounts explain they are synthetic in the drawer", async () => {
    const accounts = [
      { id: "fallback-rent", code: "fallback_rent", label: "Fallback rent", account_type: "income", is_active: true, is_system: true, usage_count: 0 },
    ];
    vi.stubGlobal("fetch", vi.fn(async (url) => response(String(url).includes("bank-accounts")
      ? { success: true, accounts: [] }
      : { success: true, accounts, transactions: [] })));
    const container = mount(<ChartOfAccountsPage />);
    await flush();
    const row = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Fallback rent"));
    expect(row).toBeDefined();
    await click(row);
    await flush();
    expect(container.textContent).toContain("Fallback accounts are synthetic and cannot be renamed or deactivated.");
  });

  it("O-04: a cancelled reservation states terminality and the re-book path", async () => {
    vi.stubGlobal("fetch", vi.fn((url) => Promise.resolve(response(url.endsWith("/inventory") ? { inventory: [{ unit_id: "unit-1", public_name: "Cabin One", booking_status: "active" }] } : {
      reservations: [{ id: "res-1", unit_id: "unit-1", status: "cancelled", check_in_date: "2026-10-01", check_out_date: "2026-10-03", guest_count: 2, total_due_cents: 25000, reservation_guests: { display_name: "Guest One", email: "guest@example.test" }, reservation_inventory_settings: { public_name: "Cabin One" }, reservation_financial_contracts: { booking_balance_cents: 20000, security_deposit_cents: 5000 } }],
      events: [{ id: "event-1", reservation_id: "res-1", event_type: "cancelled", occurred_at: "2026-09-13T00:00:00Z" }],
    }))));
    const container = mount(<ReservationsPanel />);
    await flush();
    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent.includes("Cabin One")).click());
    expect(container.querySelector("[aria-label='Reservation detail']").textContent).toContain("This reservation is terminal; create a new reservation to re-book.");
  });

  it("O-22: your own team card says another owner must edit your role", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (url.endsWith("/api/rental/team/audit")) return response({ audit: [] });
      if (options?.method === "PATCH") return response({ success: true, member: null });
      return response({ members: [{ id: "m_self", memberUserId: "viewer_1", email: "me@example.test", role: "co_owner", status: "active", permissionOverrides: {} }], viewerId: "viewer_1", permissionCatalog: [] });
    }));
    const container = mount(<RentalTeamPanel />);
    await flush();
    expect(container.textContent).toContain("Another owner must edit your role.");
  });

  it("O-25: a verified in-force policy points at recording replacement proof", async () => {
    const verified = { id: "pol_v", carrier_name: "Acme", policy_number_masked: "POL-1",
      liability_limit_cents: 100000, effective_date: "2026-01-01", expiration_date: "2027-01-01",
      status: "verified", evidence_id: "drawer A", verified_at: "2026-01-05T00:00:00Z" };
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      if (options.method === "POST") return response({ success: true });
      if (String(url) === "/api/rental") return response({ leases: [{ id: "lease_1", status: "active", unit_id: "unit_1" }], units: [{ id: "unit_1", label: "Unit A" }] });
      return response({ policies: [verified] });
    }));
    const container = mount(<RentalInsurancePanel initialPolicies={[verified]} />);
    await flush();
    expect(container.textContent).toContain("This policy is verified. To replace it, record new proof above.");
  });
});
