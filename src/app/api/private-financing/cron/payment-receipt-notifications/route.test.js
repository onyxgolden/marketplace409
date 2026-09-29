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
    // The owner row exists; the borrower row is missing -> would be reconciled.
    expect(body.reconciled).toBe(1);
    // The queued owner row would be sent.
    expect(body.sent).toBe(0);
    expect(body.wouldSend).toHaveLength(1);
    expect(body.wouldSend[0].to).toBe(DEFAULT_OWNER_NOTIFICATION_EMAIL);
    expect(body.wouldSend[0].subject).toContain("Personal loan payment received");

    // The guarantees: no email provider, no database changes.
    expect(createResendRentalEmailProvider).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it("still refuses unauthenticated callers in dry-run mode", async () => {
    const response = await GET(new Request("https://test/api?dryRun=true"));
    expect(response.status).toBe(401);
  });
});
