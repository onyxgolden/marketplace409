import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: vi.fn() }));
vi.mock("@/infrastructure/notifications/ResendRentalEmailProvider", () => ({
  createResendRentalEmailProvider: vi.fn(),
}));

import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { GET } from "./route.js";

function qb(result) {
  const node = {
    select: vi.fn(() => node),
    eq: vi.fn(() => node),
    in: vi.fn(() => node),
    order: vi.fn(() => node),
    gte: vi.fn(() => node),
    is: vi.fn(() => node),
    range: vi.fn(() => node),
    update: vi.fn(() => node),
    upsert: vi.fn(() => node),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve) => resolve(result),
  };
  return node;
}

// In-memory scheduled_send_ledger mock: first-write-wins upsert on the
// (schedule, slot, recipient) key; state-guarded updates.
function ledgerNode(store) {
  const keyOf = (r) => `${r.schedule_name}|${r.scheduled_slot}|${r.recipient_allowlist_id}`;
  const node = {
    select: vi.fn(() => node),
    eq: vi.fn((col, val) => {
      node._filters.push([col, val]);
      return node;
    }),
    order: vi.fn(() => node),
    maybeSingle: vi.fn(() => {
      const found = store.rows.find((r) => node._filters.every(([c, v]) => r[c] === v));
      return Promise.resolve({ data: found ?? null, error: null });
    }),
    upsert: vi.fn((row, options) => {
      const exists = store.rows.some((r) => keyOf(r) === keyOf(row));
      return {
        select: vi.fn(() => ({
          then: (resolve) => {
            if (exists && options?.ignoreDuplicates) return resolve({ data: [], error: null });
            const inserted = { id: `ledger_${store.rows.length + 1}`, ...row };
            store.rows.push(inserted);
            resolve({ data: [inserted], error: null });
          },
        })),
      };
    }),
    update: vi.fn((patch) => {
      const updFilters = [];
      const apply = (resolve) => {
        const idx = store.rows.findIndex((r) => updFilters.every(([c, v]) => r[c] === v));
        if (idx === -1) return resolve({ data: [], error: null });
        store.rows[idx] = { ...store.rows[idx], ...patch };
        resolve({ data: [store.rows[idx]], error: null });
      };
      const upd = {
        eq: vi.fn((col, val) => {
          updFilters.push([col, val]);
          return upd;
        }),
        // supabase-js executes the update when awaited, with or without .select().
        then: apply,
        select: vi.fn(() => ({ then: apply })),
      };
      return upd;
    }),
    then: (resolve) =>
      resolve({
        data: store.rows.filter((r) => node._filters.every(([c, v]) => r[c] === v)),
        error: null,
      }),
  };
  node._filters = [];
  return node;
}

// In-memory scheduled_send_attempts mock: insert-only rows; select/eq read.
function attemptsNode(store) {
  const node = {
    select: vi.fn(() => node),
    eq: vi.fn((col, val) => {
      node._filters.push([col, val]);
      return node;
    }),
    insert: vi.fn((row) => {
      const inserted = { id: `attempt_${store.rows.length + 1}`, ...row };
      store.rows.push(inserted);
      return { then: (resolve) => resolve({ data: [inserted], error: null }) };
    }),
    then: (resolve) =>
      resolve({
        data: store.rows.filter((r) => node._filters.every(([c, v]) => r[c] === v)),
        error: null,
      }),
  };
  node._filters = [];
  return node;
}

// Deterministic mock db: tableSequences maps each table to the list of query
// builders consumed in call order. The scheduled_send_ledger table is
// handled by a shared in-memory store (db._ledgerRows) instead of a
// sequence.
function sequenceDb(tableSequences) {
  const counters = {};
  const ledgerStore = { rows: [] };
  const attemptsStore = { rows: [] };
  const db = {
    _ledgerRows: ledgerStore.rows,
    _attemptRows: attemptsStore.rows,
    from: vi.fn((table) => {
      if (table === "scheduled_send_ledger") return ledgerNode(ledgerStore);
      if (table === "scheduled_send_attempts") return attemptsNode(attemptsStore);
      const seq = tableSequences[table];
      if (!seq) throw new Error(`unexpected from(${table}) call`);
      const i = counters[table] || 0;
      counters[table] = i + 1;
      if (i >= seq.length) throw new Error(`too many from(${table}) calls`);
      return seq[i];
    }),
    // Faithful test double of the record_rental_send_attempt database
    // function (RDL-004A): token check + ordinal allocation + insert are
    // one atomic step in the mock, exactly the atomicity the real
    // function guarantees via its ledger-row lock.
    rpc: vi.fn(async (name, params) => {
      if (name !== "record_rental_send_attempt") throw new Error(`unexpected rpc ${name}`);
      const ledger = ledgerStore.rows.find((r) => r.id === params.p_ledger_id);
      if (!ledger) return { data: { recorded: false, reason: "no_ledger_row" }, error: null };
      if (ledger.claim_token != null && params.p_claim_token !== ledger.claim_token) {
        return { data: { recorded: false, reason: "stale_claim_token" }, error: null };
      }
      const sameAttempt = (a) =>
        a.ledger_id === params.p_ledger_id &&
        a.delivery_id === params.p_delivery_id &&
        (a.run_id ?? null) === (params.p_run_id ?? null) &&
        a.state === params.p_state &&
        (a.provider_message_id ?? null) === (params.p_provider_message_id ?? null) &&
        (a.failure_reason ?? null) === (params.p_failure_reason ?? null);
      const duplicate = attemptsStore.rows.find(sameAttempt);
      if (duplicate) {
        return {
          data: {
            recorded: true,
            duplicate: true,
            attempt_ordinal: duplicate.attempt_ordinal,
            attempt: duplicate,
          },
          error: null,
        };
      }
      const prior = attemptsStore.rows.filter(
        (a) => a.ledger_id === params.p_ledger_id && a.delivery_id === params.p_delivery_id,
      );
      const ordinal = Math.max(0, ...prior.map((a) => a.attempt_ordinal ?? 0)) + 1;
      const inserted = {
        id: `attempt_${attemptsStore.rows.length + 1}`,
        ledger_id: params.p_ledger_id,
        delivery_id: params.p_delivery_id,
        state: params.p_state,
        provider_message_id: params.p_provider_message_id,
        failure_reason: params.p_failure_reason,
        run_id: params.p_run_id,
        claim_token: ledger.claim_token,
        attempt_ordinal: ordinal,
        attempted_at: new Date().toISOString(),
      };
      attemptsStore.rows.push(inserted);
      return {
        data: { recorded: true, duplicate: false, attempt_ordinal: ordinal, attempt: inserted },
        error: null,
      };
    }),
  };
  return db;
}

