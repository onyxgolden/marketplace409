import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedPrivateFinancingApplication", () => ({
  createAuthenticatedPrivateFinancingApplication: mocks.authenticate,
}));

import { GET } from "./route";

const accountRow = {
  id: "pf_acct_1",
  product: "seller_financing",
  status: "active",
  opened_date: "2022-03-23",
  origination_principal_cents: 5_500_000,
  late_fee_policy: "disabled",
  platform_fee_cents: 0,
  fee_payer: "lender",
};
const componentVersionRows = [
  { owner_id: "owner-1", id: "pf_comp_1", account_id: "pf_acct_1", component_key: "ib", label: "Interest-bearing note", original_principal_cents: 4_500_000, rate_bps: 300, day_count_convention: "actual_365", scheduled_component_amount_cents: 43_452, allocation_priority: 1, effective_date: "2022-03-23", version_number: 1 },
  { owner_id: "owner-1", id: "pf_comp_2", account_id: "pf_acct_1", component_key: "zi", label: "Zero-interest note", original_principal_cents: 1_000_000, rate_bps: 0, day_count_convention: "actual_365", scheduled_component_amount_cents: 8_333, allocation_priority: 2, effective_date: "2022-03-23", version_number: 1 },
];
const termsVersionRows = [
  {
    owner_id: "owner-1", id: "pf_terms_1", account_id: "pf_acct_1", version_number: 1, payment_frequency: "monthly",
    first_payment_due_date: "2022-04-23", regular_scheduled_payment_amount_cents: 51_785, maturity_date: null,
    allocation_policy: "scheduled_component_order", extra_payment_allocation_policy: "highest_rate_first_extra",
    prepayment_policy: "allowed_without_penalty_does_not_advance_due_date", day_count_convention: "actual_365",
    effective_date: "2022-03-23", acting_seller_id: "owner-1", amendment_reason: null,
  },
];
const openEventRow = {
  id: "pf_evt_open", owner_id: "owner-1", account_id: "pf_acct_1", event_type: "account_opened",
  event_origin: "interactive_user", created_by: "owner-1", ledger_sequence: 1, effective_date: "2022-03-23",
  recorded_at: "2022-03-23T00:00:00Z",
};
const membershipRow = { account_id: "pf_acct_1", borrower_id: "brw_1", status: "active" };
const borrowerRow = { id: "brw_1", full_name: "Jordan Ellis", email: "jordan@example.com" };
const policyRow = { account_id: "pf_acct_1", payment_acceptance_policy: "partial_allowed" };

