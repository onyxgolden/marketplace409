import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: vi.fn() }));
vi.mock("@/infrastructure/notifications/ResendRentalEmailProvider", () => ({
  createResendRentalEmailProvider: vi.fn(),
}));

import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";
import { GET } from "./route.js";

// Obvious fixtures only — never real borrower or financial data.
const OWNER = "owner_fixture";
const BORROWER = "borrower_fixture";

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
  };
  return db;
}

function authedRequest(url = "https://test/api") {
  return new Request(url, { headers: { authorization: "Bearer test-secret" } });
}

function queuedBorrowerRow(borrowerId = BORROWER) {
  return {
    owner_id: OWNER,
    id: `prrd_${OWNER}_pay_fixture_borrower`,
    payment_id: "pay_fixture",
    account_id: "acct_fixture",
    borrower_id: borrowerId,
    recipient_type: "borrower",
    recipient_email: "borrower@example.com",
    status: "queued",
    attempt_count: 0,
    first_attempted_at: null,
    last_attempted_at: null,
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED = "true";
  // Both allow-lists fail closed: tests opt in explicitly.
  process.env.OWNER_PAYMENT_NOTIFICATION_OWNER_IDS = OWNER;
  process.env.PF_RECEIPT_BORROWER_IDS = BORROWER;
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

describe("payment receipt notifications cron", () => {
  it("rejects callers without the cron secret", async () => {
    const response = await GET(new Request("https://test/api"));
    expect(response.status).toBe(401);
  });

  it("delivery terminally marks rows for borrowers removed from the allow-list", async () => {
    // The borrower was allow-listed at queue time but has since been removed.
    process.env.PF_RECEIPT_BORROWER_IDS = "borrower_other";
    const outcomeNode = qb({ data: [{ id: "row_fixture" }], error: null });
    const db = sequenceDb({
      private_financing_online_payments: [qb({ data: [], error: null })], // reconciler: nothing to heal
      private_financing_payment_receipt_deliveries: [
        qb({ data: [queuedBorrowerRow()], error: null }), // delivery candidates
        qb({ data: [{ id: "row_fixture" }], error: null }), // claim: won
        outcomeNode, // outcome: recorded
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);
    const send = vi.fn();
    createResendRentalEmailProvider.mockReturnValue({ send });

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
    expect(body.sent).toBe(0);
    expect(body.skippedNotAllowlisted).toBe(1);
    const outcomeUpdate = outcomeNode.update.mock.calls[0][0];
    expect(outcomeUpdate.status).toBe("skipped_not_allowlisted");
    expect(outcomeUpdate.claim_token).toBeNull();
  });

  it("delivery fails closed for rows with no recorded borrower", async () => {
    const outcomeNode = qb({ data: [{ id: "row_fixture" }], error: null });
    const db = sequenceDb({
      private_financing_online_payments: [qb({ data: [], error: null })],
      private_financing_payment_receipt_deliveries: [
        qb({ data: [queuedBorrowerRow(null)], error: null }),
        qb({ data: [{ id: "row_fixture" }], error: null }),
        outcomeNode,
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);
    const send = vi.fn();
    createResendRentalEmailProvider.mockReturnValue({ send });

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(send).not.toHaveBeenCalled();
    expect(body.skippedNotAllowlisted).toBe(1);
    expect(outcomeNode.update.mock.calls[0][0].status).toBe("skipped_not_allowlisted");
  });

  it("reconciler heals nothing when the activation cutoff is unset", async () => {
    delete process.env.PAYMENT_RECEIPTS_ACTIVATED_AT;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const db = sequenceDb({
      // No payments table access at all: the reconciler bails before querying.
      private_financing_payment_receipt_deliveries: [
        qb({ data: [], error: null }), // delivery candidates: none
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);
    createResendRentalEmailProvider.mockReturnValue({ send: vi.fn() });

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reconcileSkipped).toBe(true);
    expect(body.reconciled).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(
      "Payment receipt reconciler skipped: PAYMENT_RECEIPTS_ACTIVATED_AT is not set.",
    );
    logSpy.mockRestore();
  });

  it("reconciler excludes payments settled before the activation cutoff", async () => {
    const paymentsNode = qb({ data: [], error: null });
    const db = sequenceDb({
      private_financing_online_payments: [paymentsNode],
      private_financing_payment_receipt_deliveries: [
        qb({ data: [], error: null }), // delivery candidates: none
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);
    createResendRentalEmailProvider.mockReturnValue({ send: vi.fn() });

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reconcileSkipped).toBe(false);
    // The scan filters on both the rolling lookback and the activation cutoff.
    expect(paymentsNode.gte).toHaveBeenCalledWith("succeeded_at", "2026-09-01T00:00:00.000Z");
    expect(paymentsNode.gte.mock.calls.filter(([field]) => field === "succeeded_at")).toHaveLength(2);
  });

  it("delivery still sends for allow-listed borrowers", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "re_123" });
    createResendRentalEmailProvider.mockReturnValue({ send });
    const db = sequenceDb({
      private_financing_online_payments: [
        qb({ data: [], error: null }), // reconciler: nothing to heal
        qb({ data: { amount_cents: 50000, succeeded_at: "2026-09-26T18:00:00Z" }, error: null }), // facts: payment
      ],
      private_financing_borrowers: [
        qb({ data: { full_name: "Test Borrower", email: "borrower@example.com" }, error: null }), // facts: borrower
      ],
      private_financing_accounts: [
        qb({ data: { product: "Personal Loan" }, error: null }), // facts: account
      ],
      private_financing_autopay_attempts: [
        qb({ data: null, error: null }), // facts: not autopay
      ],
      private_financing_payment_receipt_deliveries: [
        qb({ data: [queuedBorrowerRow()], error: null }), // delivery candidates
        qb({ data: [{ id: "row_fixture" }], error: null }), // claim: won
        qb({ data: [{ id: "row_fixture" }], error: null }), // outcome: recorded
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sent).toBe(1);
    expect(body.skippedNotAllowlisted).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: "borrower@example.com" }),
    );
  });

  it("delivery writes a provider_accepted ledger row per recipient", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "re_123" });
    createResendRentalEmailProvider.mockReturnValue({ send });
    const db = sequenceDb({
      private_financing_online_payments: [
        qb({ data: [], error: null }), // reconciler: nothing to heal
        qb({ data: { amount_cents: 50000, succeeded_at: "2026-09-26T18:00:00Z" }, error: null }), // facts: payment
      ],
      private_financing_borrowers: [
        qb({ data: { full_name: "Test Borrower", email: "borrower@example.com" }, error: null }), // facts: borrower
      ],
      private_financing_accounts: [
        qb({ data: { product: "Personal Loan" }, error: null }), // facts: account
      ],
      private_financing_autopay_attempts: [
        qb({ data: null, error: null }), // facts: not autopay
      ],
      private_financing_payment_receipt_deliveries: [
        qb({ data: [queuedBorrowerRow()], error: null }), // delivery candidates
        qb({ data: [{ id: "row_fixture" }], error: null }), // claim: won
        qb({ data: [{ id: "row_fixture" }], error: null }), // outcome: recorded
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    expect(response.status).toBe(200);
    expect(db._ledgerRows).toHaveLength(1);
    expect(db._ledgerRows[0]).toMatchObject({
      schedule_name: "pf_payment_receipts",
      recipient_allowlist_id: "borrower_fixture",
      state: "provider_accepted",
      provider_message_id: "re_123",
    });
    expect(db._ledgerRows[0].scheduled_slot).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("delivery failure writes a provider_failed ledger row", async () => {
    const send = vi.fn().mockRejectedValue(new Error("Resend rejected email delivery (500)."));
    createResendRentalEmailProvider.mockReturnValue({ send });
    const db = sequenceDb({
      private_financing_online_payments: [
        qb({ data: [], error: null }), // reconciler: nothing to heal
        qb({ data: { amount_cents: 50000, succeeded_at: "2026-09-26T18:00:00Z" }, error: null }), // facts: payment
      ],
      private_financing_borrowers: [
        qb({ data: { full_name: "Test Borrower", email: "borrower@example.com" }, error: null }), // facts: borrower
      ],
      private_financing_accounts: [
        qb({ data: { product: "Personal Loan" }, error: null }), // facts: account
      ],
      private_financing_autopay_attempts: [
        qb({ data: null, error: null }), // facts: not autopay
      ],
      private_financing_payment_receipt_deliveries: [
        qb({ data: [queuedBorrowerRow()], error: null }), // delivery candidates
        qb({ data: [{ id: "row_fixture" }], error: null }), // claim: won
        qb({ data: [{ id: "row_fixture" }], error: null }), // outcome: recorded
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.failed).toBe(1);
    expect(db._ledgerRows).toHaveLength(1);
    expect(db._ledgerRows[0]).toMatchObject({
      schedule_name: "pf_payment_receipts",
      state: "provider_failed",
    });
    expect(db._ledgerRows[0].failure_reason).toContain("500");
  });

  it("a run with nothing to send writes a _sweep no_op ledger row", async () => {
    createResendRentalEmailProvider.mockReturnValue({ send: vi.fn() });
    const db = sequenceDb({
      private_financing_online_payments: [qb({ data: [], error: null })], // reconciler: nothing to heal
      private_financing_payment_receipt_deliveries: [
        qb({ data: [], error: null }), // delivery candidates: none
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    expect(response.status).toBe(200);
    expect(db._ledgerRows).toHaveLength(1);
    expect(db._ledgerRows[0]).toMatchObject({
      schedule_name: "pf_payment_receipts",
      recipient_allowlist_id: "_sweep",
      state: "no_op",
    });
  });

  it("two deliveries to one recipient record two attempts; both evidenced (RDL-004)", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "re_123" });
    createResendRentalEmailProvider.mockReturnValue({ send });
    const row1 = { ...queuedBorrowerRow(), id: "prrd_row_1", payment_id: "pay_1" };
    const row2 = { ...queuedBorrowerRow(), id: "prrd_row_2", payment_id: "pay_2" };
    const db = sequenceDb({
      private_financing_online_payments: [
        qb({ data: [], error: null }), // reconciler: nothing to heal
        qb({ data: { amount_cents: 50000, succeeded_at: "2026-09-26T18:00:00Z" }, error: null }),
        qb({ data: { amount_cents: 75000, succeeded_at: "2026-09-26T19:00:00Z" }, error: null }),
      ],
      private_financing_borrowers: [
        qb({ data: { full_name: "Test Borrower", email: "borrower@example.com" }, error: null }),
        qb({ data: { full_name: "Test Borrower", email: "borrower@example.com" }, error: null }),
      ],
      private_financing_accounts: [
        qb({ data: { product: "Personal Loan" }, error: null }),
        qb({ data: { product: "Personal Loan" }, error: null }),
      ],
      private_financing_autopay_attempts: [qb({ data: null, error: null }), qb({ data: null, error: null })],
      private_financing_payment_receipt_deliveries: [
        qb({ data: [row1, row2], error: null }), // delivery candidates
        qb({ data: [{ id: "row_fixture" }], error: null }), // row1 claim: won
        qb({ data: [{ id: "row_fixture" }], error: null }), // row1 outcome: recorded
        qb({ data: [{ id: "row_fixture" }], error: null }), // row2 claim: won
        qb({ data: [{ id: "row_fixture" }], error: null }), // row2 outcome: recorded
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sent).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
    // Both deliveries have individual attempt evidence — the second send is
    // not swallowed by an accepted->accepted summary transition.
    expect(db._attemptRows).toHaveLength(2);
    expect(db._attemptRows.map((a) => a.delivery_id).sort()).toEqual(["prrd_row_1", "prrd_row_2"]);
    expect(db._attemptRows.every((a) => a.state === "provider_accepted")).toBe(true);
    expect(db._ledgerRows[0]).toMatchObject({ state: "provider_accepted" });
    expect(body.ledgerErrors).toBe(0);
  });

  it("a failed delivery is not masked by a later success to the same recipient (RDL-004)", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("Resend rejected email delivery (500)."))
      .mockResolvedValue({ messageId: "re_124" });
    createResendRentalEmailProvider.mockReturnValue({ send });
    const row1 = { ...queuedBorrowerRow(), id: "prrd_row_1", payment_id: "pay_1" };
    const row2 = { ...queuedBorrowerRow(), id: "prrd_row_2", payment_id: "pay_2" };
    const db = sequenceDb({
      private_financing_online_payments: [
        qb({ data: [], error: null }), // reconciler: nothing to heal
        qb({ data: { amount_cents: 50000, succeeded_at: "2026-09-26T18:00:00Z" }, error: null }),
        qb({ data: { amount_cents: 75000, succeeded_at: "2026-09-26T19:00:00Z" }, error: null }),
      ],
      private_financing_borrowers: [
        qb({ data: { full_name: "Test Borrower", email: "borrower@example.com" }, error: null }),
        qb({ data: { full_name: "Test Borrower", email: "borrower@example.com" }, error: null }),
      ],
      private_financing_accounts: [
        qb({ data: { product: "Personal Loan" }, error: null }),
        qb({ data: { product: "Personal Loan" }, error: null }),
      ],
      private_financing_autopay_attempts: [qb({ data: null, error: null }), qb({ data: null, error: null })],
      private_financing_payment_receipt_deliveries: [
        qb({ data: [row1, row2], error: null }), // delivery candidates
        qb({ data: [{ id: "row_fixture" }], error: null }), // row1 claim: won
        qb({ data: [{ id: "row_fixture" }], error: null }), // row1 outcome: recorded
        qb({ data: [{ id: "row_fixture" }], error: null }), // row2 claim: won
        qb({ data: [{ id: "row_fixture" }], error: null }), // row2 outcome: recorded
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(1);
    const attempts = db._attemptRows;
    expect(attempts).toHaveLength(2);
    expect(attempts.find((a) => a.delivery_id === "prrd_row_1").state).toBe("provider_failed");
    expect(attempts.find((a) => a.delivery_id === "prrd_row_2").state).toBe("provider_accepted");
    // The summary keeps the failure: the later success did not clear it.
    expect(db._ledgerRows[0]).toMatchObject({ state: "provider_failed" });
    expect(db._ledgerRows[0].failure_reason).toContain("500");
  });
});
