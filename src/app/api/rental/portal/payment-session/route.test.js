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
  const node = { select: vi.fn(() => node), eq: vi.fn(() => node), in: vi.fn(() => node), maybeSingle: vi.fn(async () => result), single: vi.fn(async () => result), insert: vi.fn(() => node), update: vi.fn(() => node), upsert: vi.fn(() => node) };
  return node;
}

const tenant = { id: "tenant_1", owner_id: "owner_1", email: "tenant@example.com", display_name: "Tenant One" };
const charge = { id: "charge_1", owner_id: "owner_1", lease_id: "lease_1", status: "due", amount_cents: 150000, paid_amount_cents: 0, currency_code: "USD", due_date: "2026-09-01", period: "2026-09", charge_type: "rent" };

let tables;
const createRentalWebhookClient = vi.fn(() => ({ from: (table) => tables[table] }));
vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: (...args) => createRentalWebhookClient(...args) }));

import { POST } from "./route.js";

function request(body) {
  return new NextRequest("https://forge.test/api/rental/portal/payment-session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function baseTables(accountRow, customerRow = null) {
  return {
    rental_tenants: single({ data: tenant, error: null }),
    rent_charges: single({ data: charge, error: null }),
    rental_lease_tenants: single({ data: { lease_id: "lease_1" }, error: null }),
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
});
