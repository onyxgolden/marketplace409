import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({
  getActiveWorkspaceRole: vi.fn(async () => null),
}));
vi.mock("@/lib/supabase/isOwnerOrActiveCoOwner", () => ({
  isOwnerOrActiveCoOwner: vi.fn(async () => true),
}));

// Scripted supabase client: the lease lookup and the lease update both hit
// rental_leases; the update() call distinguishes them. The schedules update
// is awaited as a thenable resolving to the ended schedule rows.
function scriptedClient(script) {
  const calls = [];
  function query(table) {
    const q = {
      table,
      _updated: false,
      select() { return q; },
      eq() { return q; },
      update(values) { calls.push({ table, values }); q._updated = true; return q; },
      insert() { return q; },
      delete() { return q; },
      async maybeSingle() {
        if (table === "rental_leases" && !q._updated) return { data: script.leaseLookup ?? null, error: null };
        if (table === "rental_leases" && q._updated) return { data: script.leaseUpdate ?? null, error: null };
        return { data: null, error: null };
      },
      async single() { return { data: null, error: null }; },
      then(resolve) { resolve({ data: script.scheduleUpdate ?? [], error: null }); },
    };
    return q;
  }
  return { calls, client: { from: (table) => query(table), rpc: async () => ({ data: null, error: null }) } };
}

const application = {
  units: { findById: vi.fn(async () => null) },
  findUnitsByProperty: vi.fn(async () => []),
  saveUnit: vi.fn(async (value) => value),
  saveTenant: vi.fn(async (value) => value),
  saveLease: vi.fn(async (value) => value),
  saveSchedule: vi.fn(async (value) => value),
  generateMonthlyCharge: vi.fn(async () => null),
};

const mockedAuth = vi.hoisted(() => ({ current: null }));
const mockedStripe = vi.hoisted(() => ({ current: null }));

vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(async () => mockedAuth.current),
}));

vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({
  createStripeBillingProvider: vi.fn(() => mockedStripe.current),
}));

import { POST } from "./route.js";

function post(body) {
  return POST(new Request("http://localhost/api/rental", { method: "POST", body: JSON.stringify(body) }));
}

