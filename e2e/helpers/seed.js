// Fixture seeding for the tenant-portal smoke suite.
//
// Runs ONLY against the scratch Supabase project named by the validated
// target config, with the service-role key. Every row it creates is prefixed
// with the run id, so teardown can sweep by prefix and a stale row is always
// attributable to the run that left it.
//
// Owner bootstrap (verified against the app at main 5c1c7a6): a primary
// owner is IMPLICIT — a fresh auth user with no workspace_members row
// resolves effectiveOwnerId to their own auth user id. Staff membership is
// an explicit workspace_members row. No production data is ever touched:
// the target gates in target.js refuse production hosts and the production
// Supabase project before this module is constructed.
import { createClient } from "@supabase/supabase-js";
import { makeRunId, syntheticEmail, syntheticId } from "./target.js";
import { passwordFor } from "./fixtures.js";

const MONEY = { rentCents: 185000, currency: "USD" };

function todayPlus(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function periodOf(dateStr) {
  return dateStr.slice(0, 7);
}

export function scratchClient(config) {
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createUser(admin, email, password, emailConfirm) {
  const { data, error } = await admin.createUser({ email, password, email_confirm: emailConfirm });
  if (error) throw new Error(`seed: createUser ${email} failed: ${error.message}`);
  return data.user;
}

async function insert(db, table, row) {
  const { data, error } = await db.from(table).insert(row).select("*").single();
  if (error) throw new Error(`seed: insert ${table} failed: ${error.message}`);
  return data;
}

// Seeds every fixture all three specs need, in FK-safe order. Returns the
// run state the specs read (ids, emails, passwords are per-run throwaways
// for the scratch project only — never real credentials, never committed:
// the state file is gitignored and the runner is ephemeral).
export async function seedRun(config) {
  const runId = makeRunId();
  const db = scratchClient(config);
  const admin = db.auth.admin;
  const state = { runId, owners: {}, users: {} };
  const trackUser = (key, user, password) => {
    state.users[key] = { id: user.id, email: user.email, password };
  };

  // ---- Owner A: pay flow (fee off; the fee test flips bps mid-run) ----
  const ownerAEmail = syntheticEmail(runId, "owner-pay");
  const ownerA = await createUser(admin, ownerAEmail, passwordFor(runId), true);
  trackUser("ownerPay", ownerA, passwordFor(runId));
  const ownerAId = ownerA.id;
  await insert(db, "rental_billing_settings", {
    owner_id: ownerAId, billing_enabled: true, payment_policy: "allow_any_amount", card_convenience_fee_bps: 0,
  });
  await insert(db, "landlord_payment_accounts", {
    owner_id: ownerAId, id: syntheticId(runId, "lpa", 1), provider: "stripe",
    provider_account_id: config.connectedAccountId, provider_mode: "test", status: "enabled",
    charges_enabled: true, payouts_enabled: true, card_payments_enabled: true,
  });
  const unitA = await insert(db, "rental_units", {
    owner_id: ownerAId, id: syntheticId(runId, "unit", 1), property_id: syntheticId(runId, "prop", 1),
    label: `Smoke Unit A ${runId}`, status: "occupied",
  });
  const tenantAEmail = syntheticEmail(runId, "tenant-pay");
  const tenantAUser = await createUser(admin, tenantAEmail, passwordFor(runId), true);
  trackUser("tenantPay", tenantAUser, passwordFor(runId));
  const tenantA = await insert(db, "rental_tenants", {
    owner_id: ownerAId, id: syntheticId(runId, "tenant", 1), display_name: `Smoke Tenant Pay ${runId}`,
    email: tenantAEmail, status: "active", auth_user_id: tenantAUser.id, activated_at: new Date().toISOString(),
  });
  const leaseA = await insert(db, "rental_leases", {
    owner_id: ownerAId, id: syntheticId(runId, "lease", 1), property_id: unitA.property_id, unit_id: unitA.id,
    status: "active", start_date: todayPlus(-60), end_date: null, monthly_rent_cents: MONEY.rentCents,
    currency_code: MONEY.currency, rent_due_day: 1,
  });
  await insert(db, "rental_lease_tenants", {
    owner_id: ownerAId, lease_id: leaseA.id, tenant_id: tenantA.id, occupancy_role: "primary",
  });
  const cutover = todayPlus(-30);
  const scheduleForge = await insert(db, "rent_schedules", {
    owner_id: ownerAId, id: syntheticId(runId, "sched", 1), lease_id: leaseA.id, status: "active",
    amount_cents: MONEY.rentCents, currency_code: MONEY.currency, due_day: 1,
    effective_start_date: todayPlus(-60), effective_end_date: null,
    collection_mode: "forge", forge_cutover_date: cutover,
  });
  const scheduleExternal = await insert(db, "rent_schedules", {
    owner_id: ownerAId, id: syntheticId(runId, "sched", 2), lease_id: leaseA.id, status: "active",
    amount_cents: MONEY.rentCents, currency_code: MONEY.currency, due_day: 1,
    effective_start_date: todayPlus(-60), effective_end_date: null, collection_mode: "external",
  });
  const dueToday = todayPlus(0);
  const chargePayable = await insert(db, "rent_charges", {
    owner_id: ownerAId, id: syntheticId(runId, "charge", 1), lease_id: leaseA.id, schedule_id: scheduleForge.id,
    period: periodOf(dueToday), due_date: dueToday, amount_cents: MONEY.rentCents, paid_amount_cents: 0,
    currency_code: MONEY.currency, status: "due", source_key: `smoke:${runId}:payable`, charge_type: "rent",
  });
  const chargeExternal = await insert(db, "rent_charges", {
    owner_id: ownerAId, id: syntheticId(runId, "charge", 2), lease_id: leaseA.id, schedule_id: scheduleExternal.id,
    period: periodOf(dueToday), due_date: dueToday, amount_cents: MONEY.rentCents, paid_amount_cents: 0,
    currency_code: MONEY.currency, status: "due", source_key: `smoke:${runId}:external`, charge_type: "rent",
  });
  const chargePaid = await insert(db, "rent_charges", {
    owner_id: ownerAId, id: syntheticId(runId, "charge", 3), lease_id: leaseA.id, schedule_id: scheduleForge.id,
    period: periodOf(todayPlus(-30)), due_date: todayPlus(-30), amount_cents: MONEY.rentCents,
    paid_amount_cents: MONEY.rentCents, currency_code: MONEY.currency, status: "paid",
    source_key: `smoke:${runId}:paid`, charge_type: "rent",
  });
  const chargeVoid = await insert(db, "rent_charges", {
    owner_id: ownerAId, id: syntheticId(runId, "charge", 4), lease_id: leaseA.id, schedule_id: scheduleForge.id,
    period: periodOf(todayPlus(-30)), due_date: todayPlus(-30), amount_cents: MONEY.rentCents, paid_amount_cents: 0,
    currency_code: MONEY.currency, status: "void", source_key: `smoke:${runId}:void`, charge_type: "rent",
    voided_at: new Date().toISOString(),
  });
  const chargeProcessing = await insert(db, "rent_charges", {
    owner_id: ownerAId, id: syntheticId(runId, "charge", 5), lease_id: leaseA.id, schedule_id: scheduleForge.id,
    period: periodOf(dueToday), due_date: dueToday, amount_cents: MONEY.rentCents, paid_amount_cents: 0,
    currency_code: MONEY.currency, status: "due", source_key: `smoke:${runId}:processing`, charge_type: "rent",
  });
  await insert(db, "rental_payments", {
    owner_id: ownerAId, id: syntheticId(runId, "pay", 1), charge_id: chargeProcessing.id, lease_id: leaseA.id,
    tenant_id: tenantA.id, provider: "stripe", provider_mode: "test", amount_cents: MONEY.rentCents,
    refunded_amount_cents: 0, convenience_fee_cents: 0, currency_code: MONEY.currency, status: "processing",
    idempotency_key: `smoke:${runId}:processing-payment`,
  });
  const chargeFee = await insert(db, "rent_charges", {
    owner_id: ownerAId, id: syntheticId(runId, "charge", 6), lease_id: leaseA.id, schedule_id: scheduleForge.id,
    period: periodOf(todayPlus(1)), due_date: todayPlus(1), amount_cents: MONEY.rentCents, paid_amount_cents: 0,
    currency_code: MONEY.currency, status: "due", source_key: `smoke:${runId}:fee`, charge_type: "rent",
  });
  state.owners.pay = {
    ownerId: ownerAId, unitId: unitA.id, unitLabel: unitA.label, tenantId: tenantA.id, leaseId: leaseA.id,
    scheduleForgeId: scheduleForge.id, scheduleExternalId: scheduleExternal.id,
    chargePayableId: chargePayable.id, chargeExternalId: chargeExternal.id,
    chargePaidId: chargePaid.id, chargeVoidId: chargeVoid.id, chargeProcessingId: chargeProcessing.id,
    chargeFeeId: chargeFee.id, rentCents: MONEY.rentCents, cutover, dueToday,
  };

  // ---- Owner B: invite + claim flows ----
  const ownerBEmail = syntheticEmail(runId, "owner-invite");
  const ownerB = await createUser(admin, ownerBEmail, passwordFor(runId), true);
  trackUser("ownerInvite", ownerB, passwordFor(runId));
  const ownerBId = ownerB.id;
  const unitB = await insert(db, "rental_units", {
    owner_id: ownerBId, id: syntheticId(runId, "unit", 2), property_id: syntheticId(runId, "prop", 2),
    label: `Smoke Unit B ${runId}`, status: "occupied",
  });
  const leaseB = await insert(db, "rental_leases", {
    owner_id: ownerBId, id: syntheticId(runId, "lease", 2), property_id: unitB.property_id, unit_id: unitB.id,
    status: "active", start_date: todayPlus(-60), end_date: null, monthly_rent_cents: MONEY.rentCents,
    currency_code: MONEY.currency, rent_due_day: 1,
  });
  // T-invite: uninvited; the UI send test flips this row (needs Resend in target).
  const tenantInvite = await insert(db, "rental_tenants", {
    owner_id: ownerBId, id: syntheticId(runId, "tenant", 2), display_name: `Smoke Tenant Invite ${runId}`,
    email: syntheticEmail(runId, "tenant-invite"), status: "inactive", auth_user_id: null, invited_at: null,
  });
  await insert(db, "rental_lease_tenants", {
    owner_id: ownerBId, lease_id: leaseB.id, tenant_id: tenantInvite.id, occupancy_role: "primary",
  });
  // T-claim: invited; the pre-confirmed user claims it on first portal load.
  const claimEmail = syntheticEmail(runId, "tenant-claim");
  const claimUser = await createUser(admin, claimEmail, passwordFor(runId), true);
  trackUser("tenantClaim", claimUser, passwordFor(runId));
  const tenantClaim = await insert(db, "rental_tenants", {
    owner_id: ownerBId, id: syntheticId(runId, "tenant", 3), display_name: `Smoke Tenant Claim ${runId}`,
    email: claimEmail, status: "invited", auth_user_id: null, invited_at: new Date().toISOString(),
  });
  await insert(db, "rental_lease_tenants", {
    owner_id: ownerBId, lease_id: leaseB.id, tenant_id: tenantClaim.id, occupancy_role: "co_tenant",
  });
  // T-signup: invited; the UI signup test creates its auth user (unconfirmed).
  const tenantSignup = await insert(db, "rental_tenants", {
    owner_id: ownerBId, id: syntheticId(runId, "tenant", 4), display_name: `Smoke Tenant Signup ${runId}`,
    email: syntheticEmail(runId, "tenant-signup"), status: "invited", auth_user_id: null,
    invited_at: new Date().toISOString(),
  });
  await insert(db, "rental_lease_tenants", {
    owner_id: ownerBId, lease_id: leaseB.id, tenant_id: tenantSignup.id, occupancy_role: "co_tenant",
  });
  // T-wrong: a confirmed user whose email matches NO tenant row.
  const wrongUser = await createUser(admin, syntheticEmail(runId, "tenant-wrong"), passwordFor(runId), true);
  trackUser("tenantWrong", wrongUser, passwordFor(runId));
  state.owners.invite = {
    ownerId: ownerBId, unitId: unitB.id, unitLabel: unitB.label, leaseId: leaseB.id,
    tenantInviteId: tenantInvite.id, tenantInviteEmail: tenantInvite.email,
    tenantClaimId: tenantClaim.id, tenantClaimEmail: tenantClaim.email,
    tenantSignupId: tenantSignup.id, tenantSignupEmail: tenantSignup.email,
  };

  // ---- Owner C: duplicate-email match (same email invited under two owners) ----
  const ownerCEmail = syntheticEmail(runId, "owner-dup");
  const ownerC = await createUser(admin, ownerCEmail, passwordFor(runId), true);
  trackUser("ownerDup", ownerC, passwordFor(runId));
  const ownerCId = ownerC.id;
  const unitC = await insert(db, "rental_units", {
    owner_id: ownerCId, id: syntheticId(runId, "unit", 3), property_id: syntheticId(runId, "prop", 3),
    label: `Smoke Unit C ${runId}`, status: "occupied",
  });
  const leaseC = await insert(db, "rental_leases", {
    owner_id: ownerCId, id: syntheticId(runId, "lease", 3), property_id: unitC.property_id, unit_id: unitC.id,
    status: "active", start_date: todayPlus(-60), end_date: null, monthly_rent_cents: MONEY.rentCents,
    currency_code: MONEY.currency, rent_due_day: 1,
  });
  const tenantDup = await insert(db, "rental_tenants", {
    owner_id: ownerCId, id: syntheticId(runId, "tenant", 5), display_name: `Smoke Tenant Dup ${runId}`,
    email: claimEmail, status: "invited", auth_user_id: null, invited_at: new Date().toISOString(),
  });
  await insert(db, "rental_lease_tenants", {
    owner_id: ownerCId, lease_id: leaseC.id, tenant_id: tenantDup.id, occupancy_role: "primary",
  });
  state.owners.dup = { ownerId: ownerCId, tenantDupId: tenantDup.id, leaseId: leaseC.id };

  // ---- Owner D: lease creation + read-only member ----
  const ownerDEmail = syntheticEmail(runId, "owner-lease");
  const ownerD = await createUser(admin, ownerDEmail, passwordFor(runId), true);
  trackUser("ownerLease", ownerD, passwordFor(runId));
  const ownerDId = ownerD.id;
  const unitD = await insert(db, "rental_units", {
    owner_id: ownerDId, id: syntheticId(runId, "unit", 4), property_id: syntheticId(runId, "prop", 4),
    label: `Smoke Unit D ${runId}`, status: "available",
  });
  const leaseTenant1 = await insert(db, "rental_tenants", {
    owner_id: ownerDId, id: syntheticId(runId, "tenant", 6), display_name: `Smoke Lease Tenant One ${runId}`,
    email: syntheticEmail(runId, "lease-tenant-one"), status: "inactive", auth_user_id: null,
  });
  const leaseTenant2 = await insert(db, "rental_tenants", {
    owner_id: ownerDId, id: syntheticId(runId, "tenant", 7), display_name: `Smoke Lease Tenant Two ${runId}`,
    email: syntheticEmail(runId, "lease-tenant-two"), status: "inactive", auth_user_id: null,
  });
  // Pre-existing primary-less lease: one co_tenant membership, no primary.
  const leaseNoPrimary = await insert(db, "rental_leases", {
    owner_id: ownerDId, id: syntheticId(runId, "lease", 4), property_id: unitD.property_id, unit_id: unitD.id,
    status: "draft", start_date: todayPlus(-30), end_date: null, monthly_rent_cents: MONEY.rentCents,
    currency_code: MONEY.currency, rent_due_day: 1,
  });
  await insert(db, "rental_lease_tenants", {
    owner_id: ownerDId, lease_id: leaseNoPrimary.id, tenant_id: leaseTenant1.id, occupancy_role: "co_tenant",
  });
  const readonlyUser = await createUser(admin, syntheticEmail(runId, "readonly"), passwordFor(runId), true);
  trackUser("readonlyMember", readonlyUser, passwordFor(runId));
  await insert(db, "workspace_members", {
    owner_id: ownerDId, id: syntheticId(runId, "member", 1), member_user_id: readonlyUser.id,
    role: "read_only", status: "active", invited_email: readonlyUser.email, invited_by: ownerD.id,
    activated_at: new Date().toISOString(),
  });
  state.owners.lease = {
    ownerId: ownerDId, unitId: unitD.id, unitLabel: unitD.label,
    tenantOneId: leaseTenant1.id, tenantOneName: leaseTenant1.display_name,
    tenantTwoId: leaseTenant2.id, tenantTwoName: leaseTenant2.display_name,
    leaseNoPrimaryId: leaseNoPrimary.id, readonlyUserId: readonlyUser.id,
  };

  return state;
}

// Reads for assertions (service role, scratch only).
export async function readRow(db, table, match) {
  let query = db.from(table).select("*");
  for (const [key, value] of Object.entries(match)) query = query.eq(key, value);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`seed read ${table} failed: ${error.message}`);
  return data;
}

export async function updateBillingFeeBps(db, ownerId, bps) {
  const { error } = await db.from("rental_billing_settings")
    .update({ card_convenience_fee_bps: bps }).eq("owner_id", ownerId);
  if (error) throw new Error(`seed: update billing fee failed: ${error.message}`);
}

// Teardown: deletes every seeded row in FK-safe order, then the auth users.
// Throws when anything seeded remains — a run that leaves synthetic rows
// behind is a failed run, even if every assertion passed.
export async function teardownRun(config, state) {
  const db = scratchClient(config);
  const admin = db.auth.admin;
  const runPrefix = `e2e_${state.runId.replaceAll("-", "_")}_`;
  const errors = [];
  const del = async (table, match, label) => {
    let query = db.from(table).delete();
    for (const [key, value] of Object.entries(match)) query = query.eq(key, value);
    const { error } = await query;
    if (error) errors.push(`${label}: ${error.message}`);
  };
  const { owners } = state;
  // Payments first (FK to charges/leases/tenants), then app-created side
  // rows (customer references, receipt queue, webhook ledger), then charges,
  // schedules, memberships, leases, tenants, units, billing, accounts.
  if (owners.pay) {
    await del("rental_payments", { owner_id: owners.pay.ownerId }, "pay payments");
    await del("billing_customer_references", { owner_id: owners.pay.ownerId }, "pay customers");
    await del("rental_tenant_receipt_deliveries", { owner_id: owners.pay.ownerId }, "pay receipts");
    {
      const { error } = await db.from("payment_webhook_events").delete()
        .like("provider_event_id", `evt_e2e_${state.runId}%`);
      if (error) errors.push(`pay webhook events: ${error.message}`);
    }
    // Delete charges by owner, not by seeded id: the pay spec creates the
    // resume charge mid-run, and an id list would leak it silently.
    await del("rent_charges", { owner_id: owners.pay.ownerId }, "pay charges");
    await del("rent_schedules", { owner_id: owners.pay.ownerId }, "pay schedules");
    await del("rental_lease_tenants", { owner_id: owners.pay.ownerId }, "pay memberships");
    await del("rental_leases", { owner_id: owners.pay.ownerId }, "pay leases");
    await del("rental_tenants", { owner_id: owners.pay.ownerId }, "pay tenants");
    await del("rental_units", { owner_id: owners.pay.ownerId }, "pay units");
    await del("rental_billing_settings", { owner_id: owners.pay.ownerId }, "pay billing");
    await del("landlord_payment_accounts", { owner_id: owners.pay.ownerId }, "pay accounts");
  }
  for (const key of ["invite", "dup", "lease"]) {
    const o = owners[key];
    if (!o) continue;
    // FK-safe: charges and deposits reference schedules/leases, schedules
    // reference leases. The lease-create flow adds a schedule and a deposit
    // mid-run, so these deletes must cover rows the seed did not create.
    await del("rent_charges", { owner_id: o.ownerId }, `${key} charges`);
    await del("rental_security_deposits", { owner_id: o.ownerId }, `${key} deposits`);
    await del("rent_schedules", { owner_id: o.ownerId }, `${key} schedules`);
    await del("rental_lease_tenants", { owner_id: o.ownerId }, `${key} memberships`);
    await del("rental_leases", { owner_id: o.ownerId }, `${key} leases`);
    await del("rental_tenants", { owner_id: o.ownerId }, `${key} tenants`);
    if (o.unitId) await del("rental_units", { owner_id: o.ownerId }, `${key} units`);
    if (key === "lease") await del("workspace_members", { owner_id: o.ownerId }, "lease members");
  }
  for (const [key, user] of Object.entries(state.users)) {
    const { error } = await admin.deleteUser(user.id);
    if (error) errors.push(`user ${key}: ${error.message}`);
  }
  // Sweep auth users by the synthetic email domain: the unconfirmed-signup
  // test creates an auth user at runtime that run state never recorded.
  // A scratch project holds only synthetic users, so this cannot touch a
  // real account — and the production-host gate already refused those.
  {
    let page = 1;
    for (;;) {
      const { data, error } = await admin.listUsers({ page, perPage: 1000 });
      if (error) { errors.push(`user sweep: ${error.message}`); break; }
      const users = data?.users || [];
      for (const u of users) {
        if (u.email && u.email.endsWith("@e2e.invalid")) {
          const { error: delError } = await admin.deleteUser(u.id);
          if (delError) errors.push(`user sweep ${u.email}: ${delError.message}`);
        }
      }
      if (users.length < 1000) break;
      page += 1;
    }
  }
  // Sweep check: no seeded row may survive, by id prefix and email pattern.
  const { data: leftoverTenants, error: sweepError } = await db.from("rental_tenants")
    .select("id").like("id", `${runPrefix}%`).limit(1);
  if (sweepError) errors.push(`sweep: ${sweepError.message}`);
  else if (leftoverTenants && leftoverTenants.length > 0) errors.push(`sweep: ${leftoverTenants.length} seeded tenant rows remain`);
  if (errors.length > 0) throw new Error(`teardown incomplete: ${errors.join("; ")}`);
}
