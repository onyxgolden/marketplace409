import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedPrivateFinancingApplication", () => ({
  createAuthenticatedPrivateFinancingApplication: mocks.authenticate,
}));

import { GET } from "./route";
import { encodeEventHistoryCursor } from "@/domains/private-financing/eventHistoryCursor";

const params = Promise.resolve({ accountId: "pf_acct_1" });

function req(query = "") {
  return new Request(`https://test/api/private-financing/accounts/pf_acct_1/events${query}`);
}

function makeEventRow(ledgerSequence) {
  return {
    id: `pf_evt_${ledgerSequence}`, event_type: "payment_posted", event_origin: "manual_import", created_by: null,
    source_reference: null, idempotency_key: `import-${ledgerSequence}`, ledger_sequence: ledgerSequence,
    effective_date: "2022-04-23", recorded_at: "2022-04-23T00:00:00Z", reverses_event_id: null, reason: null,
    internal_note: "seller note", borrower_visible_explanation: null, amount_cents: 100, interest_paid_cents: 0,
    interest_bearing_principal_paid_cents: 100, zero_interest_principal_paid_cents: 0, unallocated_cents: 0,
    principal_remaining_interest_bearing_cents: 0, principal_remaining_zero_interest_cents: 0, payment_method: null,
    component_type: null, correction_basis: null, delta_cents: null,
    corrected_component_principal_remaining_cents_after: null, interest_bearing_delta_cents: null,
    zero_interest_delta_cents: null, closure_reason: null, payoff_concession_event_id: null,
  };
}

// Records the filters applied (eq/gt) and the limit requested, then resolves with `rows` sliced to the
// requested limit -- close enough to real keyset-pagination behavior to prove the route's own paging
// logic (hasMore/nextCursor/slicing) without a real database.
function buildClient(rows, { error = null } = {}) {
  const calls = { eq: [], gt: [], limit: null };
  const query = {
    select: () => query,
    eq: (...args) => {
      calls.eq.push(args);
      return query;
    },
    gt: (...args) => {
      calls.gt.push(args);
      return query;
    },
    order: () => query,
    limit: (n) => {
      calls.limit = n;
      return Promise.resolve({ data: error ? null : rows.slice(0, n), error });
    },
  };
  return { client: { from: vi.fn(() => query) }, calls };
}

describe("GET /api/private-financing/accounts/[accountId]/events", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists the account's ledger history, including seller-only fields like internalNote", async () => {
    const { client } = buildClient([makeEventRow(1)]);
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });

    const response = await GET(req(), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].internalNote).toBe("seller note");
    expect(body.events[0].ledgerSequence).toBe(1);
  });

  it("defaults to the standard page size and reports hasMore:false when fewer rows exist than the page size", async () => {
    const { client, calls } = buildClient([makeEventRow(1), makeEventRow(2)]);
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });

    const body = await (await GET(req(), { params })).json();
    expect(calls.limit).toBe(51); // pageSize (50) + 1 lookahead row
    expect(body.pageInfo).toEqual({ hasMore: false, nextCursor: null, pageSize: 50 });
    expect(body.events).toHaveLength(2);
  });

  it("honors an explicit, bounded limit and reports hasMore:true with a usable nextCursor when more rows exist", async () => {
    const rows = [makeEventRow(1), makeEventRow(2), makeEventRow(3)]; // 3 rows, limit=2 -> lookahead fetches 3
    const { client } = buildClient(rows);
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });

    const body = await (await GET(req("?limit=2"), { params })).json();
    expect(body.events).toHaveLength(2);
    expect(body.events.map((e) => e.ledgerSequence)).toEqual([1, 2]);
    expect(body.pageInfo.hasMore).toBe(true);
    expect(typeof body.pageInfo.nextCursor).toBe("string");
  });

  it("clamps a limit above the explicit maximum rather than returning unbounded history", async () => {
    const { client, calls } = buildClient([makeEventRow(1)]);
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });

    await GET(req("?limit=999999"), { params });
    expect(calls.limit).toBe(201); // MAX_EVENT_HISTORY_PAGE_SIZE (200) + 1 lookahead row
  });

  it("applies a valid cursor as a gt(ledger_sequence, ...) filter, scoped to the requesting account", async () => {
    const { client, calls } = buildClient([makeEventRow(6)]);
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });

    const cursor = encodeEventHistoryCursor({ accountId: "pf_acct_1", ledgerSequence: 5 });
    const response = await GET(req(`?cursor=${encodeURIComponent(cursor)}`), { params });
    expect(response.status).toBe(200);
    expect(calls.gt).toEqual([["ledger_sequence", 5]]);
    expect(calls.eq).toEqual([["account_id", "pf_acct_1"]]);
  });

  it("fails closed (400) on a malformed cursor rather than silently restarting from page one", async () => {
    const { client } = buildClient([makeEventRow(1)]);
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });

    const response = await GET(req("?cursor=not-a-valid-cursor!!!"), { params });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("private_financing_invalid_cursor");
  });

  it("rejects a cursor issued for a different account (cross-account cursor reuse)", async () => {
    const { client } = buildClient([makeEventRow(1)]);
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });

    const cursorForOtherAccount = encodeEventHistoryCursor({ accountId: "pf_acct_OTHER", ledgerSequence: 5 });
    const response = await GET(req(`?cursor=${encodeURIComponent(cursorForOtherAccount)}`), { params });
    expect(response.status).toBe(400);
  });

  it("returns 503 with a stable code, never a 200, when the schema doesn't exist remotely yet", async () => {
    const { client } = buildClient([], { error: { code: "42P01", message: 'relation "private_financing_events" does not exist' } });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });

    const response = await GET(req(), { params });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("private_financing_schema_unavailable");
    expect(JSON.stringify(body)).not.toContain("42P01");
  });

  it("returns a 500 for a genuine, unrelated database error", async () => {
    const { client } = buildClient([], { error: { code: "53300", message: "too many connections" } });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });

    const response = await GET(req(), { params });
    expect(response.status).toBe(500);
  });

  it("propagates the 401 response from the auth factory unchanged", async () => {
    mocks.authenticate.mockResolvedValue({ response: new Response(JSON.stringify({ error: "Authenticated owner id is required." }), { status: 401 }) });

    const response = await GET(req(), { params });
    expect(response.status).toBe(401);
  });
});
