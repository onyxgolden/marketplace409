// Real-infrastructure integration proof for the rental payment chain:
//   Stripe webhook event -> POST /api/rental/stripe-webhook (real route, real signature
//   verification) -> process_stripe_rental_payment_event (RPC, SECURITY INVOKER, real
//   service_role table access) -> rent_charges/financial_events, as seen by the owner under real
//   RLS. Same webhook boundary as stripePaymentChain.integration.test.js (private financing) --
//   this file is the rental follow-up documented in
//   docs/financial/payment-chain-production-verification.md's "Follow-up plan" section.
//
// Run against a local Supabase stack (Postgres + GoTrue + PostgREST) via Docker -- never against
// the real, hosted project. Mirrors stripePaymentChain.integration.test.js's pattern: real
// synthetic users, real signInWithPassword sessions, real authenticated-role RLS/RPC calls --
// never the postgres superuser role, never the service_role key, for any assertion about what an
// owner/stranger can or cannot do. The one exception, matching how the real webhook route itself
// works (it authenticates as service_role, see createRentalWebhookClient), is seeding
// rent_charges/rental_payments/rental_autopay_enrollments fixture rows: the app has no bare
// end-user insert path for these (they're created by lease setup / rent-charge generation /
// autopay-enrollment flows this proof doesn't need to exercise), so they're seeded via the real
// Postgres superuser through psql, never a JS client -- matching the private-financing proof's own
// documented convention for the same class of fixture.
//
// No real Stripe network call is made anywhere in this file. `payment_intent.*`, `refund.updated`,
// and `charge.dispute.*` events never reach a Stripe network method in route.js's own branching.
// `charge.succeeded` and `payout.paid` do (for settlement/payout reconciliation), so those two
// scenarios substitute a deterministic fake for exactly the three provider methods they reach
// (retrieveCharge, retrieveBalanceTransaction, listPayoutBalanceTransactionIds) via vi.doMock +
// vi.importActual, keeping real signature verification and the real RPC/ledger path -- same
// technique as the private-financing proof's fee-credit scenario. Every event's *signature* is
// still real: signed locally with the official `stripe` SDK's test-signing helper and verified for
// real by route.js's own `constructWebhookEvent`.
//
// Requires a local Supabase stack reachable at 127.0.0.1:54321/54322 (e.g. `supabase start` from
// any worktree of this repo). Self-skips (not fails) when that stack isn't reachable.
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { POST } from "../../../app/api/rental/stripe-webhook/route.js";
import {
  LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, TEST_PASSWORD,
  psql, isLocalStackReachable, signInFreshClient, signedRequest, installFakeStripeEnv,
} from "../../../test-helpers/stripeWebhookIntegrationTestHelpers.js";

const reachable = await isLocalStackReachable();

