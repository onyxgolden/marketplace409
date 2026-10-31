import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalLeasePanel, { leaseBalanceText, formatShortDate } from "./RentalLeasePanel";
import { leaseBalanceCents } from "../../../application/rental/leaseBalance";
import { buildTenantPaymentLedger } from "../../../application/rental/tenantPaymentLedger";

// Barnhill, corrected 2026-10-31: $1,850/mo ($1,800 rent + $50 pet fee).
// October proration (Oct 13–31, 19 of 31 days): $1,850 × 19/31 = $1,133.87.
// $1,800 cash applied to it leaves a $666.13 credit; November's $1,850 charge
// less that credit = $1,183.87 due.
const LEASE_ID = "lease_barnhill";
const OCT_PRORATION = { id: "c_oct", lease_id: LEASE_ID, status: "due", amount_cents: 113387, paid_amount_cents: 0, charge_type: "proration", due_date: "2026-10-31" };
const NOV_CHARGE = { id: "c_nov", lease_id: LEASE_ID, status: "due", amount_cents: 185000, paid_amount_cents: 66613, charge_type: "rent", due_date: "2026-11-01" };

// Ledger-builder balance for one lease: sum the builder's own entry effects
// filtered to the lease. If this helper ever diverges from that sum on a
// fixture, the helper is wrong — the builder is the definition.
function ledgerBalanceForLease({ charges, payments, credits = [], creditApplications = [] }) {
  const ledger = buildTenantPaymentLedger({
    tenantId: "tenant_1",
    charges,
    payments,
    settlements: [],
    leases: [{ id: LEASE_ID, unit_id: "unit_barnhill" }],
    leaseMemberships: [{ tenant_id: "tenant_1", lease_id: LEASE_ID }],
    units: [{ id: "unit_barnhill", property_id: "4225-barnhill", label: "4225 Barnhill" }],
    rentecImports: [],
    credits,
    creditApplications,
  });
  return ledger.entries
    .filter((entry) => entry.leaseId === LEASE_ID)
    .reduce((sum, entry) => sum + entry.balanceEffectCents, 0);
}

function expectMatchesLedger(fixture) {
  const helper = leaseBalanceCents(LEASE_ID, {
    openCharges: fixture.openCharges,
    credits: fixture.credits || [],
    payments: fixture.payments || [],
  });
  const ledger = ledgerBalanceForLease({
    charges: fixture.charges,
    payments: fixture.payments || [],
    credits: fixture.credits || [],
    creditApplications: fixture.creditApplications || [],
  });
  expect(helper).toBe(ledger);
  return helper;
}

const barnhillBase = {
  units: [{ id: "unit_barnhill", label: "4225 Barnhill", property_id: "4225-barnhill" }],
  tenants: [{ id: "tenant_1", display_name: "Steven Crabtree", email: "steven@example.com" }],
  leases: [{ id: LEASE_ID, unit_id: "unit_barnhill", property_id: "4225-barnhill", status: "active", monthly_rent_cents: 185000, rent_due_day: 1, start_date: "2026-10-13", end_date: "2027-11-01" }],
  schedules: [{ id: "schedule_1", lease_id: LEASE_ID, status: "active" }],
  leaseMemberships: [{ lease_id: LEASE_ID, tenant_id: "tenant_1", occupancy_role: "primary" }],
};

