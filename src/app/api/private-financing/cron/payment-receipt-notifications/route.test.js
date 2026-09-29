// Dry-run proof for the personal-loan receipt cron route: ?dryRun=true must
// calculate the full plan (reconcile + wouldSend) without constructing the
// email provider and without any database write. Synthetic fixtures only.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: vi.fn() }));
vi.mock("@/infrastructure/notifications/ResendRentalEmailProvider", () => ({
  createResendRentalEmailProvider: vi.fn(),
}));

import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";
import { DEFAULT_OWNER_NOTIFICATION_EMAIL } from "@/domains/owner-notifications/ownerNotificationConfig.js";
import { GET } from "./route.js";

const OWNER = "owner_fixture";
const BORROWER = "pf_brw_fixture_ethan";
const PAYMENT_ID = "pf_payment_fixture_1";

// Recording mock db: every write is captured so the test can prove zero
// database changes; reads resolve from the rows map.
function makeDb(rows = {}) {
  const writes = [];
  const resolveRows = (table, single) => {
    const value = rows[table];
    if (value === undefined) return single ? null : [];
    if (single) return Array.isArray(value) ? (value[0] ?? null) : value;
    return Array.isArray(value) ? value : [value];
  };
  const node = (table) => {
    const q = {
      select: () => q,
      eq: () => q,
      in: () => q,
      order: () => q,
      gte: () => q,
      range: () => q,
      is: () => q,
      maybeSingle: () => Promise.resolve({ data: resolveRows(table, true), error: null }),
      upsert: (row, opts) => {
        writes.push({ table, method: "upsert", row, opts });
        return q;
      },
      update: (patch) => {
        writes.push({ table, method: "update", patch });
        return q;
      },
      insert: (row) => {
        writes.push({ table, method: "insert", row });
        return q;
      },
      then: (resolve) => resolve({ data: resolveRows(table, false), error: null }),
    };
    return q;
  };
  return { db: { from: vi.fn((table) => node(table)) }, writes };
}

const QUEUED_OWNER_ROW = {
  owner_id: OWNER,
  id: `pf_receipt_${OWNER}_${PAYMENT_ID}_owner`,
  account_id: "pf_acct_fixture",
  payment_id: PAYMENT_ID,
  borrower_id: BORROWER,
  recipient_type: "owner",
  recipient_email: DEFAULT_OWNER_NOTIFICATION_EMAIL,
  status: "queued",
  attempt_count: 0,
  first_attempted_at: null,
  last_attempted_at: null,
  failure_reason: null,
};

const ENV_KEYS = [
  "CRON_SECRET",
  "PF_RECEIPT_BORROWER_IDS",
  "OWNER_PAYMENT_NOTIFICATION_OWNER_IDS",
  "OWNER_PAYMENT_NOTIFICATIONS_ENABLED",
  "OWNER_NOTIFICATION_QUIET_START",
  "OWNER_NOTIFICATION_QUIET_END",
];
let savedEnv = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.CRON_SECRET = "test-secret";
  process.env.PF_RECEIPT_BORROWER_IDS = BORROWER;
  process.env.OWNER_PAYMENT_NOTIFICATION_OWNER_IDS = OWNER;
  process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED = "true";
  // startHour === endHour disables the quiet window deterministically, so the
  // test behaves the same at 2pm and 2am (quiet hours themselves are covered
  // by the acceptance test's `at` override).
  process.env.OWNER_NOTIFICATION_QUIET_START = "0";
  process.env.OWNER_NOTIFICATION_QUIET_END = "0";
  vi.clearAllMocks();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function authedRequest(url) {
  return new Request(url, { headers: { authorization: "Bearer test-secret" } });
}