describe.skipIf(!reachable)("Rental Stripe payment chain (real local Supabase, real webhook route, real signature verification)", () => {
  const admin = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomUUID().slice(0, 8);
  const connectedAccountId = `acct_test_${suffix}`;
  const leaseId = `lease_${suffix}`;
  const scheduleId = `sched_${suffix}`;
  const tenantId = `tenant_${suffix}`;
  const unitId = `unit_${suffix}`;
  const propertyId = `property_${suffix}`;

  let owner;
  let stranger;
  let ownerClient;
  let strangerClient;

  beforeAll(async () => {
    if (!reachable) return;

    installFakeStripeEnv();

    const createUser = async (email) => {
      const { data, error } = await admin.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
      if (error) throw new Error(`Failed to create test user ${email}: ${error.message}`);
      return data.user;
    };
    [owner, stranger] = await Promise.all([
      createUser(`owner-${suffix}@x.test`),
      createUser(`stranger-${suffix}@x.test`),
    ]);

    // Minimal fixture graph: landlord Stripe account -> unit -> lease -> tenant -> a `forge`
    // (FORGE-collected, not externally-managed) rent schedule. No rental_properties table exists
    // in this schema (confirmed while building this proof) -- rental_units.property_id and
    // rental_leases.property_id carry no foreign-key constraint at all, so a synthetic id string
    // is sufficient, not a shortcut around missing referential integrity.
    psql(`
      insert into landlord_payment_accounts (owner_id, id, provider, provider_mode, provider_account_id, status, details_submitted, charges_enabled, payouts_enabled, ach_debit_enabled, card_payments_enabled)
      values ('${owner.id}', 'lpa_${suffix}', 'stripe', 'test', '${connectedAccountId}', 'enabled', true, true, true, true, true);
      insert into rental_units (owner_id, id, property_id, label, status)
      values ('${owner.id}', '${unitId}', '${propertyId}', 'Test Unit', 'occupied');
      insert into rental_leases (owner_id, id, property_id, unit_id, status, start_date, monthly_rent_cents, currency_code, rent_due_day)
      values ('${owner.id}', '${leaseId}', '${propertyId}', '${unitId}', 'active', '2026-01-01', 100000, 'USD', 1);
      insert into rental_tenants (owner_id, id, display_name, email, status)
      values ('${owner.id}', '${tenantId}', 'Test Tenant', 'tenant-${suffix}@x.test', 'active');
      insert into rent_schedules (owner_id, id, lease_id, status, amount_cents, currency_code, due_day, effective_start_date, collection_mode, collection_provider, forge_cutover_date)
      values ('${owner.id}', '${scheduleId}', '${leaseId}', 'active', 100000, 'USD', 1, '2026-01-01', 'forge', null, '2026-01-01');
    `);

    [ownerClient, strangerClient] = await Promise.all([signInFreshClient(owner.email), signInFreshClient(stranger.email)]);
  }, 30000);

  afterAll(async () => {
    if (!reachable) return;
    psql(`
      delete from payment_webhook_events where object_id like 'pi_test_${suffix}%' or object_id like 'ch_test_${suffix}%' or object_id like 'po_test_${suffix}%';
      -- open_rental_payment_support_case_trigger auto-opens a rental_support_cases row on a
      -- payment transitioning to failed/disputed/partially_refunded/refunded -- a real product
      -- behavior this proof's failure/refund/dispute scenarios legitimately trigger, so its rows
      -- must be cleared before rental_payments (FK) can be deleted.
      delete from rental_support_cases where owner_id = '${owner.id}';
      delete from rental_autopay_enrollments where owner_id = '${owner.id}';
      delete from rental_settlements where owner_id = '${owner.id}';
      delete from rental_payments where owner_id = '${owner.id}';
      delete from rent_charges where owner_id = '${owner.id}';
      delete from rent_schedules where owner_id = '${owner.id}';
      delete from rental_tenants where owner_id = '${owner.id}';
      delete from rental_leases where owner_id = '${owner.id}';
      delete from rental_units where owner_id = '${owner.id}';
      delete from landlord_payment_accounts where owner_id = '${owner.id}';
    `);
    for (const user of [owner, stranger]) {
      if (!user) continue;
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) throw new Error(`Failed to delete test user ${user.email}: ${error.message}`);
    }
  }, 30000);

  let chargeCounter = 0;
  // Seeds a rent_charges row plus a `requires_payment_method` rental_payments row referencing it --
  // the real webhook route never INSERTs rental_payments itself (process_stripe_rental_payment_event
  // only UPDATEs a row that must already exist), matching how the real payment-initiation flow
  // (out of scope for this proof, same convention as the private-financing proof's own
  // "payment initiation" note) creates it before Stripe is ever involved.
  function insertPendingPayment({ paymentId, providerPaymentId, amountCents, providerCustomerId }) {
    chargeCounter += 1;
    const chargeId = `charge_${suffix}_${chargeCounter}`;
    psql(`
      insert into rent_charges (owner_id, id, lease_id, schedule_id, period, due_date, amount_cents, currency_code, status, source_key)
      values ('${owner.id}', '${chargeId}', '${leaseId}', '${scheduleId}', '2026-02', '2026-02-01', ${amountCents}, 'USD', 'due', 'test:${suffix}:${chargeId}');
      insert into rental_payments (owner_id, id, charge_id, lease_id, tenant_id, provider, provider_mode, provider_payment_id, provider_customer_id, amount_cents, currency_code, status, idempotency_key)
      values ('${owner.id}', '${paymentId}', '${chargeId}', '${leaseId}', '${tenantId}', 'stripe', 'test', '${providerPaymentId}', ${providerCustomerId ? `'${providerCustomerId}'` : "null"}, ${amountCents}, 'USD', 'requires_payment_method', 'rental:test:${suffix}:${paymentId}');
    `);
    return chargeId;
  }

  // No metadata.forge_payment_id prefix of "pf_payment_" -- route.js's branching falls through
  // every private-financing check straight to process_stripe_rental_payment_event.
  function paymentIntentEvent({ id, type, providerPaymentId, forgePaymentId, paymentMethodId, failureCode, failureMessage }) {
    return {
      id, type, account: connectedAccountId, livemode: false, created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: providerPaymentId,
          metadata: { forge_payment_id: forgePaymentId },
          ...(paymentMethodId ? { payment_method: paymentMethodId } : {}),
          ...(failureCode ? { last_payment_error: { code: failureCode, message: failureMessage } } : {}),
        },
      },
    };
  }

  function refundEvent({ id, providerRefundId, providerPaymentId, amountCents, status = "succeeded" }) {
    return {
      id, type: "refund.updated", account: connectedAccountId, livemode: false, created: Math.floor(Date.now() / 1000),
      data: { object: { id: providerRefundId, payment_intent: providerPaymentId, amount: amountCents, status } },
    };
  }

  function disputeEvent({ id, providerPaymentId, forgePaymentId }) {
    return {
      id, type: "charge.dispute.created", account: connectedAccountId, livemode: false, created: Math.floor(Date.now() / 1000),
      data: { object: { id: `dp_test_${suffix}`, payment_intent: providerPaymentId, metadata: { forge_payment_id: forgePaymentId } } },
    };
  }

  async function fetchCharge(chargeId) {
    const result = await ownerClient.from("rent_charges").select("*").eq("id", chargeId).single();
    if (result.error) throw result.error;
    return result.data;
  }

  async function fetchPayment(paymentId) {
    const result = await ownerClient.from("rental_payments").select("*").eq("id", paymentId).single();
    if (result.error) throw result.error;
    return result.data;
  }

  // financial_events has no production service_role reader anywhere in this codebase (every real
  // route reads it via the authenticated client) and no production service_role writer either --
  // the trigger that posts to it (post_succeeded_rental_payment_to_financial_event /
  // reconcile_rental_payment_reversal) is SECURITY DEFINER set row_security = off, so it writes as
  // its own owner and needs no caller privilege at all. Verifying its effect here therefore goes
  // through the local Postgres administrator via psql, matching reservationRpcs.integration.
  // test.js's own convention for admin-level verification, rather than the service_role JS client
  // -- granting service_role a privilege it has no real caller for would be exactly the kind of
  // unintended grant this whole domain's contract exists to eliminate.
  function readFinancialEvent(sourceSystem, sourceRecordId, columns) {
    const output = psql(`
      select 'ROW:' || ${columns.map((column) => `coalesce((${column})::text, 'NULL')`).join(" || '|' || ")}
      from financial_events
      where owner_id = '${owner.id}' and source_system = '${sourceSystem}' and source_record_id = '${sourceRecordId}';
    `);
    const match = output.match(/ROW:(.*)/);
    return match ? match[1].split("|") : null;
  }

  function countFinancialEvents(sourceRecordId) {
    const output = psql(`select 'COUNT:' || count(*)::text from financial_events where owner_id = '${owner.id}' and source_record_id = '${sourceRecordId}';`);
    return Number(output.match(/COUNT:(\d+)/)[1]);
  }

  it("posts a successful payment through the real route with exact-cent allocation, and the charge/ledger/report views all agree (scenarios: successful exact-cent allocation; agreement among ledger, balance, and reporting)", async () => {
    const paymentId = `rp_${suffix}_success`;
    const providerPaymentId = `pi_test_${suffix}_success`;
    const chargeId = insertPendingPayment({ paymentId, providerPaymentId, amountCents: 100000 });

    const response = await POST(signedRequest(paymentIntentEvent({
      id: `evt_${suffix}_success`, type: "payment_intent.succeeded", providerPaymentId, forgePaymentId: paymentId, paymentMethodId: "pm_test_1",
    })));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });

    const payment = await fetchPayment(paymentId);
    expect(payment.status).toBe("succeeded");
    expect(payment.succeeded_at).not.toBeNull();

    // The charge, exactly as the RPC's own row-locked update leaves it -- exact-cent, no float.
    const charge = await fetchCharge(chargeId);
    expect(charge.paid_amount_cents).toBe(100000);
    expect(charge.amount_cents).toBe(100000);
    expect(charge.status).toBe("paid");

    // The immutable-event/reporting layer: post_succeeded_rental_payment_to_financial_event fires
    // on the same UPDATE this RPC just performed, posting exactly one financial_events row keyed by
    // (owner_id, source_system, source_record_id) -- asserting agreement between the charge (above)
    // and the ledger/reporting row here is the "ledger, balance, and reporting agree" scenario.
    const financialEventRow = readFinancialEvent("forge_rental_payment", paymentId, ["amount", "transaction_kind"]);
    expect(financialEventRow).not.toBeNull();
    const [amount, transactionKind] = financialEventRow;
    expect(Number(amount)).toBe(1000); // 100000 cents / 100.0, exact
    expect(transactionKind).toBe("income");

    const webhookRow = await admin.from("payment_webhook_events").select("*").eq("provider_event_id", `evt_${suffix}_success`).single();
    expect(webhookRow.data.status).toBe("processed");
  });

  it("is idempotent on webhook retry: the same Stripe event delivered twice processes exactly once (scenario: duplicate webhook/retry idempotency)", async () => {
    const paymentId = `rp_${suffix}_dup`;
    const providerPaymentId = `pi_test_${suffix}_dup`;
    insertPendingPayment({ paymentId, providerPaymentId, amountCents: 50000 });
    const event = paymentIntentEvent({ id: `evt_${suffix}_dup`, type: "payment_intent.succeeded", providerPaymentId, forgePaymentId: paymentId, paymentMethodId: "pm_test_2" });

    const first = await POST(signedRequest(event));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ received: true });
    const afterFirst = await fetchPayment(paymentId);
    expect(afterFirst.status).toBe("succeeded");

    const second = await POST(signedRequest(event));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ received: true, duplicate: true });

    const webhookRows = await admin.from("payment_webhook_events").select("id").eq("provider_event_id", `evt_${suffix}_dup`);
    expect(webhookRows.data).toHaveLength(1);

    expect(countFinancialEvents(paymentId)).toBe(1); // the AFTER UPDATE trigger's own (owner_id,source_system,source_record_id) conflict guard, not just webhook dedup
  });

  it("leaves no partial residue when Stripe reports payment failure (scenario: provider failure with no partial residue)", async () => {
    const paymentId = `rp_${suffix}_fail`;
    const providerPaymentId = `pi_test_${suffix}_fail`;
    const chargeId = insertPendingPayment({ paymentId, providerPaymentId, amountCents: 80000 });

    const response = await POST(signedRequest(paymentIntentEvent({
      id: `evt_${suffix}_fail`, type: "payment_intent.payment_failed", providerPaymentId, forgePaymentId: paymentId,
      failureCode: "card_declined", failureMessage: "The card was declined.",
    })));
    expect(response.status).toBe(200);

    const payment = await fetchPayment(paymentId);
    expect(payment.status).toBe("failed");

    const charge = await fetchCharge(chargeId);
    expect(charge.paid_amount_cents).toBe(0);
    expect(charge.status).toBe("due");

    expect(countFinancialEvents(paymentId)).toBe(0);
  });

  it("does NOT regress a succeeded payment's status when a delayed 'processing' event arrives late -- unlike the equivalent private-financing gap, this RPC's own status guard holds under real infrastructure, not just code reading (scenario: delayed/replayed event)", async () => {
    const paymentId = `rp_${suffix}_delayed`;
    const providerPaymentId = `pi_test_${suffix}_delayed`;
    insertPendingPayment({ paymentId, providerPaymentId, amountCents: 30000 });

    const succeeded = await POST(signedRequest(paymentIntentEvent({
      id: `evt_${suffix}_delayed_succeeded`, type: "payment_intent.succeeded", providerPaymentId, forgePaymentId: paymentId, paymentMethodId: "pm_test_3",
    })));
    expect(succeeded.status).toBe(200);
    const afterSucceeded = await fetchPayment(paymentId);
    expect(afterSucceeded.status).toBe("succeeded");

    // A distinct, earlier-stage event for the same PaymentIntent, delivered late (different event
    // id, so the payment_webhook_events dedup guard does not catch it on its own).
    const delayedProcessing = await POST(signedRequest(paymentIntentEvent({
      id: `evt_${suffix}_delayed_processing`, type: "payment_intent.processing", providerPaymentId, forgePaymentId: paymentId,
    })));
    expect(delayedProcessing.status).toBe(200);

    const afterDelayed = await fetchPayment(paymentId);
    // process_stripe_rental_payment_event's own guard (supabase/migrations/20260821000100, line
    // ~48): `if p_event_type = 'payment_intent.processing' and v_payment.status not in
    // ('succeeded','refunded','disputed')` -- with status already 'succeeded', this condition is
    // false, so NONE of the if/elsif branches fire and the row is left untouched. This test proves
    // that under a real Postgres round-trip, not just by reading the SQL.
    expect(afterDelayed.status).toBe("succeeded");
    expect(afterDelayed.updated_at).toBe(afterSucceeded.updated_at);

    // The late event is still marked processed (acknowledged, not silently dropped or left pending).
    const webhookRow = await admin.from("payment_webhook_events").select("status").eq("provider_event_id", `evt_${suffix}_delayed_processing`).single();
    expect(webhookRow.data.status).toBe("processed");
  });

  it("reverses a full refund through the real reconciliation trigger: charge voids/adjusts and an exact offsetting ledger entry posts (scenario: agreement among ledger, balance, and reporting after a reversal)", async () => {
    const paymentId = `rp_${suffix}_refund_full`;
    const providerPaymentId = `pi_test_${suffix}_refund_full`;
    const chargeId = insertPendingPayment({ paymentId, providerPaymentId, amountCents: 100000 });
    await POST(signedRequest(paymentIntentEvent({
      id: `evt_${suffix}_refund_full_succeeded`, type: "payment_intent.succeeded", providerPaymentId, forgePaymentId: paymentId, paymentMethodId: "pm_test_4",
    })));
    expect((await fetchCharge(chargeId)).paid_amount_cents).toBe(100000);

    const response = await POST(signedRequest(refundEvent({
      id: `evt_${suffix}_refund_full`, providerRefundId: `re_test_${suffix}_full`, providerPaymentId, amountCents: 100000,
    })));
    expect(response.status).toBe(200);

    const payment = await fetchPayment(paymentId);
    expect(payment.status).toBe("refunded");
    expect(payment.refunded_amount_cents).toBe(100000);

    // reconcile_rental_payment_reversal (supabase/migrations/20260813003000) recomputes paid_amount_cents
    // from the sum of non-refunded payments against this charge -- with the only payment now fully
    // refunded, that sum is 0.
    const charge = await fetchCharge(chargeId);
    expect(charge.paid_amount_cents).toBe(0);
    // due_date ('2026-02-01') is before this test's real run date, so the trigger's own
    // due_date < current_date ? 'overdue' : 'due' branch correctly resolves to 'overdue' -- proof
    // the reversal trigger actually re-derives status from real dates, not a hardcoded 'due'.
    expect(charge.status).toBe("overdue");

    const reversalEventRow = readFinancialEvent("forge_rental_payment_adjustment", paymentId, ["amount", "transaction_kind", "description"]);
    expect(reversalEventRow).not.toBeNull();
    const [reversalAmount, reversalTransactionKind, reversalDescription] = reversalEventRow;
    expect(Number(reversalAmount)).toBe(-1000); // exact offset of the original +$1000.00
    expect(reversalTransactionKind).toBe("expense");
    expect(reversalDescription).toBe("Rent payment refunded");
  });

  it("reverses a partial refund proportionally, leaving the charge partially paid (scenario: agreement among ledger, balance, and reporting after a partial reversal)", async () => {
    const paymentId = `rp_${suffix}_refund_partial`;
    const providerPaymentId = `pi_test_${suffix}_refund_partial`;
    const chargeId = insertPendingPayment({ paymentId, providerPaymentId, amountCents: 100000 });
    await POST(signedRequest(paymentIntentEvent({
      id: `evt_${suffix}_refund_partial_succeeded`, type: "payment_intent.succeeded", providerPaymentId, forgePaymentId: paymentId, paymentMethodId: "pm_test_5",
    })));

    const response = await POST(signedRequest(refundEvent({
      id: `evt_${suffix}_refund_partial`, providerRefundId: `re_test_${suffix}_partial`, providerPaymentId, amountCents: 40000,
    })));
    expect(response.status).toBe(200);

    const payment = await fetchPayment(paymentId);
    expect(payment.status).toBe("partially_refunded");
    expect(payment.refunded_amount_cents).toBe(40000);

    const charge = await fetchCharge(chargeId);
    // process_stripe_rental_payment_event's own summation: amount_cents - refunded_amount_cents = 60000 still counted paid.
    expect(charge.paid_amount_cents).toBe(60000);
    expect(charge.status).toBe("partially_paid");

    const [partialReversalAmount] = readFinancialEvent("forge_rental_payment_adjustment", paymentId, ["amount"]);
    expect(Number(partialReversalAmount)).toBe(-400); // exact offset of the $400.00 refunded, not the full $1000.00
  });

  it("routes a dispute through the same reversal path as a refund (scenario: agreement among ledger, balance, and reporting after a dispute)", async () => {
    const paymentId = `rp_${suffix}_dispute`;
    const providerPaymentId = `pi_test_${suffix}_dispute`;
    const chargeId = insertPendingPayment({ paymentId, providerPaymentId, amountCents: 60000 });
    await POST(signedRequest(paymentIntentEvent({
      id: `evt_${suffix}_dispute_succeeded`, type: "payment_intent.succeeded", providerPaymentId, forgePaymentId: paymentId, paymentMethodId: "pm_test_6",
    })));

    const response = await POST(signedRequest(disputeEvent({ id: `evt_${suffix}_dispute`, providerPaymentId, forgePaymentId: paymentId })));
    expect(response.status).toBe(200);

    const payment = await fetchPayment(paymentId);
    expect(payment.status).toBe("disputed");

    // reconcile_rental_payment_reversal's trigger fires on UPDATE OF status -- a disputed payment's
    // full amount is treated as no longer reliably collected, same reversal accounting as a refund.
    const charge = await fetchCharge(chargeId);
    expect(charge.paid_amount_cents).toBe(0);

    const [disputeDescription, disputeAmount] = readFinancialEvent("forge_rental_payment_adjustment", paymentId, ["description", "amount"]);
    expect(disputeDescription).toBe("Rent payment disputed");
    expect(Number(disputeAmount)).toBe(-600);
  });

  it("denies a cross-workspace stranger any visibility into this owner's charges or payments, even via a direct RLS-scoped read (scenario: cross-workspace and unauthorized-user denial)", async () => {
    const paymentId = `rp_${suffix}_rls`;
    const providerPaymentId = `pi_test_${suffix}_rls`;
    const chargeId = insertPendingPayment({ paymentId, providerPaymentId, amountCents: 45000 });

    const strangerCharges = await strangerClient.from("rent_charges").select("*").eq("id", chargeId);
    expect(strangerCharges.error).toBeNull();
    expect(strangerCharges.data).toEqual([]);

    const strangerPayments = await strangerClient.from("rental_payments").select("*").eq("id", paymentId);
    expect(strangerPayments.error).toBeNull();
    expect(strangerPayments.data).toEqual([]);

    // The owner's own session, by contrast, sees it -- confirms the empty stranger result above is
    // real RLS denial, not a broken fixture.
    const ownerCharges = await ownerClient.from("rent_charges").select("*").eq("id", chargeId);
    expect(ownerCharges.data).toHaveLength(1);
  });

  it("keeps settlement availability and payout status distinct from the payment's own status, and distinct from each other (scenario: fees, payment status, settlement availability, payout, and reconciliation remain distinct)", async () => {
    const paymentId = `rp_${suffix}_settle`;
    const providerPaymentId = `pi_test_${suffix}_settle`;
    insertPendingPayment({ paymentId, providerPaymentId, amountCents: 100000 });
    await POST(signedRequest(paymentIntentEvent({
      id: `evt_${suffix}_settle_succeeded`, type: "payment_intent.succeeded", providerPaymentId, forgePaymentId: paymentId, paymentMethodId: "pm_test_7",
    })));

    vi.resetModules();
    vi.doMock("@/infrastructure/billing/StripeBillingProvider", async () => {
      const actual = await vi.importActual("@/infrastructure/billing/StripeBillingProvider");
      return {
        ...actual,
        createStripeBillingProvider: (env) => {
          const real = actual.createStripeBillingProvider(env);
          return {
            ...real,
            constructWebhookEvent: real.constructWebhookEvent.bind(real),
            // Deterministic stand-ins for the provider methods charge.succeeded/payout.paid reach --
            // proving the settlement/payout *contract* (real RPC, real settlement row) without a
            // live Stripe network call, same technique as the private-financing proof's fee-credit
            // scenario.
            retrieveCharge: async () => ({ id: `ch_test_${suffix}_settle`, paymentIntentId: providerPaymentId, balanceTransactionId: `txn_test_${suffix}_settle` }),
            retrieveBalanceTransaction: async () => ({
              id: `txn_test_${suffix}_settle`, grossAmountCents: 100000, feeAmountCents: 3200, netAmountCents: 96800,
              currencyCode: "USD", status: "pending", availableAt: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
            }),
            listPayoutBalanceTransactionIds: async () => [`txn_test_${suffix}_settle`],
          };
        },
      };
    });
    const { POST: postWithFakeProvider } = await import("../../../app/api/rental/stripe-webhook/route.js");

    const chargeSucceededResponse = await postWithFakeProvider(signedRequest({
      id: `evt_${suffix}_charge_succeeded`, type: "charge.succeeded", account: connectedAccountId, livemode: false,
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: `ch_test_${suffix}_settle`, payment_intent: providerPaymentId, balance_transaction: `txn_test_${suffix}_settle` } },
    }));
    expect(chargeSucceededResponse.status).toBe(200);

    // The payment's own status is untouched by settlement reconciliation -- still 'succeeded', not
    // rewritten to 'settled' or any settlement-specific value; settlement state lives entirely in
    // its own table.
    let payment = await fetchPayment(paymentId);
    expect(payment.status).toBe("succeeded");

    const settlement = await admin.from("rental_settlements")
      .select("*").eq("owner_id", owner.id).eq("provider_balance_transaction_id", `txn_test_${suffix}_settle`).single();
    expect(settlement.error).toBeNull();
    expect(settlement.data.gross_amount_cents).toBe(100000);
    expect(settlement.data.fee_amount_cents).toBe(3200);
    expect(settlement.data.net_amount_cents).toBe(96800); // exact: 100000 - 3200, enforced by the RPC's own arithmetic guard
    expect(settlement.data.status).toBe("pending"); // not yet available -- distinct from "paid out"
    expect(settlement.data.paid_out_at).toBeNull();

    const payoutResponse = await postWithFakeProvider(signedRequest({
      id: `evt_${suffix}_payout_paid`, type: "payout.paid", account: connectedAccountId, livemode: false,
      created: Math.floor(Date.now() / 1000), data: { object: { id: `po_test_${suffix}_settle` } },
    }));
    expect(payoutResponse.status).toBe(200);

    const settledAfterPayout = await admin.from("rental_settlements")
      .select("status,paid_out_at,provider_payout_id").eq("owner_id", owner.id).eq("provider_balance_transaction_id", `txn_test_${suffix}_settle`).single();
    expect(settledAfterPayout.data.status).toBe("paid_out");
    expect(settledAfterPayout.data.paid_out_at).not.toBeNull();
    expect(settledAfterPayout.data.provider_payout_id).toBe(`po_test_${suffix}_settle`);

    // The payment's status remains untouched even after payout -- three genuinely independent
    // states (payment status, settlement availability, payout status), never conflated into one.
    payment = await fetchPayment(paymentId);
    expect(payment.status).toBe("succeeded");

    vi.doUnmock("@/infrastructure/billing/StripeBillingProvider");
    vi.resetModules();
  });

  it("activates a pending autopay enrollment when its qualifying payment succeeds with a payment method attached (scenario: tenant payment or autopay is initiated)", async () => {
    const enrollmentId = `enroll_${suffix}`;
    const providerCustomerId = `cus_test_${suffix}`;
    psql(`
      insert into rental_autopay_enrollments (owner_id, id, lease_id, tenant_id, status, payment_method_type, provider, provider_customer_id, charge_day, consent_text, consented_at, provider_mode)
      values ('${owner.id}', '${enrollmentId}', '${leaseId}', '${tenantId}', 'setup_required', 'card', 'stripe', '${providerCustomerId}', 1, 'Test tenant consented to autopay.', now(), 'test');
    `);

    const paymentId = `rp_${suffix}_autopay`;
    const providerPaymentId = `pi_test_${suffix}_autopay`;
    insertPendingPayment({ paymentId, providerPaymentId, amountCents: 100000, providerCustomerId });

    const response = await POST(signedRequest(paymentIntentEvent({
      id: `evt_${suffix}_autopay_succeeded`, type: "payment_intent.succeeded", providerPaymentId, forgePaymentId: paymentId, paymentMethodId: "pm_test_autopay",
    })));
    expect(response.status).toBe(200);

    const enrollment = await admin.from("rental_autopay_enrollments").select("*").eq("owner_id", owner.id).eq("id", enrollmentId).single();
    expect(enrollment.data.status).toBe("active");
    expect(enrollment.data.provider_payment_method_id).toBe("pm_test_autopay");
    expect(enrollment.data.activated_at).not.toBeNull();
  });
});
