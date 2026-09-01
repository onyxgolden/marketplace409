import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, rpc, from } = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, rpc, from }),
}));

import { GET, summarizeBorrowerEvents } from "./route";

describe("private financing borrower portal summary", () => {
  it("includes a later principal correction instead of showing the preceding payment balance", () => {
    const summary = summarizeBorrowerEvents([
      { event_type: "payment_posted", amount_cents: 60000, interest_paid_cents: 10000, principal_remaining_interest_bearing_cents: 3300000, principal_remaining_zero_interest_cents: 0 },
      { event_type: "principal_correction", component_type: "interest_bearing", corrected_component_principal_remaining_cents_after: 3184347 },
    ]);
    expect(summary).toEqual({ paymentCount: 1, totalPaidCents: 60000, interestPaidCents: 10000, principalRemainingCents: 3184347 });
  });
});

// A chainable stand-in for a Supabase PostgrestFilterBuilder: .select()/.eq()/.order() all return the
// same builder, and it resolves to `result` whether awaited directly (the memberships list query) or
// via .maybeSingle() (the single-row account/terms/settings queries).
function chain(result) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    maybeSingle: async () => result,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function request(query) {
  return new Request(`http://localhost/api/private-financing/portal${query}`);
}

describe("GET /api/private-financing/portal", () => {
  beforeEach(() => {
    getUser.mockReset();
    rpc.mockReset();
    from.mockReset();
  });

  it("carries the invited email into the sign-in URL when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(request("?email=Borrower@Example.com"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.invitedEmail).toBe("borrower@example.com");
    expect(body.signInUrl).toBe("/auth?next=%2Fforge%2Fprivate-financing%2Fportal&email=borrower%40example.com");
  });

  it("matches the invited email to the authenticated user and returns their active accounts", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user_1", email: "borrower@example.com" } }, error: null });
    rpc.mockImplementation((fn) => {
      if (fn === "claim_private_financing_borrower_portal") {
        return Promise.resolve({ data: { signedInEmail: "borrower@example.com", claimedIdentityCount: 1, activatedMembershipCount: 1 }, error: null });
      }
      if (fn === "read_private_financing_borrower_events") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    });
    from.mockImplementation((table) => {
      if (table === "private_financing_account_borrowers") return chain({ data: [{ account_id: "acct_1", role: "primary_borrower", status: "active" }], error: null });
      if (table === "private_financing_accounts") return chain({ data: { id: "acct_1", product: "installment", status: "active", opened_date: "2026-01-01", origination_principal_cents: 1000000 }, error: null });
      if (table === "private_financing_current_account_terms") return chain({ data: { regular_scheduled_payment_amount_cents: 50000 }, error: null });
      if (table === "private_financing_online_payment_settings") return chain({ data: { enabled: true }, error: null });
      throw new Error(`unexpected table ${table}`);
    });

    const response = await GET(request("?email=borrower@example.com"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.mismatched).toBe(false);
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].account.id).toBe("acct_1");
  });

  it("reports a mismatch without exposing other accounts when the signed-in email differs from the invitation", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user_2", email: "someoneelse@example.com" } }, error: null });
    rpc.mockResolvedValue({ data: { signedInEmail: "someoneelse@example.com", claimedIdentityCount: 0, activatedMembershipCount: 0 }, error: null });
    from.mockImplementation((table) => {
      if (table === "private_financing_account_borrowers") return chain({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });

    const response = await GET(request("?email=borrower@example.com"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.mismatched).toBe(true);
    expect(body.invitedEmail).toBe("borrower@example.com");
    expect(body.email).toBe("someoneelse@example.com");
    expect(body.accounts).toEqual([]);
  });

  it("is exact on retry: a second call with nothing new to claim still returns the same active accounts", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user_1", email: "borrower@example.com" } }, error: null });
    rpc.mockImplementation((fn) => {
      if (fn === "claim_private_financing_borrower_portal") {
        return Promise.resolve({ data: { signedInEmail: "borrower@example.com", claimedIdentityCount: 0, activatedMembershipCount: 0 }, error: null });
      }
      if (fn === "read_private_financing_borrower_events") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    });
    from.mockImplementation((table) => {
      if (table === "private_financing_account_borrowers") return chain({ data: [{ account_id: "acct_1", role: "primary_borrower", status: "active" }], error: null });
      if (table === "private_financing_accounts") return chain({ data: { id: "acct_1", product: "installment", status: "active", opened_date: "2026-01-01", origination_principal_cents: 1000000 }, error: null });
      if (table === "private_financing_current_account_terms") return chain({ data: { regular_scheduled_payment_amount_cents: 50000 }, error: null });
      if (table === "private_financing_online_payment_settings") return chain({ data: { enabled: true }, error: null });
      throw new Error(`unexpected table ${table}`);
    });

    const response = await GET(request("?email=borrower@example.com"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.claim.claimedIdentityCount).toBe(0);
    expect(body.accounts).toHaveLength(1);
    expect(body.mismatched).toBe(false);
  });
});
