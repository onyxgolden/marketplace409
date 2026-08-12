import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateBillingCheckoutInput } from "../billing-provider.types";
import { createLandlordPaymentAccount } from "../../landlord-payment-account";
describe("billing provider foundation", () => {
  it("validates immutable checkout requests", () => {
    const value = validateBillingCheckoutInput({ paymentId: "payment_1", chargeId: "charge_1", leaseId: "lease_1",
      tenantId: "tenant_1", customerId: null, amountCents: 125000, currencyCode: "usd",
      paymentMethods: ["us_bank_account", "card"], successUrl: "https://forge.test/success",
      cancelUrl: "https://forge.test/cancel", applicationFeeCents: 0, idempotencyKey: "payment:charge_1:1" });
    expect(value.currencyCode).toBe("USD");
    expect(Object.isFrozen(value)).toBe(true);
  });
  it("rejects fees that consume the payment", () => {
    expect(() => validateBillingCheckoutInput({ paymentId: "p", chargeId: "c", leaseId: "l", tenantId: "t",
      customerId: null, amountCents: 100, currencyCode: "USD", paymentMethods: ["card"], successUrl: "https://a",
      cancelUrl: "https://b", applicationFeeCents: 100, idempotencyKey: "key" })).toThrow("less than");
  });
  it("does not label restricted landlord accounts enabled", () => {
    expect(() => createLandlordPaymentAccount({ id: "account_1", landlordOwnerId: "owner_1", provider: "stripe",
      providerAccountId: "acct_1", status: "enabled", detailsSubmitted: true, chargesEnabled: false,
      payoutsEnabled: true, achDebitEnabled: false, cardPaymentsEnabled: true, requirementsDue: [],
      createdAt: "2026-08-12T00:00:00.000Z", updatedAt: "2026-08-12T00:00:00.000Z" })).toThrow("charges, and payouts");
  });
  it("keeps provider mappings server-managed", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260812000600_create_billing_provider_mappings.sql"), "utf8").toLowerCase();
    expect(sql).toContain("create table if not exists landlord_payment_accounts");
    expect(sql).toContain("create table if not exists billing_customer_references");
    expect(sql).not.toContain("landlord_payment_accounts_owner_insert");
    expect(sql).toContain("service-role operations");
  });
});