describe("GET ?dryRun=true", () => {
  it("computes the plan with zero writes and zero email-provider calls", async () => {
    const { db, writes } = makeDb({
      private_financing_online_payments: [
        {
          owner_id: OWNER,
          id: PAYMENT_ID,
          account_id: "pf_acct_fixture",
          borrower_id: BORROWER,
          amount_cents: 12345,
          succeeded_at: new Date().toISOString(),
        },
      ],
      private_financing_payment_receipt_deliveries: [QUEUED_OWNER_ROW],
      private_financing_borrowers: [{ id: BORROWER, full_name: "Fixture Borrower", email: "borrower-fixture@example.com" }],
      private_financing_accounts: [{ product: "personal_loan" }],
      private_financing_autopay_attempts: [],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest("https://test/api?dryRun=true"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.dryRun).toBe(true);
    // The owner row exists; the borrower row is missing -> would be reconciled,
    // and the dry-run plan must include it (Finding 1: reconciled deliveries
    // with no persisted row yet still appear in wouldSend).
    expect(body.reconciled).toBe(1);
    // The queued owner row would be sent, and so would the planned borrower row.
    expect(body.sent).toBe(0);
    expect(body.wouldSend).toHaveLength(2);
    const byRecipient = new Map(body.wouldSend.map((entry) => [entry.to, entry.subject]));
    expect(byRecipient.get(DEFAULT_OWNER_NOTIFICATION_EMAIL)).toContain("Personal loan payment received");
    expect(byRecipient.get("borrower-fixture@example.com")).toContain("applied to your personal loan");

    // The guarantees: no email provider, no database changes.
    expect(createResendRentalEmailProvider).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it("still refuses unauthenticated callers in dry-run mode", async () => {
    const response = await GET(new Request("https://test/api?dryRun=true"));
    expect(response.status).toBe(401);
  });

  it("dry-run plan includes BOTH receipts when no delivery rows exist yet (Finding 1)", async () => {
    const { db, writes } = makeDb({
      private_financing_online_payments: [
        {
          owner_id: OWNER,
          id: PAYMENT_ID,
          account_id: "pf_acct_fixture",
          borrower_id: BORROWER,
          amount_cents: 50000,
          succeeded_at: new Date().toISOString(),
        },
      ],
      // No delivery rows at all: the reconciler must plan both receipts and
      // the dry-run plan must show both recipients.
      private_financing_payment_receipt_deliveries: [],
      private_financing_borrowers: [
        { id: BORROWER, full_name: "Fixture Borrower", email: "borrower-fixture@example.com" },
      ],
      private_financing_accounts: [{ product: "personal_loan" }],
      private_financing_autopay_attempts: [],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest("https://test/api?dryRun=true"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reconciled).toBe(2);
    expect(body.skippedAtDetection).toBe(0);
    expect(body.wouldSend).toHaveLength(2);
    const byRecipient = new Map(body.wouldSend.map((entry) => [entry.to, entry.subject]));
    expect(byRecipient.get(DEFAULT_OWNER_NOTIFICATION_EMAIL)).toContain("Personal loan payment received");
    expect(byRecipient.get("borrower-fixture@example.com")).toContain("applied to your personal loan");

    expect(createResendRentalEmailProvider).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it("defers the whole dry run during quiet hours: empty plan, zero writes (route-level)", async () => {
    vi.useFakeTimers();
    try {
      // 08:00Z = 03:00 America/Chicago — inside the 23:00-07:00 quiet window.
      vi.setSystemTime(new Date("2026-09-29T08:00:00Z"));
      process.env.OWNER_NOTIFICATION_QUIET_START = "23";
      process.env.OWNER_NOTIFICATION_QUIET_END = "7";
      const { db, writes } = makeDb({
        private_financing_online_payments: [
          {
            owner_id: OWNER,
            id: PAYMENT_ID,
            account_id: "pf_acct_fixture",
            borrower_id: BORROWER,
            amount_cents: 50000,
            succeeded_at: new Date().toISOString(),
          },
        ],
        private_financing_payment_receipt_deliveries: [QUEUED_OWNER_ROW],
        private_financing_borrowers: [
          { id: BORROWER, full_name: "Fixture Borrower", email: "borrower-fixture@example.com" },
        ],
        private_financing_accounts: [{ product: "personal_loan" }],
        private_financing_autopay_attempts: [],
      });
      createRentalWebhookClient.mockReturnValue(db);

      const response = await GET(authedRequest("https://test/api?dryRun=true"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.deferredQuietHours).toBe("whole_run_deferred");
      expect(body.wouldSend).toHaveLength(0);
      expect(body.sent).toBe(0);
      expect(createResendRentalEmailProvider).not.toHaveBeenCalled();
      expect(writes).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconciler never resets a row that reached 'sent' between the snapshot and the upsert (Finding 2)", async () => {
    // Stateful mock: the deliveries table is an in-memory map whose upsert
    // honors first-write-wins. The existence snapshot fires a side effect —
    // the webhook delivers both receipts (status 'sent') after the snapshot
    // was taken but before the reconciler's upsert runs.
    const store = new Map();
    const upsertCalls = [];
    const updateCalls = [];
    const PAYMENT_FIXTURE = {
      owner_id: OWNER,
      id: PAYMENT_ID,
      account_id: "pf_acct_fixture",
      borrower_id: BORROWER,
      amount_cents: 50000,
      succeeded_at: new Date().toISOString(),
    };
    const statefulDb = {
      from: vi.fn((table) => {
        let cols = null;
        const q = {
          select: (c) => {
            cols = c;
            return q;
          },
          eq: () => q,
          in: () => q,
          order: () => q,
          gte: () => q,
          range: () => q,
          is: () => q,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          upsert: (row, opts) => {
            upsertCalls.push({ table, row, opts });
            const key = `${row.payment_id}:${row.recipient_type}`;
            let inserted;
            if (opts?.ignoreDuplicates && store.has(key)) {
              inserted = [];
            } else {
              store.set(key, { ...row });
              inserted = [{ id: row.id }];
            }
            const uq = {
              select: () => uq,
              then: (resolve) => resolve({ data: inserted, error: null }),
            };
            return uq;
          },
          update: (patch) => {
            updateCalls.push({ table, patch });
            return q;
          },
          then: (resolve) => {
            if (table === "private_financing_online_payments")
              return resolve({ data: [PAYMENT_FIXTURE], error: null });
            if (table === "private_financing_borrowers")
              return resolve({
                data: [{ id: BORROWER, email: "borrower-fixture@example.com" }],
                error: null,
              });
            if (table === "private_financing_payment_receipt_deliveries") {
              if (cols === "payment_id,recipient_type") {
                // The race: the webhook's queue writes land here, after the
                // snapshot read but before the reconciler's upsert.
                for (const recipientType of ["owner", "borrower"]) {
                  const key = `${PAYMENT_ID}:${recipientType}`;
                  if (!store.has(key))
                    store.set(key, {
                      payment_id: PAYMENT_ID,
                      recipient_type: recipientType,
                      status: "sent",
                    });
                }
                return resolve({ data: [], error: null });
              }
              // loadDeliveryCandidates: only queued/failed/sending rows are
              // candidates; the sent rows are terminal and stay out.
              const rows = [...store.values()].filter((row) =>
                ["queued", "failed", "sending"].includes(row.status),
              );
              return resolve({ data: rows, error: null });
            }
            return resolve({ data: [], error: null });
          },
        };
        return q;
      }),
    };
    createRentalWebhookClient.mockReturnValue(statefulDb);

    const response = await GET(authedRequest("https://test/api"));
    const body = await response.json();

    expect(response.status).toBe(200);
    // The reconciler attempted both upserts with first-write-wins semantics.
    const deliveryUpserts = upsertCalls.filter(
      (call) => call.table === "private_financing_payment_receipt_deliveries",
    );
    expect(deliveryUpserts).toHaveLength(2);
    for (const call of deliveryUpserts) {
      expect(call.opts.ignoreDuplicates).toBe(true);
    }
    // Neither sent row was reset to queued: no duplicate-send risk.
    expect(store.get(`${PAYMENT_ID}:owner`).status).toBe("sent");
    expect(store.get(`${PAYMENT_ID}:borrower`).status).toBe("sent");
    // Honest counts: the no-op upserts are not reported as reconciled.
    expect(body.reconciled).toBe(0);
    expect(body.skippedAtDetection).toBe(0);
    // Nothing was deliverable, so no claim/outcome writes happened.
    expect(updateCalls).toHaveLength(0);
    expect(body.sent).toBe(0);
  });
});
