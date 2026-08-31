import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedPrivateFinancingApplication", () => ({
  createAuthenticatedPrivateFinancingApplication: mocks.authenticate,
}));

import { GET } from "./route";

const params = Promise.resolve({ accountId: "pf_acct_1" });

function req() {
  return new Request("https://test/api/private-financing/accounts/pf_acct_1");
}

const accountRow = {
  id: "pf_acct_1", product: "seller_financing", status: "active", opened_date: "2022-03-23",
  origination_principal_cents: 5_500_000, late_fee_policy: "disabled",
  interest_day_count_convention: "actual_365", platform_fee_cents: 0, fee_payer: "lender",
};
// The read-model view exposing only the CURRENT version of each component -- shaped for rowToComponent.
const currentComponentRows = [
  { id: "pf_comp_1", component_key: "ib", label: "Interest-bearing note", version_number: 1, original_principal_cents: 4_500_000, rate_bps: 300, day_count_convention: "actual_365", scheduled_component_amount_cents: 43_452, allocation_priority: 1, effective_date: "2022-03-23", amendment_reason: null },
  { id: "pf_comp_2", component_key: "zi", label: "Zero-interest note", version_number: 1, original_principal_cents: 1_000_000, rate_bps: 0, day_count_convention: "actual_365", scheduled_component_amount_cents: 8_333, allocation_priority: 2, effective_date: "2022-03-23", amendment_reason: null },
];
// The FULL version history -- shaped for mapComponentRow, used to compute the real replayed balance.
const componentVersionRows = [
  { owner_id: "owner-1", id: "pf_comp_1", account_id: "pf_acct_1", component_key: "ib", label: "Interest-bearing note", original_principal_cents: 4_500_000, rate_bps: 300, day_count_convention: "actual_365", scheduled_component_amount_cents: 43_452, allocation_priority: 1, effective_date: "2022-03-23", version_number: 1 },
  { owner_id: "owner-1", id: "pf_comp_2", account_id: "pf_acct_1", component_key: "zi", label: "Zero-interest note", original_principal_cents: 1_000_000, rate_bps: 0, day_count_convention: "actual_365", scheduled_component_amount_cents: 8_333, allocation_priority: 2, effective_date: "2022-03-23", version_number: 1 },
];
const termsVersionRow = {
  owner_id: "owner-1", id: "pf_terms_1", account_id: "pf_acct_1", version_number: 1, payment_frequency: "monthly",
  first_payment_due_date: "2022-04-23", regular_scheduled_payment_amount_cents: 51_785, maturity_date: null,
  allocation_policy: "scheduled_component_order", extra_payment_allocation_policy: "highest_rate_first_extra",
  prepayment_policy: "allowed_without_penalty_does_not_advance_due_date", day_count_convention: "actual_365",
  effective_date: "2022-03-23", acting_seller_id: "owner-1", amendment_reason: null,
};
const policyRow = { version: 1, payment_acceptance_policy: "partial_allowed", effective_at: "2022-03-23T00:00:00Z", acting_seller_id: "owner-1", reason: "account_opened" };
const openEventRow = {
  id: "pf_evt_open", owner_id: "owner-1", account_id: "pf_acct_1", event_type: "account_opened",
  event_origin: "interactive_user", created_by: "owner-1", ledger_sequence: 1, effective_date: "2022-03-23",
  recorded_at: "2022-03-23T00:00:00Z",
};
const membershipRow = { id: "acctbrw_1", borrower_id: "brw_1", role: "primary_borrower", status: "active" };
const borrowerRow = { id: "brw_1", full_name: "Jordan Ellis", email: "jordan@example.com" };

