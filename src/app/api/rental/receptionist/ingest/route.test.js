// Tests for POST /api/rental/receptionist/ingest.
// Fix round 2: nonce lifecycle (P1-2) and draft-conflict fetch (P1-3).
// Fix round 3: exclusive lease-token claims (P1-1) and honest
// completion (P1-2) — the fake Supabase mirrors the SQL lifecycle
// (claim fresh/busy/retry/committed/hash_mismatch with lease tokens;
// complete/fail fenced by the token); the SQL itself is proven on real
// PostgreSQL 16 by scripts/brandy-receptionist-rls-proof/run.sh.
// Synthetic fixtures only.
import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const OP_ID = "brandy-rental-office";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  encryptCallbackE164: vi.fn(() => "v1.test-key.ABCDEFGHijklmnopQRSTUV=="),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init) {
      return new Response(JSON.stringify(body), {
        ...init,
        headers: { "content-type": "application/json" },
      });
    },
  },
}));

vi.mock("@/lib/receptionist/createReceptionistIngestClient", () => ({
  createReceptionistIngestClient: (...args) => mocks.createClient(...args),
}));

vi.mock("@/lib/receptionist/callbackCrypto", () => ({
  encryptCallbackE164: (...args) => mocks.encryptCallbackE164(...args),
}));

const { POST } = await import("./route.js");
const { computeIngestSignature } = await import("@/lib/receptionist/ingestAuth.js");

