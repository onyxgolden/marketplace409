import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authenticated = { user: { id: "owner_1", email: "owner@example.com" }, supabaseClient: {} };
const unauthenticatedResponse = { response: new Response(JSON.stringify({ error: "Authenticated owner id is required." }), { status: 401 }) };
const createAuthenticatedForgeApplication = vi.fn(async () => authenticated);
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: (...args) => createAuthenticatedForgeApplication(...args) }));

const createConnectedAccount = vi.fn();
const createOnboardingLink = vi.fn();
const retrieveAccountStatus = vi.fn();
const provider = { mode: "test", createConnectedAccount, createOnboardingLink, retrieveAccountStatus };
vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({ createStripeBillingProvider: () => provider }));

function chain(result) {
  const node = { select: vi.fn(() => node), eq: vi.fn(() => node), maybeSingle: vi.fn(async () => result), single: vi.fn(async () => result), upsert: vi.fn(() => node), update: vi.fn(() => node) };
  return node;
}
let db;
const createRentalWebhookClient = vi.fn(() => db);
vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: (...args) => createRentalWebhookClient(...args) }));

import { GET, POST } from "./route.js";

describe("stripe-account route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAuthenticatedForgeApplication.mockResolvedValue(authenticated);
    provider.mode = "test";
  });

  it("rejects unauthenticated callers on GET and POST", async () => {
    createAuthenticatedForgeApplication.mockResolvedValue(unauthenticatedResponse);
    expect((await GET()).status).toBe(401);
    expect((await POST(new Request("https://test/api", { method: "POST" }))).status).toBe(401);
  });

  it("refuses to start onboarding when the landlord's account email is missing, with a safe generic error", async () => {
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "owner_1", email: "" }, supabaseClient: {} });
    const response = await POST(new NextRequest("https://forge.test/api/rental/stripe-account", { method: "POST" }));
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toBe("A verified account email is required before starting Stripe onboarding.");
    expect(body.error).not.toMatch(/internal|undefined|null|error:|typeerror/i);
    expect(createConnectedAccount).not.toHaveBeenCalled();
  });

  it("creates a connected account only when no provider_account_id already exists for the current mode (idempotency guard)", async () => {
    const found = chain({ data: null, error: null });
    const upserted = chain({ data: { owner_id: "owner_1", provider_account_id: "acct_kent" }, error: null });
    let calls = 0;
    db = { from: vi.fn(() => (++calls === 1 ? found : upserted)) };
    createConnectedAccount.mockResolvedValue({ connectedAccountId: "acct_kent" });
    createOnboardingLink.mockResolvedValue({ url: "https://connect.stripe.com/setup/acct_kent" });

    const response = await POST(new NextRequest("https://forge.test/api/rental/stripe-account", { method: "POST" }));
    const body = await response.json();

    expect(createConnectedAccount).toHaveBeenCalledTimes(1);
    expect(createConnectedAccount).toHaveBeenCalledWith("owner_1", "stripe-landlord:v4:test:owner_1", { contactEmail: "owner@example.com" });
    expect(found.eq).toHaveBeenCalledWith("provider_mode", "test");
    expect(upserted.upsert).toHaveBeenCalledWith(expect.objectContaining({ provider_mode: "test" }), { onConflict: "owner_id,provider,provider_mode" });
    expect(body).toEqual({ success: true, url: "https://connect.stripe.com/setup/acct_kent" });
  });

  // Regression guard for the live incident: a rejected Stripe account-creation call (e.g. the real
  // account_controller_unsupported_configuration failure) must never reach the database write, and
  // a subsequent retry must be safe to reuse — never a second Stripe account for the same owner.
  it("never writes landlord_payment_accounts when Stripe account creation fails, and a retry reuses the same deterministic idempotency key", async () => {
    const found = chain({ data: null, error: null });
    db = { from: vi.fn(() => found) };
    createConnectedAccount.mockRejectedValueOnce(new Error("account_controller_unsupported_configuration"));

    const failedResponse = await POST(new NextRequest("https://forge.test/api/rental/stripe-account", { method: "POST" }));
    expect(failedResponse.status).toBe(500);
    expect(found.upsert).not.toHaveBeenCalled();

    const upserted = chain({ data: { owner_id: "owner_1", provider_account_id: "acct_kent" }, error: null });
    let calls = 0;
    db = { from: vi.fn(() => (++calls === 1 ? found : upserted)) };
    createConnectedAccount.mockResolvedValueOnce({ connectedAccountId: "acct_kent" });
    createOnboardingLink.mockResolvedValue({ url: "https://connect.stripe.com/setup/acct_kent" });
    const retryResponse = await POST(new NextRequest("https://forge.test/api/rental/stripe-account", { method: "POST" }));
    expect(retryResponse.status).toBe(200);

    expect(createConnectedAccount).toHaveBeenCalledTimes(2);
    const [firstKey] = createConnectedAccount.mock.calls[0].slice(1);
    const [secondKey] = createConnectedAccount.mock.calls[1].slice(1);
    expect(firstKey).toBe(secondKey);
    expect(upserted.upsert).toHaveBeenCalledTimes(1);
  });

  it("a preserved test connected-account row does not block creating a live connected account", async () => {
    provider.mode = "live";
    const found = chain({ data: null, error: null }); // the live-mode row lookup finds nothing, even though a test row exists elsewhere
    const upserted = chain({ data: { owner_id: "owner_1", provider_mode: "live", provider_account_id: "acct_live_kent" }, error: null });
    let calls = 0;
    db = { from: vi.fn(() => (++calls === 1 ? found : upserted)) };
    createConnectedAccount.mockResolvedValue({ connectedAccountId: "acct_live_kent" });
    createOnboardingLink.mockResolvedValue({ url: "https://connect.stripe.com/setup/acct_live_kent" });

    const response = await POST(new NextRequest("https://forge.test/api/rental/stripe-account", { method: "POST" }));
    const body = await response.json();

    expect(found.eq).toHaveBeenCalledWith("provider_mode", "live");
    expect(createConnectedAccount).toHaveBeenCalledWith("owner_1", "stripe-landlord:v4:live:owner_1", { contactEmail: "owner@example.com" });
    expect(upserted.upsert).toHaveBeenCalledWith(expect.objectContaining({ provider_mode: "live" }), { onConflict: "owner_id,provider,provider_mode" });
    expect(body).toEqual({ success: true, url: "https://connect.stripe.com/setup/acct_live_kent" });
  });

  it("does not create a second Stripe account when one already exists for the current mode — only requests a fresh onboarding link", async () => {
    const found = chain({ data: { owner_id: "owner_1", provider_account_id: "acct_kent" }, error: null });
    db = { from: vi.fn(() => found) };
    createOnboardingLink.mockResolvedValue({ url: "https://connect.stripe.com/setup/acct_kent/refresh" });

    const response = await POST(new NextRequest("https://forge.test/api/rental/stripe-account", { method: "POST" }));
    const body = await response.json();

    expect(createConnectedAccount).not.toHaveBeenCalled();
    expect(createOnboardingLink).toHaveBeenCalledWith({ ownerId: "owner_1", connectedAccountId: "acct_kent" },
      "https://forge.test/forge/rental?stripe=returned", "https://forge.test/forge/rental?stripe=refresh");
    expect(body).toEqual({ success: true, url: "https://connect.stripe.com/setup/acct_kent/refresh" });
  });

  it("refreshing a failed/expired onboarding link always requests a brand-new one from Stripe", async () => {
    const found = chain({ data: { owner_id: "owner_1", provider_account_id: "acct_kent" }, error: null });
    db = { from: vi.fn(() => found) };
    createOnboardingLink.mockResolvedValueOnce({ url: "https://connect.stripe.com/setup/acct_kent/1" })
      .mockResolvedValueOnce({ url: "https://connect.stripe.com/setup/acct_kent/2" });

    const first = await (await POST(new NextRequest("https://forge.test/api/rental/stripe-account", { method: "POST" }))).json();
    const second = await (await POST(new NextRequest("https://forge.test/api/rental/stripe-account", { method: "POST" }))).json();
    expect(first.url).not.toBe(second.url);
    expect(createOnboardingLink).toHaveBeenCalledTimes(2);
  });

  it("syncs status from Stripe using the shared truthful status mapping, never marking enabled from an id alone", async () => {
    const found = chain({ data: { owner_id: "owner_1", provider_account_id: "acct_kent" }, error: null });
    const updated = chain({ data: { owner_id: "owner_1", status: "onboarding" }, error: null });
    let calls = 0;
    db = { from: vi.fn(() => (++calls === 1 ? found : updated)) };
    retrieveAccountStatus.mockResolvedValue({
      mode: "test", accountClosed: false, chargesEnabled: false, payoutsEnabled: false, achDebitEnabled: false,
      cardPaymentsEnabled: false, onboardingStarted: false, requirementsDue: [],
    });

    const response = await GET();
    const body = await response.json();

    expect(retrieveAccountStatus).toHaveBeenCalledWith({ ownerId: "owner_1", connectedAccountId: "acct_kent" });
    expect(updated.eq).toHaveBeenCalledWith("provider_mode", "test");
    const [updatePayload] = updated.update.mock.calls[0];
    expect(updatePayload.status).not.toBe("enabled");
    expect(body.success).toBe(true);
  });

  it("does not call Stripe at all when the landlord has no account row yet for the current mode", async () => {
    const found = chain({ data: null, error: null });
    db = { from: vi.fn(() => found) };
    const response = await GET();
    const body = await response.json();
    expect(retrieveAccountStatus).not.toHaveBeenCalled();
    expect(found.eq).toHaveBeenCalledWith("provider_mode", "test");
    expect(body).toEqual({ success: true, account: null });
  });
});