function authedRequest(url = "https://test/api") {
  return new Request(url, { headers: { authorization: "Bearer test-secret" } });
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  delete process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED;
  // Both allow-lists fail closed: tests opt in explicitly.
  process.env.OWNER_PAYMENT_NOTIFICATION_OWNER_IDS = "owner_fixture";
  process.env.RENTAL_NOTIFICATION_TENANT_IDS = "tenant_fixture";
  // Activation cutoff: the reconciler only heals payments settled at/after this.
  process.env.PAYMENT_RECEIPTS_ACTIVATED_AT = "2026-09-01T00:00:00Z";
  vi.clearAllMocks();
  // Pin the clock to noon CDT (outside quiet hours) so delivery tests are
  // deterministic no matter when the suite runs.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T17:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("tenant payment receipts cron", () => {
  it("rejects callers without the cron secret", async () => {
    const response = await GET(new Request("https://test/api"));
    expect(response.status).toBe(401);
  });

  it("reconciler heals nothing when the activation cutoff is unset", async () => {
    delete process.env.PAYMENT_RECEIPTS_ACTIVATED_AT;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const db = sequenceDb({
      // No payments table access at all: the reconciler bails before querying.
      rental_tenant_receipt_deliveries: [
        qb({ data: [], error: null }), // delivery candidates: none
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reconcileSkipped).toBe(true);
    expect(body.reconciled).toBe(0);
    // Fail-closed: the reconciler bails before touching rental_payments, so
    // no stale succeeded payment can be healed.
    expect(db.from).not.toHaveBeenCalledWith("rental_payments");
    expect(logSpy).toHaveBeenCalledWith(
      "Tenant payment receipt reconciler skipped: PAYMENT_RECEIPTS_ACTIVATED_AT is not set.",
    );
    logSpy.mockRestore();
  });

  it("reconciler excludes payments settled before the activation cutoff", async () => {
    const scanQb = qb({ data: [], error: null });
    const db = sequenceDb({
      rental_payments: [scanQb], // reconciler scan: nothing to heal
      rental_tenant_receipt_deliveries: [
        qb({ data: [], error: null }), // delivery candidates: none
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reconcileSkipped).toBe(false);
    // The scan filters on both the rolling lookback and the activation cutoff.
    expect(scanQb.gte).toHaveBeenCalledWith("succeeded_at", "2026-09-01T00:00:00.000Z");
    expect(scanQb.gte.mock.calls.filter(([field]) => field === "succeeded_at")).toHaveLength(2);
  });

  it("delivery sends and writes a provider_accepted ledger row", async () => {
    process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED = "true";
    const send = vi.fn().mockResolvedValue({ messageId: "re_456" });
    const { createResendRentalEmailProvider } = await import(
      "@/infrastructure/notifications/ResendRentalEmailProvider"
    );
    createResendRentalEmailProvider.mockReturnValue({ send });
    const queuedRow = {
      owner_id: "owner_fixture",
      id: "trrd_row_1",
      payment_id: "pay_fixture",
      lease_id: "lease_fixture",
      tenant_id: "tenant_fixture",
      recipient_email: "tenant@example.com",
      status: "queued",
      attempt_count: 0,
      first_attempted_at: null,
      last_attempted_at: null,
    };
    const db = sequenceDb({
      rental_payments: [
        qb({ data: [], error: null }), // reconciler scan: nothing to heal
        qb({
          data: {
            amount_cents: 160000,
            succeeded_at: "2026-09-26T18:00:00Z",
            provider_payment_id: "pi_123",
            lease_id: "lease_fixture",
          },
          error: null,
        }), // facts: payment
      ],
      rental_tenants: [
        qb({ data: { display_name: "Test Tenant", email: "tenant@example.com" }, error: null }),
      ],
      rental_leases: [qb({ data: null, error: null })], // no lease row: label null
      rental_tenant_receipt_deliveries: [
        qb({ data: [queuedRow], error: null }), // delivery candidates
        qb({ data: [{ id: "trrd_row_1" }], error: null }), // claim: won
        qb({ data: [{ id: "trrd_row_1" }], error: null }), // outcome: recorded
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(db._ledgerRows).toHaveLength(1);
    expect(db._ledgerRows[0]).toMatchObject({
      schedule_name: "tenant_payment_receipts",
      recipient_allowlist_id: "tenant_fixture",
      state: "provider_accepted",
      provider_message_id: "re_456",
    });
  });
});
