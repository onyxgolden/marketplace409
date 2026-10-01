import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authenticated = { user: { id: "auth_user_1" }, supabaseClient: {} };
const createAuthenticatedForgeApplication = vi.fn(async () => authenticated);
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: (...args) => createAuthenticatedForgeApplication(...args) }));

const createCustomer = vi.fn();
const createPaymentSession = vi.fn();
const provider = { mode: "test", createCustomer, createPaymentSession };
vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({ createStripeBillingProvider: () => provider }));

function single(result) {
  const node = { select: vi.fn(() => node), eq: vi.fn(() => node), in: vi.fn(() => node),
    order: vi.fn(() => node), limit: vi.fn(() => node),
    maybeSingle: vi.fn(async () => result), single: vi.fn(async () => result), insert: vi.fn(() => node), update: vi.fn(() => node), upsert: vi.fn(() => node) };
  return node;
}

const tenant = { id: "tenant_1", owner_id: "owner_1", email: "tenant@example.com", display_name: "Tenant One" };
const charge = { id: "charge_1", owner_id: "owner_1", lease_id: "lease_1", schedule_id: "schedule_1", status: "due", amount_cents: 150000, paid_amount_cents: 0, currency_code: "USD", due_date: "2026-09-01", period: "2026-09", charge_type: "rent" };
const forgeCollectibleSchedule = { collection_mode: "forge", forge_cutover_date: "2026-01-01" };

let tables;
const createRentalWebhookClient = vi.fn(() => ({ from: (table) => tables[table] }));
vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: (...args) => createRentalWebhookClient(...args) }));

import { POST } from "./route.js";