function createFakeSupabase() {
  const state = {
    nonces: new Map(),
    calls: [],
    events: [],
    drafts: [],
    rpcCalls: [],
    injectRpcError: {},
    completeFalseOnce: false,
    failDraftUpsertOnce: false,
    failEventsInsertOnce: false,
  };
  let idSeq = 1;
  const nextId = () => `00000000-0000-4000-8000-${String(idSeq++).padStart(12, "0")}`;
  let tokenSeq = 1;
  // Lease tokens are opaque uuids in SQL; the fake mints distinct
  // token strings so fencing (old token != current token) is testable.
  const nextToken = () => `lease-token-${tokenSeq++}`;
  const LEASE_MS = 60_000;

  async function rpc(fn, params) {
    state.rpcCalls.push({ fn, params });
    if (state.injectRpcError[fn]) {
      const error = state.injectRpcError[fn];
      delete state.injectRpcError[fn];
      return { data: null, error };
    }
    const key = `${params.p_owner_id}|${params.p_nonce}`;
    if (fn === "receptionist_claim_ingest_nonce") {
      const existing = state.nonces.get(key);
      if (!existing) {
        const leaseToken = nextToken();
        state.nonces.set(key, {
          requestHash: params.p_request_hash, state: "IN_PROGRESS",
          callId: null, result: null,
          leaseToken, leaseExpiresAt: Date.now() + LEASE_MS,
        });
        return { data: { status: "fresh", lease_token: leaseToken, call_id: null, result: null }, error: null };
      }
      if (existing.requestHash !== params.p_request_hash) {
        return { data: { status: "hash_mismatch", call_id: existing.callId, result: existing.result }, error: null };
      }
      if (existing.state === "COMMITTED") {
        return { data: { status: "committed", call_id: existing.callId, result: existing.result }, error: null };
      }
      if (existing.state === "FAILED") {
        // The failed claim releases the lease: re-claim with a fresh token.
        const leaseToken = nextToken();
        existing.state = "IN_PROGRESS";
        existing.leaseToken = leaseToken;
        existing.leaseExpiresAt = Date.now() + LEASE_MS;
        return { data: { status: "retry", lease_token: leaseToken, call_id: existing.callId, result: null }, error: null };
      }
      // IN_PROGRESS: exclusive while the lease is live.
      if (existing.leaseExpiresAt > Date.now()) {
        return { data: { status: "busy", call_id: existing.callId, result: null }, error: null };
      }
      // Lease expired: fence the old token out, take the claim over.
      const leaseToken = nextToken();
      existing.leaseToken = leaseToken;
      existing.leaseExpiresAt = Date.now() + LEASE_MS;
      return { data: { status: "retry", lease_token: leaseToken, call_id: existing.callId, result: null }, error: null };
    }
    if (fn === "receptionist_complete_ingest_nonce") {
      if (state.completeFalseOnce) {
        state.completeFalseOnce = false;
        return { data: false, error: null };
      }
      const row = state.nonces.get(key);
      // Only the current lease holder, on an in-flight nonce, may commit.
      if (row && row.requestHash === params.p_request_hash
          && row.state === "IN_PROGRESS"
          && params.p_lease_token === row.leaseToken) {
        row.state = "COMMITTED";
        row.callId = params.p_call_id;
        row.result = params.p_result;
        return { data: true, error: null };
      }
      return { data: false, error: null };
    }
    if (fn === "receptionist_fail_ingest_nonce") {
      const row = state.nonces.get(key);
      // Only the current lease holder may fail a live claim.
      if (row && row.requestHash === params.p_request_hash
          && row.state === "IN_PROGRESS"
          && params.p_lease_token === row.leaseToken) {
        row.state = "FAILED";
        return { data: true, error: null };
      }
      return { data: false, error: null };
    }
    throw new Error(`unexpected rpc ${fn}`);
  }

  function queryBuilder(table) {
    const q = {
      _op: null, _row: null, _values: null, _filters: [], _opts: null,
      upsert(row, opts) { q._op = "upsert"; q._row = row; q._opts = opts; return q; },
      insert(row) { q._op = "insert"; q._row = row; return q; },
      update(values) { q._op = "update"; q._values = values; return q; },
      select() { return q; },
      eq(col, val) { q._filters.push([col, val]); return q; },
      single() { return q._run(true); },
      maybeSingle() { return q._run(false, true); },
      then(resolve, reject) { return q._run(false).then(resolve, reject); },
      _match(row) {
        return q._filters.every(([col, val]) => row[col] === val);
      },
      async _run(single, maybe) {
        if (table === "forge_rental_receptionist_calls" && q._op === "upsert") {
          const existing = state.calls.find(
            (c) => c.owner_id === q._row.owner_id && c.provider_call_sid === q._row.provider_call_sid);
          if (existing) {
            Object.assign(existing, q._row);
            return single ? { data: existing, error: null } : { data: [existing], error: null };
          }
          const row = { id: nextId(), ...q._row };
          state.calls.push(row);
          return single ? { data: row, error: null } : { data: [row], error: null };
        }
        if (table === "forge_rental_receptionist_calls" && q._op === "update") {
          for (const row of state.calls.filter((c) => q._match(c))) Object.assign(row, q._values);
          return { data: [], error: null };
        }
        if (table === "forge_rental_receptionist_events" && q._op === "insert") {
          if (state.failEventsInsertOnce) {
            state.failEventsInsertOnce = false;
            return { data: null, error: { code: "XX000", message: "boom" } };
          }
          const dup = state.events.some(
            (e) => e.owner_id === q._row.owner_id
              && e.ingest_idempotency_key === q._row.ingest_idempotency_key);
          if (dup) return { data: null, error: { code: "23505", message: "duplicate" } };
          state.events.push({ id: nextId(), ...q._row });
          return { data: [q._row], error: null };
        }
        if (table === "forge_rental_receptionist_drafts" && q._op === "upsert") {
          if (state.failDraftUpsertOnce) {
            state.failDraftUpsertOnce = false;
            return { data: null, error: { code: "XX000", message: "boom" } };
          }
          const existing = state.drafts.find(
            (d) => d.owner_id === q._row.owner_id && d.call_id === q._row.call_id
              && d.draft_kind === q._row.draft_kind);
          if (existing && q._opts?.ignoreDuplicates) {
            // ON CONFLICT DO NOTHING returns ZERO rows — the P1-3 shape.
            return { data: [], error: null };
          }
          if (existing) {
            Object.assign(existing, q._row);
            return { data: [existing], error: null };
          }
          const row = { id: nextId(), ...q._row };
          state.drafts.push(row);
          return { data: [row], error: null };
        }
        if (table === "forge_rental_receptionist_drafts" && q._op === null) {
          const found = state.drafts.find((d) => q._match(d)) || null;
          if (single && !found) return { data: null, error: { code: "PGRST116", message: "no rows" } };
          return { data: found, error: null };
        }
        throw new Error(`unexpected query ${table} op=${q._op}`);
      },
    };
    return q;
  }

  return { state, rpc, from: (table) => queryBuilder(table) };
}