// One table per lookup; each supports select().eq()/in()/order() chains ending in either a direct
// then()/await (bulk selects) or explicit resolution.
function buildClient({
  accounts = [accountRow],
  accountsError = null,
  memberships = [membershipRow],
  borrowers = [borrowerRow],
  policies = [policyRow],
  events = [openEventRow],
  componentVersions = componentVersionRows,
  termsVersions = termsVersionRows,
} = {}) {
  function chain(data, error = null) {
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      order: () => Promise.resolve({ data, error }),
      then: (resolve) => resolve({ data, error }),
    };
    return query;
  }
  return {
    from: vi.fn((table) => {
      if (table === "private_financing_accounts") return chain(accounts, accountsError);
      if (table === "private_financing_account_borrowers") return chain(memberships);
      if (table === "private_financing_borrowers") return chain(borrowers);
      if (table === "private_financing_current_servicing_policy") return chain(policies);
      if (table === "private_financing_events") return chain(events);
      if (table === "private_financing_components") return chain(componentVersions);
      if (table === "private_financing_account_terms_versions") return chain(termsVersions);
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

describe("GET /api/private-financing/accounts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists accounts enriched with a real joined borrower label, policy, and computed balance", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient() });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accounts).toHaveLength(1);
    const account = body.accounts[0];
    expect(account.id).toBe("pf_acct_1");
    expect(account.product).toBe("seller_financing");
    expect(account.borrowerLabel).toBe("Jordan Ellis");
    expect(account.paymentAcceptancePolicy).toBe("partial_allowed");
    expect(account.balance.totalPrincipalRemainingCents).toBe(5_500_000);
    expect(account.balance.regularScheduledPaymentCents).toBe(43_452 + 8_333);
    expect(account.dueDateTrackingAvailable).toBe(false);
  });

  it("never fabricates a due date or past-due status -- dueDateTrackingAvailable is always explicitly false", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient() });
    const body = await (await GET()).json();
    expect(body.accounts[0]).not.toHaveProperty("dueDate");
    expect(body.accounts[0]).not.toHaveProperty("nextDueDate");
    expect(body.accounts[0]).not.toHaveProperty("pastDue");
    expect(body.accounts[0].dueDateTrackingAvailable).toBe(false);
  });

  it("returns a null borrowerLabel (never a placeholder string) when no borrower has been added yet", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient({ memberships: [], borrowers: [] }) });
    const body = await (await GET()).json();
    expect(body.accounts[0].borrowerLabel).toBeNull();
  });

  it("excludes a revoked membership from the borrower label", async () => {
    mocks.authenticate.mockResolvedValue({
      user: { id: "owner-1" }, effectiveOwnerId: "owner-1",
      supabaseClient: buildClient({ memberships: [{ ...membershipRow, status: "revoked" }] }),
    });
    const body = await (await GET()).json();
    expect(body.accounts[0].borrowerLabel).toBeNull();
  });

  it("returns a null balance when the account has no events yet, without erroring", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient({ events: [] }) });
    const body = await (await GET()).json();
    expect(body.accounts[0].balance).toBeNull();
  });

  it("returns an empty accounts array without querying joined tables when the workspace has zero accounts", async () => {
    const client = buildClient({ accounts: [] });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });

    const body = await (await GET()).json();
    expect(body.accounts).toEqual([]);
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("reports viewerRole 'primary_owner' when the caller's own id resolves as the effective owner", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient({ accounts: [] }) });
    const body = await (await GET()).json();
    expect(body.viewerRole).toBe("primary_owner");
  });

  it("reports viewerRole 'co_owner' when the caller's effective owner id resolves to someone else", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "co-owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient({ accounts: [] }) });
    const body = await (await GET()).json();
    expect(body.viewerRole).toBe("co_owner");
  });

  it("returns 503 with a stable code -- never a 200 -- when the schema doesn't exist remotely yet", async () => {
    const client = buildClient({ accounts: null, accountsError: { code: "42P01", message: 'relation "private_financing_accounts" does not exist' } });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });

    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("private_financing_schema_unavailable");
    expect(JSON.stringify(body)).not.toContain("42P01");
    expect(JSON.stringify(body)).not.toContain("relation");
  });

  it("is distinguishable from a genuine empty account list: 503+code vs. 200+[]", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient({ accounts: [] }) });
    const emptyResponse = await GET();
    expect(emptyResponse.status).toBe(200);
    expect((await emptyResponse.json()).accounts).toEqual([]);

    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({
      user: { id: "owner-1" }, effectiveOwnerId: "owner-1",
      supabaseClient: buildClient({ accounts: null, accountsError: { code: "42P01", message: "relation does not exist" } }),
    });
    const unavailableResponse = await GET();
    expect(unavailableResponse.status).toBe(503);
  });

  it("returns a 500 for a genuine, unrelated database error on the accounts query", async () => {
    const client = buildClient({ accounts: null, accountsError: { code: "53300", message: "too many connections" } });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });

    const response = await GET();
    expect(response.status).toBe(500);
  });

  it("propagates the 401 response from the auth factory unchanged", async () => {
    mocks.authenticate.mockResolvedValue({ response: new Response(JSON.stringify({ error: "Authenticated owner id is required." }), { status: 401 }) });

    const response = await GET();
    expect(response.status).toBe(401);
  });
});