describe("leaseBalanceCents", () => {
  it("is zero with no charges, payments, or credits", () => {
    expect(leaseBalanceCents(LEASE_ID, { openCharges: [], credits: [], payments: [] })).toBe(0);
  });

  it("Barnhill step 1: only the October proration charge open shows $1,133.87 due", () => {
    const balance = expectMatchesLedger({
      openCharges: [OCT_PRORATION],
      charges: [{ ...OCT_PRORATION, paid_amount_cents: 0 }],
    });
    expect(balance).toBe(113387);
  });

  it("Barnhill step 2: October paid in full with $666.13 unapplied credit shows a credit", () => {
    const balance = expectMatchesLedger({
      openCharges: [],
      charges: [{ ...OCT_PRORATION, status: "paid", paid_amount_cents: 113387 }],
      payments: [{ id: "p_oct", lease_id: LEASE_ID, tenant_id: "tenant_1", amount_cents: 180000, refunded_amount_cents: 0, status: "succeeded", payment_method: "cash" }],
      credits: [{ id: "cr_1", lease_id: LEASE_ID, tenant_id: "tenant_1", amount_cents: 66613, remaining_cents: 66613, status: "active" }],
    });
    expect(balance).toBe(-66613);
  });

  it("Barnhill step 3: November $1,850 charge less the $666.13 applied credit shows $1,183.87 due", () => {
    const balance = expectMatchesLedger({
      openCharges: [NOV_CHARGE],
      charges: [
        { ...OCT_PRORATION, status: "paid", paid_amount_cents: 113387 },
        { ...NOV_CHARGE },
      ],
      payments: [{ id: "p_oct", lease_id: LEASE_ID, tenant_id: "tenant_1", amount_cents: 180000, refunded_amount_cents: 0, status: "succeeded", payment_method: "cash" }],
      credits: [{ id: "cr_1", lease_id: LEASE_ID, tenant_id: "tenant_1", amount_cents: 66613, remaining_cents: 0, status: "active" }],
      creditApplications: [{ id: "ca_1", credit_id: "cr_1", lease_id: LEASE_ID, tenant_id: "tenant_1", charge_id: "c_nov", amount_cents: 66613 }],
    });
    expect(balance).toBe(118387);
  });

  it("matches the ledger on a partial payment", () => {
    const balance = expectMatchesLedger({
      openCharges: [{ id: "c_1", lease_id: LEASE_ID, status: "partially_paid", amount_cents: 100000, paid_amount_cents: 60000, charge_type: "rent", due_date: "2026-11-01" }],
      charges: [{ id: "c_1", lease_id: LEASE_ID, status: "partially_paid", amount_cents: 100000, paid_amount_cents: 60000, charge_type: "rent", due_date: "2026-11-01" }],
      payments: [{ id: "p_1", lease_id: LEASE_ID, tenant_id: "tenant_1", amount_cents: 60000, refunded_amount_cents: 0, status: "succeeded" }],
    });
    expect(balance).toBe(40000);
  });

  it("adds a refund back, including on a fully-paid charge", () => {
    const balance = expectMatchesLedger({
      openCharges: [],
      charges: [{ id: "c_1", lease_id: LEASE_ID, status: "paid", amount_cents: 100000, paid_amount_cents: 100000, charge_type: "rent", due_date: "2026-11-01" }],
      payments: [{ id: "p_1", lease_id: LEASE_ID, tenant_id: "tenant_1", amount_cents: 100000, refunded_amount_cents: 20000, status: "refunded" }],
    });
    expect(balance).toBe(20000);
  });

  it("deduplicates duplicate provider rows for the refund term like the ledger", () => {
    const balance = expectMatchesLedger({
      openCharges: [{ id: "c_1", lease_id: LEASE_ID, status: "partially_paid", amount_cents: 100000, paid_amount_cents: 60000, charge_type: "rent", due_date: "2026-11-01" }],
      charges: [{ id: "c_1", lease_id: LEASE_ID, status: "partially_paid", amount_cents: 100000, paid_amount_cents: 60000, charge_type: "rent", due_date: "2026-11-01" }],
      payments: [
        { id: "p_dup_1", lease_id: LEASE_ID, tenant_id: "tenant_1", provider: "stripe", provider_payment_id: "pi_1", amount_cents: 60000, refunded_amount_cents: 0, status: "processing", created_at: "2026-10-01" },
        { id: "p_dup_2", lease_id: LEASE_ID, tenant_id: "tenant_1", provider: "stripe", provider_payment_id: "pi_1", amount_cents: 60000, refunded_amount_cents: 10000, status: "partially_refunded", created_at: "2026-10-02" },
      ],
    });
    expect(balance).toBe(50000);
  });

  it("ignores void credits and void charges — a voided charge never reads as owed", () => {
    expect(leaseBalanceCents(LEASE_ID, {
      openCharges: [{ id: "c_void", lease_id: LEASE_ID, status: "void", amount_cents: 50000, paid_amount_cents: 0 }],
      credits: [{ id: "cr_void", lease_id: LEASE_ID, remaining_cents: 70000, status: "void" }],
      payments: [],
    })).toBe(0);
  });

  it("ignores other leases' charges and credits", () => {
    expect(leaseBalanceCents(LEASE_ID, {
      openCharges: [{ id: "c_other", lease_id: "lease_other", status: "due", amount_cents: 99900, paid_amount_cents: 0 }],
      credits: [{ id: "cr_other", lease_id: "lease_other", remaining_cents: 5000, status: "active" }],
      payments: [],
    })).toBe(0);
  });
});