function post(body, { nonce = "nonce-1", secret = "test-secret" } = {}) {
  const rawBody = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = computeIngestSignature(secret, rawBody, timestamp, nonce);
  return new Request("http://localhost/api/rental/receptionist/ingest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forge-signature": signature,
      "x-forge-timestamp": timestamp,
      "x-forge-nonce": nonce,
    },
    body: rawBody,
  });
}

function baseBody(overrides = {}) {
  return {
    operation_id: OP_ID,
    provider_call_sid: "CA-test-1",
    policy_version: "policy-v1",
    draft_kind: "MAINTENANCE_INTAKE",
    callback_e164: "+14095550199",
    events: [{
      event_id: "evt-1", event_type: "CALL_STARTED",
      ingest_idempotency_key: "idem-1",
    }],
    ...overrides,
  };
}

describe("POST /api/rental/receptionist/ingest — nonce lifecycle (P1-2)", () => {
  let fake;

  beforeEach(() => {
    fake = createFakeSupabase();
    mocks.createClient.mockReturnValue(fake);
    mocks.encryptCallbackE164.mockImplementation(() => "v1.test-key.ABCDEFGHijklmnopQRSTUV==");
    process.env.RECEPTIONIST_FORGE_INGEST_SECRET = "test-secret";
    process.env.RECEPTIONIST_OPERATION_OWNERS = JSON.stringify({ [OP_ID]: OWNER_ID });
  });

  it("fresh nonce ingests and commits the nonce with the stored result", async () => {
    const res = await POST(post(baseBody()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.callId).toBeTruthy();
    expect(body.draftId).toBeTruthy();
    expect(fake.state.calls).toHaveLength(1);
    expect(fake.state.drafts).toHaveLength(1);
    expect(fake.state.events).toHaveLength(1);
    const nonce = fake.state.nonces.get(`${OWNER_ID}|nonce-1`);
    expect(nonce.state).toBe("COMMITTED");
    expect(nonce.result).toEqual(body);
    expect(nonce.callId).toBe(body.callId);
    expect(fake.state.rpcCalls.some((c) => c.fn === "receptionist_complete_ingest_nonce")).toBe(true);
  });

  it("committed replay with identical bytes returns the stored result and writes nothing", async () => {
    const first = await POST(post(baseBody()));
    const firstBody = await first.json();
    const second = await POST(post(baseBody()));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(firstBody);
    expect(fake.state.calls).toHaveLength(1);
    expect(fake.state.drafts).toHaveLength(1);
    expect(fake.state.events).toHaveLength(1);
    expect(fake.state.rpcCalls.filter((c) => c.fn === "receptionist_complete_ingest_nonce")).toHaveLength(1);
  });

  it("same nonce with a different body is rejected (409) and writes nothing", async () => {
    await POST(post(baseBody()));
    const res = await POST(post(baseBody({ provider_call_sid: "CA-test-2" })));
    expect(res.status).toBe(409);
    expect(fake.state.calls).toHaveLength(1);
    expect(fake.state.drafts).toHaveLength(1);
  });

  it("mid-ingest failure marks the nonce FAILED and an identical retry recovers", async () => {
    mocks.encryptCallbackE164.mockImplementationOnce(() => {
      throw new Error("RECEPTIONIST_CALLBACK_KEY missing");
    });
    const failed = await POST(post(baseBody()));
    expect(failed.status).toBe(500);
    expect(fake.state.calls).toHaveLength(0);
    expect(fake.state.nonces.get(`${OWNER_ID}|nonce-1`).state).toBe("FAILED");
    expect(fake.state.rpcCalls.some((c) => c.fn === "receptionist_fail_ingest_nonce")).toBe(true);

    const retried = await POST(post(baseBody()));
    expect(retried.status).toBe(200);
    const body = await retried.json();
    expect(body.success).toBe(true);
    expect(fake.state.calls).toHaveLength(1);
    expect(fake.state.drafts).toHaveLength(1);
    expect(fake.state.nonces.get(`${OWNER_ID}|nonce-1`).state).toBe("COMMITTED");
  });

  it("failure after the call upsert still retries onto the same call row", async () => {
    fake.state.failDraftUpsertOnce = true;
    const failed = await POST(post(baseBody()));
    expect(failed.status).toBe(500);
    expect(fake.state.calls).toHaveLength(1); // call landed, draft did not
    expect(fake.state.drafts).toHaveLength(0);
    expect(fake.state.nonces.get(`${OWNER_ID}|nonce-1`).state).toBe("FAILED");

    const retried = await POST(post(baseBody()));
    expect(retried.status).toBe(200);
    expect(fake.state.calls).toHaveLength(1); // upsert collapsed onto it
    expect(fake.state.drafts).toHaveLength(1);
    expect(fake.state.nonces.get(`${OWNER_ID}|nonce-1`).state).toBe("COMMITTED");
  });

  it("concurrent duplicates: one ingests, the other gets busy 409 and writes nothing", async () => {
    const [a, b] = await Promise.all([POST(post(baseBody())), POST(post(baseBody()))]);
    // The first claim owns the lease; the second sees a live lease and
    // gets 'busy' — it must NOT run the ingest writes (fix round 3, P1-1).
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const busy = a.status === 409 ? a : b;
    expect((await busy.json()).error).toMatch(/already in progress/);
    expect(fake.state.calls).toHaveLength(1);
    expect(fake.state.drafts).toHaveLength(1);
    expect(fake.state.events).toHaveLength(1);
    expect(fake.state.nonces.get(`${OWNER_ID}|nonce-1`).state).toBe("COMMITTED");
  });

  it("claim RPC failure 500s without writes and without a fail call", async () => {
    fake.state.injectRpcError["receptionist_claim_ingest_nonce"] = new Error("db down");
    const res = await POST(post(baseBody()));
    expect(res.status).toBe(500);
    expect(fake.state.calls).toHaveLength(0);
    expect(fake.state.nonces.has(`${OWNER_ID}|nonce-1`)).toBe(false);
    expect(fake.state.rpcCalls.some((c) => c.fn === "receptionist_fail_ingest_nonce")).toBe(false);
  });

  it("a failed completion returns retryable 503 (never success) and the retry completes it", async () => {
    fake.state.injectRpcError["receptionist_complete_ingest_nonce"] = new Error("db transient");
    const first = await POST(post(baseBody()));
    // Fix round 3, P1-2: an unconfirmed commit is an honest retryable
    // failure, not success:true. The claim is released (FAILED) so the
    // identical retry can re-claim and commit.
    expect(first.status).toBe(503);
    expect((await first.json()).error).toMatch(/could not be confirmed/);
    expect(fake.state.calls).toHaveLength(1); // records landed...
    expect(fake.state.nonces.get(`${OWNER_ID}|nonce-1`).state).toBe("FAILED");
    const retried = await POST(post(baseBody()));
    expect(retried.status).toBe(200);
    expect(fake.state.calls).toHaveLength(1);
    expect(fake.state.nonces.get(`${OWNER_ID}|nonce-1`).state).toBe("COMMITTED");
  });

  it("a completion returning false returns 503 and the retry completes it", async () => {
    fake.state.completeFalseOnce = true;
    const first = await POST(post(baseBody()));
    expect(first.status).toBe(503);
    expect((await first.json()).error).toMatch(/could not be confirmed/);
    expect(fake.state.calls).toHaveLength(1);
    expect(fake.state.nonces.get(`${OWNER_ID}|nonce-1`).state).toBe("FAILED");
    const retried = await POST(post(baseBody()));
    expect(retried.status).toBe(200);
    expect(fake.state.nonces.get(`${OWNER_ID}|nonce-1`).state).toBe("COMMITTED");
  });

  it("a failing fail-RPC is swallowed and the original 500 still surfaces", async () => {
    mocks.encryptCallbackE164.mockImplementationOnce(() => {
      throw new Error("RECEPTIONIST_CALLBACK_KEY missing");
    });
    fake.state.injectRpcError["receptionist_fail_ingest_nonce"] = new Error("db down");
    const res = await POST(post(baseBody()));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Unable to ingest the call record.");
  });
});

describe("POST /api/rental/receptionist/ingest — lease fencing (P1-1)", () => {
  let fake;

  beforeEach(() => {
    fake = createFakeSupabase();
    mocks.createClient.mockReturnValue(fake);
    mocks.encryptCallbackE164.mockImplementation(() => "v1.test-key.ABCDEFGHijklmnopQRSTUV==");
    process.env.RECEPTIONIST_FORGE_INGEST_SECRET = "test-secret";
    process.env.RECEPTIONIST_OPERATION_OWNERS = JSON.stringify({ [OP_ID]: OWNER_ID });
  });

  const claim = (nonce, hash) => fake.rpc("receptionist_claim_ingest_nonce",
    { p_owner_id: OWNER_ID, p_nonce: nonce, p_request_hash: hash });
  const complete = (nonce, hash, token) => fake.rpc("receptionist_complete_ingest_nonce",
    { p_owner_id: OWNER_ID, p_nonce: nonce, p_request_hash: hash,
      p_call_id: "00000000-0000-4000-8000-000000000001", p_result: { success: true },
      p_lease_token: token });
  const fail = (nonce, hash, token) => fake.rpc("receptionist_fail_ingest_nonce",
    { p_owner_id: OWNER_ID, p_nonce: nonce, p_request_hash: hash, p_lease_token: token });

  it("overlapping claim with a live lease returns busy, never retry", async () => {
    const first = await claim("nonce-lease-1", "hash-1");
    expect(first.data.status).toBe("fresh");
    expect(first.data.lease_token).toBeTruthy();
    const second = await claim("nonce-lease-1", "hash-1");
    expect(second.data.status).toBe("busy");
    expect(second.data.lease_token).toBeUndefined();
  });

  it("lease takeover fences the old token out; only the new token completes", async () => {
    const first = await claim("nonce-lease-2", "hash-2");
    const oldToken = first.data.lease_token;
    // The first worker crashed: its lease expires.
    fake.state.nonces.get(`${OWNER_ID}|nonce-lease-2`).leaseExpiresAt = Date.now() - 1000;
    const takeover = await claim("nonce-lease-2", "hash-2");
    expect(takeover.data.status).toBe("retry");
    const newToken = takeover.data.lease_token;
    expect(newToken).toBeTruthy();
    expect(newToken).not.toBe(oldToken);
    // Stale worker completion/failure changes nothing (fencing).
    expect((await complete("nonce-lease-2", "hash-2", oldToken)).data).toBe(false);
    expect((await fail("nonce-lease-2", "hash-2", oldToken)).data).toBe(false);
    expect(fake.state.nonces.get(`${OWNER_ID}|nonce-lease-2`).state).toBe("IN_PROGRESS");
    // The new lease holder completes.
    expect((await complete("nonce-lease-2", "hash-2", newToken)).data).toBe(true);
    expect(fake.state.nonces.get(`${OWNER_ID}|nonce-lease-2`).state).toBe("COMMITTED");
  });

  it("fail by the owning token releases the claim; re-claim gets a fresh token", async () => {
    const first = await claim("nonce-lease-3", "hash-3");
    const oldToken = first.data.lease_token;
    expect((await fail("nonce-lease-3", "hash-3", oldToken)).data).toBe(true);
    expect(fake.state.nonces.get(`${OWNER_ID}|nonce-lease-3`).state).toBe("FAILED");
    const reclaim = await claim("nonce-lease-3", "hash-3");
    expect(reclaim.data.status).toBe("retry");
    const newToken = reclaim.data.lease_token;
    expect(newToken).not.toBe(oldToken);
    // The old token can no longer complete after the re-claim.
    expect((await complete("nonce-lease-3", "hash-3", oldToken)).data).toBe(false);
    expect((await complete("nonce-lease-3", "hash-3", newToken)).data).toBe(true);
  });

  it("complete and fail with the wrong hash return false", async () => {
    const first = await claim("nonce-lease-4", "hash-4");
    const token = first.data.lease_token;
    expect((await complete("nonce-lease-4", "hash-wrong", token)).data).toBe(false);
    expect((await fail("nonce-lease-4", "hash-wrong", token)).data).toBe(false);
    expect(fake.state.nonces.get(`${OWNER_ID}|nonce-lease-4`).state).toBe("IN_PROGRESS");
  });

  it("a busy duplicate through the route writes nothing and the owner still commits", async () => {
    // The duplicate arrives while the first delivery is in-flight: it
    // gets 'busy' 409 and runs no writes; the owner still commits.
    const firstPromise = POST(post(baseBody()));
    const duplicate = await POST(post(baseBody()));
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error).toMatch(/already in progress/);
    const first = await firstPromise;
    expect(first.status).toBe(200);
    expect(fake.state.calls).toHaveLength(1);
    expect(fake.state.drafts).toHaveLength(1);
    expect(fake.state.events).toHaveLength(1);
    expect(fake.state.nonces.get(`${OWNER_ID}|nonce-1`).state).toBe("COMMITTED");
  });
});

