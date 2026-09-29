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

// Deterministic mock db: tableSequences maps each table to the list of query
// builders consumed in call order.
function sequenceDb(tableSequences) {
  const counters = {};
  return {
    from: vi.fn((table) => {
      const seq = tableSequences[table];
      if (!seq) throw new Error(`unexpected from(${table}) call`);
      const i = counters[table] || 0;
      counters[table] = i + 1;
      if (i >= seq.length) throw new Error(`too many from(${table}) calls`);
      return seq[i];
    }),
  };
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
});