function authFor(script) {
  const { calls, client } = scriptedClient(script);
  mockedAuth.current = {
    application, user: { id: "owner_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  };
  return calls;
}

describe("end-lease (controls sweep B1)", () => {
  it("ends an active lease and ends its active schedules, leaving charges alone", async () => {
    const calls = authFor({
      leaseLookup: { id: "lease_1", status: "active" },
      leaseUpdate: { id: "lease_1", status: "ended", end_date: "2026-10-31" },
      scheduleUpdate: [{ id: "schedule_1" }, { id: "schedule_2" }],
    });
    const response = await post({ operation: "end-lease", leaseId: "lease_1", endDate: "2026-10-31", reason: "Move-out" });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.lease.status).toBe("ended");
    expect(json.schedulesEnded).toBe(2);
    const leaseUpdate = calls.find((call) => call.table === "rental_leases");
    expect(leaseUpdate.values.status).toBe("ended");
    expect(leaseUpdate.values.end_date).toBe("2026-10-31");
    expect(calls.find((call) => call.table === "rent_schedules").values.status).toBe("ended");
  });

  it("defaults the end date to today when omitted", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const calls = authFor({
      leaseLookup: { id: "lease_1", status: "active" },
      leaseUpdate: { id: "lease_1", status: "ended", end_date: today },
      scheduleUpdate: [],
    });
    const response = await post({ operation: "end-lease", leaseId: "lease_1" });
    expect(response.status).toBe(200);
    expect(calls.find((call) => call.table === "rental_leases").values.end_date).toBe(today);
  });

  it("refuses a draft lease with 409", async () => {
    authFor({ leaseLookup: { id: "lease_1", status: "draft" } });
    const response = await post({ operation: "end-lease", leaseId: "lease_1" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/active lease/);
  });

  it("returns 404 for a missing lease", async () => {
    authFor({ leaseLookup: null });
    const response = await post({ operation: "end-lease", leaseId: "lease_nope" });
    expect(response.status).toBe(404);
  });

  it("rejects a malformed end date with 400", async () => {
    authFor({ leaseLookup: { id: "lease_1", status: "active" } });
    const response = await post({ operation: "end-lease", leaseId: "lease_1", endDate: "10/31/2026" });
    expect(response.status).toBe(400);
  });
});

function paymentClient(script) {
  const calls = [];
  function query(table) {
    const q = {
      table,
      _updated: false,
      select() { return q; },
      eq() { return q; },
      update(values) { calls.push({ table, values }); q._updated = true; return q; },
      insert() { return q; },
      delete() { return q; },
      async maybeSingle() {
        if (table === "rental_payments" && !q._updated) return { data: script.payment ?? null, error: null };
        if (table === "rental_payments" && q._updated) return { data: script.paymentUpdate ?? null, error: null };
        if (table === "landlord_payment_accounts") return { data: script.account ?? null, error: null };
        return { data: null, error: null };
      },
    };
    return q;
  }
  return { calls, client: { from: (table) => query(table), rpc: async () => ({ data: null, error: null }) } };
}

function authForPayments(script) {
  const { calls, client } = paymentClient(script);
  mockedAuth.current = {
    application, user: { id: "owner_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  };
  return calls;
}

describe("void-payment (controls sweep B2)", () => {
  it("voids a settled offline payment into the refunded state with the reason noted", async () => {
    const calls = authForPayments({
      payment: { id: "pay_1", provider: "offline", status: "succeeded", amount_cents: 130000, deposit_state: "received", notes: null },
      paymentUpdate: { id: "pay_1", status: "refunded", amount_cents: 130000, refunded_amount_cents: 130000 },
    });
    const response = await post({ operation: "void-payment", paymentId: "pay_1", reason: "Wrong amount entered", ownerConfirmed: true });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.payment.status).toBe("refunded");
    const update = calls.find((call) => call.table === "rental_payments");
    expect(update.values.status).toBe("refunded");
    expect(update.values.refunded_amount_cents).toBe(130000);
    expect(update.values.notes).toContain("Voided: Wrong amount entered");
  });

  it("refuses a Stripe payment with 409", async () => {
    authForPayments({ payment: { id: "pay_2", provider: "stripe", status: "succeeded", amount_cents: 130000, deposit_state: null } });
    const response = await post({ operation: "void-payment", paymentId: "pay_2", reason: "x", ownerConfirmed: true });
    expect(response.status).toBe(409);
  });

  it("refuses a deposited payment with 409 and the unlock step", async () => {
    authForPayments({ payment: { id: "pay_1", provider: "offline", status: "succeeded", amount_cents: 130000, deposit_state: "deposited" } });
    const response = await post({ operation: "void-payment", paymentId: "pay_1", reason: "x", ownerConfirmed: true });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/awaiting deposit/);
  });

  it("refuses an already refunded payment with 409", async () => {
    authForPayments({ payment: { id: "pay_1", provider: "offline", status: "refunded", amount_cents: 130000, deposit_state: "received" } });
    const response = await post({ operation: "void-payment", paymentId: "pay_1", reason: "x", ownerConfirmed: true });
    expect(response.status).toBe(409);
  });

  it("returns 404 for a missing payment and 400 without reason or confirmation", async () => {
    authForPayments({ payment: null });
    expect((await post({ operation: "void-payment", paymentId: "pay_nope", reason: "x", ownerConfirmed: true })).status).toBe(404);
    authForPayments({ payment: { id: "pay_1", provider: "offline", status: "succeeded", amount_cents: 130000, deposit_state: "received" } });
    expect((await post({ operation: "void-payment", paymentId: "pay_1", ownerConfirmed: true })).status).toBe(400);
    expect((await post({ operation: "void-payment", paymentId: "pay_1", reason: "x" })).status).toBe(400);
  });
});

describe("refund-payment (controls sweep B2)", () => {
  it("refunds the full remaining amount through Stripe and marks the row refunded", async () => {
    const createRefund = vi.fn(async () => ({ refundId: "re_1", status: "succeeded" }));
    mockedStripe.current = { createRefund };
    const calls = authForPayments({
      payment: { id: "pay_2", provider: "stripe", provider_mode: "test", provider_payment_id: "pi_1", amount_cents: 130000, refunded_amount_cents: 50000, status: "partially_refunded" },
      account: { provider_account_id: "acct_1" },
      paymentUpdate: { id: "pay_2", status: "refunded", amount_cents: 130000, refunded_amount_cents: 130000 },
    });
    const response = await post({ operation: "refund-payment", paymentId: "pay_2", ownerConfirmed: true });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.payment.status).toBe("refunded");
    expect(createRefund).toHaveBeenCalledWith({ connectedAccountId: "acct_1" },
      { paymentIntentId: "pi_1", paymentId: "pay_2", amountCents: 80000 }, "refund:pay_2:80000");
    const update = calls.find((call) => call.table === "rental_payments");
    expect(update.values.refunded_amount_cents).toBe(130000);
  });

  it("never calls Stripe for an offline payment, an unsettled payment, or a missing account", async () => {
    const createRefund = vi.fn(async () => ({ refundId: "re_1", status: "succeeded" }));
    mockedStripe.current = { createRefund };
    authForPayments({ payment: { id: "pay_1", provider: "offline", status: "succeeded", amount_cents: 130000 } });
    expect((await post({ operation: "refund-payment", paymentId: "pay_1", ownerConfirmed: true })).status).toBe(409);
    authForPayments({ payment: { id: "pay_2", provider: "stripe", provider_mode: "test", provider_payment_id: "pi_1", amount_cents: 130000, refunded_amount_cents: 0, status: "processing" } });
    expect((await post({ operation: "refund-payment", paymentId: "pay_2", ownerConfirmed: true })).status).toBe(409);
    authForPayments({
      payment: { id: "pay_2", provider: "stripe", provider_mode: "test", provider_payment_id: "pi_1", amount_cents: 130000, refunded_amount_cents: 0, status: "succeeded" },
      account: null,
    });
    expect((await post({ operation: "refund-payment", paymentId: "pay_2", ownerConfirmed: true })).status).toBe(409);
    expect(createRefund).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing payment", async () => {
    mockedStripe.current = { createRefund: vi.fn() };
    authForPayments({ payment: null });
    expect((await post({ operation: "refund-payment", paymentId: "pay_nope", ownerConfirmed: true })).status).toBe(404);
  });
});