describe("leaseBalanceText", () => {
  it("says due for a positive balance, credit for a negative one, and never $0.00 due", () => {
    expect(leaseBalanceText(118387)).toBe("$1,183.87 due");
    expect(leaseBalanceText(-66613)).toBe("$666.13 credit");
    expect(leaseBalanceText(0)).toBe("No balance due");
    expect(leaseBalanceText(null)).toBe(null);
  });
  it("formats dates without timezone drift", () => {
    expect(formatShortDate("2026-10-13")).toBe("Oct 13, 2026");
    expect(formatShortDate("not-a-date")).toBe(null);
  });
});

describe("RentalLeasePanel balance display", () => {
  it("list row shows $1,183.87 due for the Barnhill November state", () => {
    const setup = { ...barnhillBase, openCharges: [NOV_CHARGE], credits: [{ id: "cr_1", lease_id: LEASE_ID, remaining_cents: 0, status: "active" }], payments: [] };
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={setup} loadOnMount={false} />);
    expect(markup).toContain("active");
    expect(markup).toContain("$1,850.00 monthly");
    expect(markup).toContain("$1,183.87 due");
  });

  it("list row shows $1,133.87 due when only the October proration charge is open", () => {
    const setup = { ...barnhillBase, openCharges: [OCT_PRORATION], credits: [], payments: [] };
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={setup} loadOnMount={false} />);
    expect(markup).toContain("$1,133.87 due");
  });

  it("list row shows No balance due at zero and a credit when the tenant holds one", () => {
    const zeroSetup = { ...barnhillBase, openCharges: [], credits: [], payments: [] };
    expect(renderToStaticMarkup(<RentalLeasePanel initialSetup={zeroSetup} loadOnMount={false} />)).toContain("No balance due");
    const creditSetup = { ...barnhillBase, openCharges: [], credits: [{ id: "cr_1", lease_id: LEASE_ID, remaining_cents: 66613, status: "active" }], payments: [] };
    expect(renderToStaticMarkup(<RentalLeasePanel initialSetup={creditSetup} loadOnMount={false} />)).toContain("$666.13 credit");
  });

  it("detail shows balance plus due day plus start date", () => {
    const setup = { ...barnhillBase, openCharges: [NOV_CHARGE], credits: [{ id: "cr_1", lease_id: LEASE_ID, remaining_cents: 0, status: "active" }], payments: [] };
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={setup} loadOnMount={false} />);
    expect(markup).toContain("Rent due on the 1st");
    expect(markup).toContain("Since Oct 13, 2026");
    expect(markup).toContain("Balance: $1,183.87 due");
  });

  it("detail shows No balance due for a lease with no charges", () => {
    const setup = { ...barnhillBase, openCharges: [], credits: [], payments: [] };
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={setup} loadOnMount={false} />);
    expect(markup).toContain("Balance: No balance due");
  });
});