// One table/view per lookup; each supports the exact chain the route calls (select -> eq [-> eq] [-> maybeSingle/order]).
function buildClient({
  account = accountRow,
  accountError = null,
  components = currentComponentRows,
  policy = policyRow,
  componentVersions = componentVersionRows,
  termsVersions = [termsVersionRow],
  currentTerms = termsVersionRow,
  events = [openEventRow],
  memberships = [membershipRow],
  borrowers = [borrowerRow],
} = {}) {
  function chain(data, error = null) {
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      order: () => Promise.resolve({ data, error }),
      maybeSingle: () => Promise.resolve({ data, error }),
      then: (resolve) => resolve({ data, error }),
    };
    return query;
  }
  return {
    from: vi.fn((table) => {
      if (table === "private_financing_accounts") return chain(account, accountError);
      if (table === "private_financing_current_components") return chain(components);
      if (table === "private_financing_current_servicing_policy") return chain(policy);
      if (table === "private_financing_components") return chain(componentVersions);
      if (table === "private_financing_account_terms_versions") return chain(termsVersions);
      if (table === "private_financing_current_account_terms") return chain(currentTerms);
      if (table === "private_financing_events") return chain(events);
      if (table === "private_financing_account_borrowers") return chain(memberships);
      if (table === "private_financing_borrowers") return chain(borrowers);
      if (table === "private_financing_online_payment_settings") return chain(null);
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

describe("GET /api/private-financing/accounts/[accountId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the account (including day-count convention), its current components, current policy, and a computed balance", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient() });

    const response = await GET(req(), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.account).toEqual({
      id: "pf_acct_1", product: "seller_financing", status: "active", openedDate: "2022-03-23",
      originationPrincipalCents: 5_500_000, lateFeePolicy: "disabled", interestDayCountConvention: "actual_365",
      platformFeeCents: 0, feePayer: "lender",
    });
    expect(body.components).toHaveLength(2);
    expect(body.servicingPolicy).toEqual({
      version: 1, paymentAcceptancePolicy: "partial_allowed", effectiveAt: "2022-03-23T00:00:00Z",
      actingSellerId: "owner-1", reason: "account_opened",
    });
    expect(body.balance.remainingPrincipalByComponentCents).toEqual({ ib: 4_500_000, zi: 1_000_000 });
    expect(body.balance.cumulativePrincipalForgivenCents).toBe(0);
    expect(body.balance.closed).toBe(false);
  });

  it("returns each component separately -- never merging one component's terms into another's", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient() });
    const body = await (await GET(req(), { params })).json();
    const keys = body.components.map((component) => component.componentKey);
    expect(keys).toEqual(["ib", "zi"]);
    expect(body.components[0].rateBps).toBe(300);
    expect(body.components[1].rateBps).toBe(0);
  });

  it("returns account terms and a computed due state for an account within V1's supported envelope", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient() });
    const body = await (await GET(req(), { params })).json();
    expect(body.accountTerms.paymentFrequency).toBe("monthly");
    expect(body.dueState).not.toBeNull();
    expect(body.dueState).toHaveProperty("currentAmountDueCents");
    expect(body.dueState).toHaveProperty("nextDueDate");
  });

  it("returns a real payoff estimate for an open account, computed through today, excluding late charges", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient() });
    const body = await (await GET(req(), { params })).json();
    expect(body.payoffEstimate).not.toBeNull();
    expect(body.payoffEstimate.lateChargesCents).toBe(0);
    expect(body.payoffEstimate.isEstimate).toBe(true);
    expect(body.payoffEstimate.calculatedThroughDate).toBe(new Date().toISOString().slice(0, 10));
  });

  it("returns a null payoffEstimate when there is no balance yet", async () => {
    mocks.authenticate.mockResolvedValue({
      user: { id: "owner-1" }, effectiveOwnerId: "owner-1",
      supabaseClient: buildClient({ events: [] }),
    });
    const body = await (await GET(req(), { params })).json();
    expect(body.payoffEstimate).toBeNull();
  });

  it("returns a null payoffEstimate (never a fabricated $0 late-charge figure) for an account with late fees enabled, since V1 has no late-fee calculation engine yet", async () => {
    mocks.authenticate.mockResolvedValue({
      user: { id: "owner-1" }, effectiveOwnerId: "owner-1",
      supabaseClient: buildClient({ account: { ...accountRow, late_fee_policy: "enabled" } }),
    });
    const body = await (await GET(req(), { params })).json();
    expect(body.payoffEstimate).toBeNull();
    // The account's own real policy is still reported honestly elsewhere on the response -- this is not a
    // schema-unavailable or error state, only the payoff estimate specifically is withheld.
    expect(body.account.lateFeePolicy).toBe("enabled");
  });

  it("returns authorized borrower membership summaries with no hidden identity fields", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient() });
    const body = await (await GET(req(), { params })).json();
    expect(body.borrowers).toEqual([{
      membershipId: "acctbrw_1", borrowerId: "brw_1", displayName: "Jordan Ellis",
      email: "jordan@example.com", role: "primary_borrower", status: "active",
    }]);
    for (const key of ["ssn", "socialSecurityNumber", "birthDate", "dateOfBirth", "phone", "authUserId"]) {
      expect(body.borrowers[0]).not.toHaveProperty(key);
    }
  });

  it("returns an empty borrowers array when no membership exists yet", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient({ memberships: [] }) });
    const body = await (await GET(req(), { params })).json();
    expect(body.borrowers).toEqual([]);
  });

  it("returns 404 when the account doesn't exist or isn't visible under RLS -- both cases identical, no side channel", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient({ account: null }) });

    const response = await GET(req(), { params });
    expect(response.status).toBe(404);
  });

  it("returns 503 with a stable code, never a 200, when the schema doesn't exist remotely yet", async () => {
    mocks.authenticate.mockResolvedValue({
      user: { id: "owner-1" }, effectiveOwnerId: "owner-1",
      supabaseClient: buildClient({ account: null, accountError: { code: "42P01", message: 'relation "private_financing_accounts" does not exist' } }),
    });

    const response = await GET(req(), { params });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("private_financing_schema_unavailable");
    expect(JSON.stringify(body)).not.toContain("42P01");
    expect(JSON.stringify(body)).not.toContain("relation");
  });

  it("returns a 500 for a genuine, unrelated database error on the account lookup", async () => {
    mocks.authenticate.mockResolvedValue({
      user: { id: "owner-1" }, effectiveOwnerId: "owner-1",
      supabaseClient: buildClient({ account: null, accountError: { code: "53300", message: "too many connections" } }),
    });

    const response = await GET(req(), { params });
    expect(response.status).toBe(500);
  });

  it("returns null balance, null payoffEstimate, no servicing policy, no account terms/due state, and no components when the account has no events, policy, components, or terms rows yet", async () => {
    mocks.authenticate.mockResolvedValue({
      user: { id: "owner-1" }, effectiveOwnerId: "owner-1",
      supabaseClient: buildClient({ events: [], policy: null, components: [], componentVersions: [], termsVersions: [], currentTerms: null }),
    });

    const response = await GET(req(), { params });
    const body = await response.json();
    expect(body.balance).toBeNull();
    expect(body.payoffEstimate).toBeNull();
    expect(body.servicingPolicy).toBeNull();
    expect(body.components).toEqual([]);
    expect(body.accountTerms).toBeNull();
    expect(body.dueState).toBeNull();
  });

  it("propagates the 401 response from the auth factory unchanged", async () => {
    mocks.authenticate.mockResolvedValue({ response: new Response(JSON.stringify({ error: "Authenticated owner id is required." }), { status: 401 }) });

    const response = await GET(req(), { params });
    expect(response.status).toBe(401);
  });
});