function autopayClient(script) {
  const calls = [];
  function query(table) {
    const q = {
      table,
      _updated: false,
      select() { return q; },
      eq() { return q; },
      in() { return q; },
      update(values) { calls.push({ table, values }); q._updated = true; return q; },
      async maybeSingle() {
        if (table === "rental_autopay_enrollments" && !q._updated) return { data: script.enrollment ?? null, error: null };
        if (table === "rental_autopay_enrollments" && q._updated) return { data: script.enrollmentUpdate ?? null, error: null };
        return { data: null, error: null };
      },
    };
    return q;
  }
  return { calls, client: { from: (table) => query(table), rpc: async () => ({ data: null, error: null }) } };
}

function authForAutopay(script) {
  const { calls, client } = autopayClient(script);
  mockedAuth.current = {
    application, user: { id: "owner_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  };
  return calls;
}

const activeEnrollment = { id: "enr_1", lease_id: "lease_1", tenant_id: "tenant_1", status: "active", payment_method_type: "us_bank_account", charge_day: 1, reminder_days_before: 3 };

describe("autopay controls (controls sweep B3)", () => {
  it("pauses an active enrollment and resumes a paused one (round-trip)", async () => {
    let calls = authForAutopay({ enrollment: activeEnrollment, enrollmentUpdate: { ...activeEnrollment, status: "paused" } });
    let response = await post({ operation: "pause-autopay", enrollmentId: "enr_1" });
    expect(response.status).toBe(200);
    expect((await response.json()).enrollment.status).toBe("paused");
    expect(calls.find((call) => call.table === "rental_autopay_enrollments").values.status).toBe("paused");

    calls = authForAutopay({ enrollment: { ...activeEnrollment, status: "paused" }, enrollmentUpdate: { ...activeEnrollment, status: "active" } });
    response = await post({ operation: "resume-autopay", enrollmentId: "enr_1" });
    expect(response.status).toBe(200);
    expect((await response.json()).enrollment.status).toBe("active");
  });

  it("refuses pause on a paused enrollment and resume on an active one", async () => {
    authForAutopay({ enrollment: { ...activeEnrollment, status: "paused" } });
    expect((await post({ operation: "pause-autopay", enrollmentId: "enr_1" })).status).toBe(409);
    authForAutopay({ enrollment: activeEnrollment });
    expect((await post({ operation: "resume-autopay", enrollmentId: "enr_1" })).status).toBe(409);
  });

  it("cancels a current enrollment with reason and confirmation", async () => {
    const calls = authForAutopay({ enrollment: activeEnrollment, enrollmentUpdate: { ...activeEnrollment, status: "cancelled" } });
    const response = await post({ operation: "cancel-autopay", enrollmentId: "enr_1", reason: "Tenant moved out", ownerConfirmed: true });
    expect(response.status).toBe(200);
    expect((await response.json()).enrollment.status).toBe("cancelled");
    const update = calls.find((call) => call.table === "rental_autopay_enrollments");
    expect(update.values.status).toBe("cancelled");
    expect(update.values.cancellation_reason).toBe("Tenant moved out");
  });

  it("refuses cancel without reason or confirmation, and on an already cancelled enrollment", async () => {
    authForAutopay({ enrollment: activeEnrollment });
    expect((await post({ operation: "cancel-autopay", enrollmentId: "enr_1", ownerConfirmed: true })).status).toBe(400);
    expect((await post({ operation: "cancel-autopay", enrollmentId: "enr_1", reason: "x" })).status).toBe(400);
    authForAutopay({ enrollment: { ...activeEnrollment, status: "cancelled" } });
    expect((await post({ operation: "cancel-autopay", enrollmentId: "enr_1", reason: "x", ownerConfirmed: true })).status).toBe(409);
  });

  it("edits charge day and reminder days, and rejects out-of-range values", async () => {
    const calls = authForAutopay({ enrollment: activeEnrollment, enrollmentUpdate: { ...activeEnrollment, charge_day: 15, reminder_days_before: 5 } });
    const response = await post({ operation: "update-autopay", enrollmentId: "enr_1", chargeDay: 15, reminderDaysBefore: 5 });
    expect(response.status).toBe(200);
    const update = calls.find((call) => call.table === "rental_autopay_enrollments");
    expect(update.values.charge_day).toBe(15);
    expect(update.values.reminder_days_before).toBe(5);
    authForAutopay({ enrollment: activeEnrollment });
    expect((await post({ operation: "update-autopay", enrollmentId: "enr_1", chargeDay: 29, reminderDaysBefore: 3 })).status).toBe(400);
    expect((await post({ operation: "update-autopay", enrollmentId: "enr_1", chargeDay: 1, reminderDaysBefore: 15 })).status).toBe(400);
  });

  it("returns 404 for a missing enrollment", async () => {
    authForAutopay({ enrollment: null });
    expect((await post({ operation: "pause-autopay", enrollmentId: "enr_nope" })).status).toBe(404);
    expect((await post({ operation: "update-autopay", enrollmentId: "enr_nope", chargeDay: 1, reminderDaysBefore: 3 })).status).toBe(404);
  });
});

function creditClient(script) {
  const calls = [];
  function query(table) {
    const q = {
      table,
      select() { return q; },
      eq() { return q; },
      insert(values) { calls.push({ table, values }); return q; },
      async maybeSingle() {
        if (table === "rental_tenants") return { data: script.tenant ?? null, error: null };
        return { data: null, error: null };
      },
      async single() {
        if (table === "rental_tenant_credits") return { data: script.creditInsert ?? null, error: null };
        return { data: null, error: null };
      },
      then(resolve) { resolve({ data: table === "rental_lease_tenants" ? (script.memberships ?? []) : [], error: null }); },
    };
    return q;
  }
  return { calls, client: { from: (table) => query(table), rpc: async () => ({ data: null, error: null }) } };
}

function authForCredit(script) {
  const { calls, client } = creditClient(script);
  mockedAuth.current = {
    application, user: { id: "owner_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  };
  return calls;
}

describe("create-tenant-credit (controls sweep B4)", () => {
  it("creates a manual credit on the tenant's single lease with the reason in notes", async () => {
    const calls = authForCredit({
      tenant: { id: "t1" },
      memberships: [{ lease_id: "lease_1" }],
      creditInsert: { id: "credit_new", tenant_id: "t1", lease_id: "lease_1", amount_cents: 5000, remaining_cents: 5000, source: "manual", status: "open" },
    });
    const response = await post({ operation: "create-tenant-credit", credit: { tenantId: "t1", amountCents: 5000, reason: "Goodwill concession", ownerConfirmed: true } });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.credit.source).toBe("manual");
    expect(json.credit.lease_id).toBe("lease_1");
    const insert = calls.find((call) => call.table === "rental_tenant_credits");
    expect(insert.values.source).toBe("manual");
    expect(insert.values.source_payment_id).toBeNull();
    expect(insert.values.notes).toContain("Goodwill concession");
  });

  it("uses an explicit lease when given and refuses a lease the tenant is not on", async () => {
    const calls = authForCredit({
      tenant: { id: "t1" },
      memberships: [{ lease_id: "lease_1" }, { lease_id: "lease_2" }],
      creditInsert: { id: "credit_new", tenant_id: "t1", lease_id: "lease_2", amount_cents: 5000, remaining_cents: 5000, source: "manual", status: "open" },
    });
    const response = await post({ operation: "create-tenant-credit", credit: { tenantId: "t1", leaseId: "lease_2", amountCents: 5000, reason: "Concession", ownerConfirmed: true } });
    expect(response.status).toBe(200);
    expect(calls.find((call) => call.table === "rental_tenant_credits").values.lease_id).toBe("lease_2");
    authForCredit({ tenant: { id: "t1" }, memberships: [{ lease_id: "lease_1" }] });
    expect((await post({ operation: "create-tenant-credit", credit: { tenantId: "t1", leaseId: "lease_9", amountCents: 5000, reason: "x", ownerConfirmed: true } })).status).toBe(409);
  });

  it("refuses an ambiguous lease and validates amount, reason, and confirmation", async () => {
    authForCredit({ tenant: { id: "t1" }, memberships: [{ lease_id: "lease_1" }, { lease_id: "lease_2" }] });
    expect((await post({ operation: "create-tenant-credit", credit: { tenantId: "t1", amountCents: 5000, reason: "x", ownerConfirmed: true } })).status).toBe(409);
    authForCredit({ tenant: { id: "t1" }, memberships: [] });
    expect((await post({ operation: "create-tenant-credit", credit: { tenantId: "t1", amountCents: 5000, reason: "x", ownerConfirmed: true } })).status).toBe(409);
    authForCredit({ tenant: { id: "t1" }, memberships: [{ lease_id: "lease_1" }] });
    expect((await post({ operation: "create-tenant-credit", credit: { tenantId: "t1", amountCents: 0, reason: "x", ownerConfirmed: true } })).status).toBe(400);
    expect((await post({ operation: "create-tenant-credit", credit: { tenantId: "t1", amountCents: 5000, ownerConfirmed: true } })).status).toBe(400);
    expect((await post({ operation: "create-tenant-credit", credit: { tenantId: "t1", amountCents: 5000, reason: "x" } })).status).toBe(400);
    authForCredit({ tenant: null, memberships: [] });
    expect((await post({ operation: "create-tenant-credit", credit: { tenantId: "t_nope", amountCents: 5000, reason: "x", ownerConfirmed: true } })).status).toBe(404);
  });
});

function g1Client(script) {
  const calls = [];
  function query(table) {
    const q = {
      table,
      select() { return q; },
      eq() { return q; },
      update(values) { calls.push({ table, values }); return q; },
      insert(values) { calls.push({ table, values }); return q; },
      delete() { calls.push({ table, values: null }); return q; },
      async maybeSingle() {
        if (table === "rental_leases") return { data: script.lease ?? null, error: null };
        if (table === "rental_tenants") return { data: script.tenant ?? null, error: null };
        if (table === "rental_lease_tenants") return { data: script.existing ?? null, error: null };
        if (table === "rental_lease_changes") {
          if (script.changeUpdate) return { data: script.changeUpdate, error: null };
          return { data: script.change ?? null, error: null };
        }
        if (table === "rental_lease_preparations") return { data: script.preparation ?? null, error: null };
        return { data: null, error: null };
      },
      async single() {
        if (table === "rental_lease_tenants") return { data: script.insert ?? null, error: null };
        if (table === "rental_lease_changes") return { data: script.changeInsert ?? null, error: null };
        if (table === "rental_late_fee_rules") return { data: script.ruleInsert ?? null, error: null };
        return { data: null, error: null };
      },
      then(resolve) {
        resolve({ data: table === "rental_lease_tenants" ? (script.memberships ?? []) : [], error: null });
      },
    };
    return q;
  }
  return { calls, client: { from: (table) => query(table), rpc: async () => ({ data: null, error: null }) } };
}

function authForG1(script) {
  const { calls, client } = g1Client(script);
  mockedAuth.current = {
    application, user: { id: "owner_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  };
  return calls;
}

const cancelledLease = { id: "lease_1", status: "cancelled" };
const activeLease = { id: "lease_1", status: "active" };

describe("cancelled-lease guards (controls sweep G1)", () => {
  it("refuses add/remove/make-primary on a cancelled lease, allows them on an active one", async () => {
    authForG1({ lease: cancelledLease });
    expect((await post({ operation: "add-co-tenant", leaseId: "lease_1", tenantId: "t2" })).status).toBe(409);
    expect((await post({ operation: "remove-co-tenant", leaseId: "lease_1", tenantId: "t2" })).status).toBe(409);
    expect((await post({ operation: "set-primary-tenant", leaseId: "lease_1", tenantId: "t2" })).status).toBe(409);
    authForG1({
      lease: activeLease,
      tenant: { id: "t2", display_name: "Two", email: "two@example.com" },
      existing: null,
      memberships: [{ tenant_id: "t1", occupancy_role: "primary" }],
      insert: { lease_id: "lease_1", tenant_id: "t2", occupancy_role: "co_tenant" },
    });
    expect((await post({ operation: "add-co-tenant", leaseId: "lease_1", tenantId: "t2" })).status).toBe(200);
    authForG1({ lease: activeLease, existing: { tenant_id: "t2", occupancy_role: "co_tenant" } });
    expect((await post({ operation: "remove-co-tenant", leaseId: "lease_1", tenantId: "t2" })).status).toBe(200);
    authForG1({ lease: activeLease });
    expect((await post({ operation: "set-primary-tenant", leaseId: "lease_1", tenantId: "t2" })).status).toBe(200);
  });

  it("refuses lease-change save and approval on a cancelled lease", async () => {
    authForG1({ lease: cancelledLease });
    expect((await post({ operation: "save-lease-change", change: { leaseId: "lease_1", changeType: "renewal", effectiveDate: "2026-12-01", reason: "Renew" } })).status).toBe(409);
    authForG1({ lease: cancelledLease, change: { id: "chg_1", lease_id: "lease_1" } });
    expect((await post({ operation: "approve-lease-change", changeId: "chg_1" })).status).toBe(409);
    authForG1({ lease: activeLease, changeInsert: { id: "chg_1", lease_id: "lease_1", status: "draft" } });
    expect((await post({ operation: "save-lease-change", change: { leaseId: "lease_1", changeType: "renewal", effectiveDate: "2026-12-01", reason: "Renew" } })).status).toBe(200);
  });

  it("refuses schedule saves and late-fee rules on a cancelled lease", async () => {
    authForG1({ lease: cancelledLease });
    expect((await post({ operation: "save-schedule", schedule: { leaseId: "lease_1", status: "active", amountCents: 180000, dueDay: 1, currencyCode: "USD", effectiveStartDate: "2026-10-01", earlyPayDays: 3 } })).status).toBe(409);
    expect((await post({ operation: "save-late-fee-rule", rule: { leaseId: "lease_1", jurisdictionCode: "TX", ruleSource: "Lease 4.2", graceDays: 3, calculationType: "fixed", fixedAmountCents: 5000, manualApprovalConfirmed: true } })).status).toBe(409);
    authForG1({ lease: activeLease, ruleInsert: { id: "rule_1", lease_id: "lease_1", status: "active" } });
    expect((await post({ operation: "save-late-fee-rule", rule: { leaseId: "lease_1", jurisdictionCode: "TX", ruleSource: "Lease 4.2", graceDays: 3, calculationType: "fixed", fixedAmountCents: 5000, manualApprovalConfirmed: true } })).status).toBe(200);
  });

  it("refuses preparation approval on a cancelled lease", async () => {
    authForG1({ lease: cancelledLease, preparation: { id: "prep_1", lease_id: "lease_1" } });
    expect((await post({ operation: "approve-lease-preparation-version", preparationId: "prep_1", versionNumber: 1, ownerApprovalConfirmed: true })).status).toBe(409);
    authForG1({ lease: activeLease, preparation: { id: "prep_1", lease_id: "lease_1" } });
    expect((await post({ operation: "approve-lease-preparation-version", preparationId: "prep_1", versionNumber: 1, ownerApprovalConfirmed: true })).status).toBe(200);
  });
});