describe("POST /api/rental/receptionist/ingest — draft conflict fetch (P1-3)", () => {
  let fake;

  beforeEach(() => {
    fake = createFakeSupabase();
    mocks.createClient.mockReturnValue(fake);
    mocks.encryptCallbackE164.mockImplementation(() => "v1.test-key.ABCDEFGHijklmnopQRSTUV==");
    process.env.RECEPTIONIST_FORGE_INGEST_SECRET = "test-secret";
    process.env.RECEPTIONIST_OPERATION_OWNERS = JSON.stringify({ [OP_ID]: OWNER_ID });
  });

  it("new nonce for an existing call/draft returns the existing draft id, no 500", async () => {
    // Seed the call + an already-REVIEWED draft, as a first delivery left them.
    fake.state.calls.push({
      id: "00000000-0000-4000-8000-000000000001", owner_id: OWNER_ID,
      provider_call_sid: "CA-test-1", direction: "INBOUND",
      processing_state: "IN_PROGRESS", policy_version: "policy-v1",
    });
    fake.state.drafts.push({
      id: "00000000-0000-4000-8000-000000000002", owner_id: OWNER_ID,
      call_id: "00000000-0000-4000-8000-000000000001",
      draft_kind: "MAINTENANCE_INTAKE", proposed_payload: {},
      review_state: "APPROVED", committed_record_id: null,
    });
    const res = await POST(post(baseBody()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draftId).toBe("00000000-0000-4000-8000-000000000002");
    expect(body.callId).toBe("00000000-0000-4000-8000-000000000001");
    expect(fake.state.calls).toHaveLength(1);
    expect(fake.state.drafts).toHaveLength(1);
    // First-write-wins: the replay never reset the reviewed draft.
    expect(fake.state.drafts[0].review_state).toBe("APPROVED");
    // The call links to the pre-existing draft.
    expect(fake.state.calls[0].maintenance_draft_id)
      .toBe("00000000-0000-4000-8000-000000000002");
  });

  it("same-nonce replay after a conflict-path ingest returns the stored result", async () => {
    fake.state.calls.push({
      id: "00000000-0000-4000-8000-000000000001", owner_id: OWNER_ID,
      provider_call_sid: "CA-test-1", direction: "INBOUND",
      processing_state: "IN_PROGRESS", policy_version: "policy-v1",
    });
    fake.state.drafts.push({
      id: "00000000-0000-4000-8000-000000000002", owner_id: OWNER_ID,
      call_id: "00000000-0000-4000-8000-000000000001",
      draft_kind: "MAINTENANCE_INTAKE", proposed_payload: {},
      review_state: "PENDING", committed_record_id: null,
    });
    const first = await POST(post(baseBody()));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    const second = await POST(post(baseBody()));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(firstBody);
    expect(fake.state.drafts).toHaveLength(1);
  });
});