function request(body) {
  return new NextRequest("https://forge.test/api/rental/portal/payment-session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function baseTables(accountRow, customerRow = null, scheduleRow = forgeCollectibleSchedule, billingSettingsRow = { billing_enabled: true }) {
  return {
    rental_tenants: single({ data: tenant, error: null }),
    rent_charges: single({ data: charge, error: null }),
    rental_lease_tenants: single({ data: { lease_id: "lease_1" }, error: null }),
    rent_schedules: single({ data: scheduleRow, error: null }),
    rental_billing_settings: single({ data: billingSettingsRow, error: null }),
    rental_payments: single({ data: null, error: null }), // no pending payment for this charge
    landlord_payment_accounts: single({ data: accountRow, error: null }),
    billing_customer_references: single({ data: customerRow, error: null }),
  };
}

describe("tenant payment-session route (provider-mode isolation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAuthenticatedForgeApplication.mockResolvedValue(authenticated);
    provider.mode = "test";
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_fixture";
    createPaymentSession.mockResolvedValue({ paymentIntentId: "pi_1", clientSecret: "secret", connectedAccountId: "acct_kent" });
  });

  it("looks up the landlord account and customer reference scoped to the server's provider_mode", async () => {
    tables = baseTables({ provider_account_id: "acct_kent", status: "enabled", charges_enabled: true, payouts_enabled: true, card_payments_enabled: true },
      { customer_id: "cus_test_1" });
    await POST(request({ chargeId: "charge_1" }));
    expect(tables.landlord_payment_accounts.eq).toHaveBeenCalledWith("provider_mode", "test");
    expect(tables.billing_customer_references.eq).toHaveBeenCalledWith("provider_mode", "test");
  });

  it("a live-mode payment session cannot select a test-mode landlord account or customer reference", async () => {
    provider.mode = "live";
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_live_fixture";
    // The mocked query always "finds" whatever row is configured regardless of .eq() args, so to
    // prove real isolation we assert the exact filter Supabase would apply, not just that some
    // row was returned — the query itself must include the live mode filter for correctness.
    tables = baseTables(null, null); // simulates: no live-mode row exists yet, even though a test-mode row does
    const response = await POST(request({ chargeId: "charge_1" }));
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toBe("The landlord payment account is not ready.");
    expect(tables.landlord_payment_accounts.eq).toHaveBeenCalledWith("provider_mode", "live");
  });

  it("tags a newly created customer reference and rental_payments row with the current provider_mode", async () => {
    tables = baseTables({ provider_account_id: "acct_kent", status: "enabled", charges_enabled: true, payouts_enabled: true, card_payments_enabled: true }, null);
    // The initial lookup (maybeSingle) finds no existing customer reference; the upsert's own
    // .select().single() then returns the freshly-created row — distinct from the lookup result.
    tables.billing_customer_references.single.mockResolvedValue({ data: { customer_id: "cus_new", connected_account_id: "acct_kent" }, error: null });
    createCustomer.mockResolvedValue({ customerId: "cus_new" });
    await POST(request({ chargeId: "charge_1" }));
    expect(tables.billing_customer_references.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ provider_mode: "test", connected_account_id: "acct_kent", customer_id: "cus_new" }),
      { onConflict: "owner_id,tenant_id,provider,provider_mode" },
    );
    expect(tables.rental_payments.insert).toHaveBeenCalledWith(expect.objectContaining({ provider_mode: "test" }));
  });

  it("does not select a payment session at all when the landlord account is not ready, regardless of an id existing", async () => {
    tables = baseTables({ provider_account_id: "acct_kent", status: "onboarding", charges_enabled: false, payouts_enabled: false });
    const response = await POST(request({ chargeId: "charge_1" }));
    expect(response.status).toBe(409);
    expect(createPaymentSession).not.toHaveBeenCalled();
  });

  it("fails before any database or Stripe call when the publishable key does not match the server's mode", async () => {
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_live_mismatched"; // server mode is "test"
    tables = baseTables({ provider_account_id: "acct_kent", status: "enabled", charges_enabled: true, payouts_enabled: true, card_payments_enabled: true },
      { customer_id: "cus_test_1" });
    const response = await POST(request({ chargeId: "charge_1" }));
    expect(response.status).toBe(500);
    expect(tables.rental_tenants.select).not.toHaveBeenCalled();
    expect(createPaymentSession).not.toHaveBeenCalled();
  });

  // Rental billing cutover containment: Pay now must reject a pre-cutover/external charge
  // server-side, even if a URL or stale UI still exposes it — never inferred from the charge's own
  // status, which looks identical either way.
  describe("collection-authority containment", () => {
    it("rejects a charge whose schedule is still collection_mode='external'", async () => {
      tables = baseTables({ provider_account_id: "acct_kent", status: "enabled", charges_enabled: true, payouts_enabled: true, card_payments_enabled: true },
        { customer_id: "cus_test_1" }, { collection_mode: "external", forge_cutover_date: null });
      const response = await POST(request({ chargeId: "charge_1" }));
      const body = await response.json();
      expect(response.status).toBe(404);
      expect(body.error).toBe("This rent charge is not currently collectible through FORGE.");
      expect(createPaymentSession).not.toHaveBeenCalled();
    });

    it("rejects a charge whose schedule's FORGE cutover date has not arrived yet", async () => {
      tables = baseTables({ provider_account_id: "acct_kent", status: "enabled", charges_enabled: true, payouts_enabled: true, card_payments_enabled: true },
        { customer_id: "cus_test_1" }, { collection_mode: "forge", forge_cutover_date: "2099-01-01" });
      const response = await POST(request({ chargeId: "charge_1" }));
      expect(response.status).toBe(404);
      expect(createPaymentSession).not.toHaveBeenCalled();
    });

    it("rejects a charge with no matching schedule row at all", async () => {
      tables = baseTables({ provider_account_id: "acct_kent", status: "enabled", charges_enabled: true, payouts_enabled: true, card_payments_enabled: true },
        { customer_id: "cus_test_1" }, null);
      const response = await POST(request({ chargeId: "charge_1" }));
      expect(response.status).toBe(404);
    });

    it("allows a charge whose schedule is collection_mode='forge' with an arrived cutover date (the existing baseline)", async () => {
      tables = baseTables({ provider_account_id: "acct_kent", status: "enabled", charges_enabled: true, payouts_enabled: true, card_payments_enabled: true },
        { customer_id: "cus_test_1" });
      const response = await POST(request({ chargeId: "charge_1" }));
      expect(response.status).toBe(200);
      expect(createPaymentSession).toHaveBeenCalled();
    });
  });

  // Ad-hoc charges have schedule_id NULL: the schedule collectibility gate must
  // fall back to the lease's active schedule instead of matching no schedule
  // row (which would wrongly reject them as "not collectible"). Voluntary
  // portal payment stays open to every valid charge type — no charge-type gate here.
  describe("ad-hoc charges (null schedule_id)", () => {
    const readyAccount = { provider_account_id: "acct_kent", status: "enabled", charges_enabled: true, payouts_enabled: true, card_payments_enabled: true };
    function adHocTables(accountRow, customerRow, scheduleRow) {
      return {
        ...baseTables(accountRow, customerRow, scheduleRow),
        rent_charges: single({ data: { ...charge, schedule_id: null, charge_type: "damage" }, error: null }),
      };
    }

    it("allows an ad-hoc damage charge when the lease has an active FORGE-collected schedule, via the lease fallback lookup", async () => {
      tables = adHocTables(readyAccount, { customer_id: "cus_test_1" }, forgeCollectibleSchedule);
      const response = await POST(request({ chargeId: "charge_1" }));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(createPaymentSession).toHaveBeenCalled();
      // Fallback lookup pattern: lease-scoped active schedule, not a null id match.
      expect(tables.rent_schedules.eq).toHaveBeenCalledWith("lease_id", "lease_1");
      expect(tables.rent_schedules.eq).toHaveBeenCalledWith("status", "active");
      expect(tables.rent_schedules.eq).not.toHaveBeenCalledWith("id", null);
    });

    it("rejects an ad-hoc charge when the lease has no active schedule at all", async () => {
      tables = adHocTables(readyAccount, { customer_id: "cus_test_1" }, null);
      const response = await POST(request({ chargeId: "charge_1" }));
      const body = await response.json();
      expect(response.status).toBe(404);
      expect(body.error).toBe("This rent charge is not currently collectible through FORGE.");
      expect(createPaymentSession).not.toHaveBeenCalled();
    });

    it("rejects an ad-hoc charge when the lease's active schedule is not FORGE-collected", async () => {
      tables = adHocTables(readyAccount, { customer_id: "cus_test_1" }, { collection_mode: "external", forge_cutover_date: null });
      const response = await POST(request({ chargeId: "charge_1" }));
      expect(response.status).toBe(404);
      expect(createPaymentSession).not.toHaveBeenCalled();
    });

    it("still uses the direct schedule lookup when the charge has a schedule_id (no fallback query)", async () => {
      tables = baseTables(readyAccount, { customer_id: "cus_test_1" }, forgeCollectibleSchedule);
      const response = await POST(request({ chargeId: "charge_1" }));
      expect(response.status).toBe(200);
      expect(tables.rent_schedules.eq).toHaveBeenCalledWith("id", "schedule_1");
    });
  });

  // Owner-level master pause: must block even an otherwise fully-eligible, individually
  // FORGE-activated lease — per-schedule activation alone must never be sufficient.
  describe("rental billing master pause", () => {
    it("rejects an otherwise-eligible charge while the owner's rental billing is globally paused", async () => {
      tables = baseTables({ provider_account_id: "acct_kent", status: "enabled", charges_enabled: true, payouts_enabled: true, card_payments_enabled: true },
        { customer_id: "cus_test_1" }, forgeCollectibleSchedule, { billing_enabled: false });
      const response = await POST(request({ chargeId: "charge_1" }));
      const body = await response.json();
      expect(response.status).toBe(404);
      expect(body.error).toBe("Rental online billing is currently paused for this owner.");
      expect(createPaymentSession).not.toHaveBeenCalled();
    });

    it("rejects an otherwise-eligible charge when no rental_billing_settings row exists yet for the owner (defaults to paused)", async () => {
      tables = baseTables({ provider_account_id: "acct_kent", status: "enabled", charges_enabled: true, payouts_enabled: true, card_payments_enabled: true },
        { customer_id: "cus_test_1" }, forgeCollectibleSchedule, null);
      const response = await POST(request({ chargeId: "charge_1" }));
      expect(response.status).toBe(404);
      expect(createPaymentSession).not.toHaveBeenCalled();
    });
  });

  // R12 card convenience fees: pass-through to the tenant, agreed-to in the
  // portal, booked as reimbursement (never income). The fee amount is always
  // computed server-side from the workspace rate; the client only echoes.
  describe("card convenience fee gate", () => {
    const readyAccount = { provider_account_id: "acct_kent", status: "enabled", charges_enabled: true, payouts_enabled: true, card_payments_enabled: true };
    const feeOn = { billing_enabled: true, card_convenience_fee_bps: 295 }; // 2.95% of $1500 = $44.25
    function feeTables(accountRow = readyAccount, settingsRow = feeOn) {
      return baseTables(accountRow, { customer_id: "cus_test_1" }, forgeCollectibleSchedule, settingsRow);
    }

    it("422s a card payment when the tenant has not explicitly agreed to the fee", async () => {
      tables = feeTables();
      const response = await POST(request({ chargeId: "charge_1", paymentMethod: "card", feeAgreed: false }));
      const body = await response.json();
      expect(response.status).toBe(422);
      expect(body.error).toContain("check the box");
      expect(body.error).toContain("$44.25");
      expect(createPaymentSession).not.toHaveBeenCalled();
      expect(tables.rental_payments.insert).not.toHaveBeenCalled();
    });

    it("422s when the echoed fee does not match the server-computed fee (owner changed the rate mid-review)", async () => {
      tables = feeTables();
      const response = await POST(request({ chargeId: "charge_1", paymentMethod: "card", feeAgreed: true, expectedFeeCents: 1 }));
      const body = await response.json();
      expect(response.status).toBe(422);
      expect(body.error).toMatch(/changed while you were reviewing/);
      expect(createPaymentSession).not.toHaveBeenCalled();
    });

    it("creates a card-only session charging rent + the server-computed fee, with the fee on the payment row", async () => {
      tables = feeTables();
      const response = await POST(request({ chargeId: "charge_1", paymentMethod: "card", feeAgreed: true, expectedFeeCents: 4425 }));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.rentCents).toBe(150000);
      expect(body.convenienceFeeCents).toBe(4425);
      expect(body.convenienceFeeBps).toBe(295);
      expect(body.amountCents).toBe(154425);
      expect(createPaymentSession).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ amountCents: 154425, paymentMethods: ["card"] }),
      );
      expect(tables.rental_payments.insert).toHaveBeenCalledWith(
        expect.objectContaining({ amount_cents: 154425, convenience_fee_cents: 4425, convenience_fee_bps: 295 }),
      );
      const inserted = tables.rental_payments.insert.mock.calls[0][0];
      expect(inserted.fee_agreed_at).toEqual(expect.any(String));
    });

    it("charges no fee and needs no agreement for ACH, with a bank-only element", async () => {
      tables = feeTables();
      const response = await POST(request({ chargeId: "charge_1", paymentMethod: "us_bank_account" }));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.convenienceFeeCents).toBe(0);
      expect(body.amountCents).toBe(150000);
      expect(createPaymentSession).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ amountCents: 150000, paymentMethods: ["us_bank_account"] }),
      );
      expect(tables.rental_payments.insert).toHaveBeenCalledWith(
        expect.objectContaining({ amount_cents: 150000, convenience_fee_cents: 0, convenience_fee_bps: null, fee_agreed_at: null }),
      );
    });

    it("needs no agreement and charges no fee when the workspace fee is off (default)", async () => {
      tables = feeTables(readyAccount, { billing_enabled: true });
      const response = await POST(request({ chargeId: "charge_1", paymentMethod: "card" }));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.convenienceFeeCents).toBe(0);
      expect(body.amountCents).toBe(150000);
    });

    it("fails closed (400) when the payment method is missing but a fee is enabled", async () => {
      tables = feeTables();
      const response = await POST(request({ chargeId: "charge_1" }));
      expect(response.status).toBe(400);
      expect(createPaymentSession).not.toHaveBeenCalled();
    });

    it("keeps the legacy both-methods element when the method is missing and the fee is off", async () => {
      tables = feeTables(readyAccount, { billing_enabled: true });
      const response = await POST(request({ chargeId: "charge_1" }));
      expect(response.status).toBe(200);
      expect(createPaymentSession).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ paymentMethods: ["us_bank_account", "card"] }),
      );
    });
  });
});
