import { describe, expect, it } from "vitest";
import { planReminderRun } from "../reminderRunPlanner.js";

const ASOF = "2026-03-01"; // matches each fixture account's firstPaymentDueDate below -- "due today"

function accountFixture({ ownerId = "owner_1", accountId = "acct_1", status = "active", borrowers = [], existingDeliveries = [], firstPaymentDueDate = "2026-03-01", originalPrincipalCents = 1_000_000, regularPaymentCents = 100_000 } = {}) {
  return {
    ownerId,
    accountId,
    status,
    eventRows: [
      {
        id: "evt_open",
        owner_id: ownerId,
        account_id: accountId,
        event_type: "account_opened",
        event_origin: "interactive_user",
        created_by: "11111111-1111-1111-1111-111111111111",
        effective_date: "2026-01-01",
        ledger_sequence: 1,
        recorded_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    componentRows: [
      {
        owner_id: ownerId,
        id: "comp_c1_v1",
        account_id: accountId,
        component_key: "c1",
        label: "c1",
        original_principal_cents: originalPrincipalCents,
        rate_bps: 0,
        day_count_convention: "actual_365",
        scheduled_component_amount_cents: regularPaymentCents,
        allocation_priority: 1,
        effective_date: "2026-01-01",
        version_number: 1,
      },
    ],
    termsRows: [
      {
        owner_id: ownerId,
        id: "terms_v1",
        account_id: accountId,
        version_number: 1,
        payment_frequency: "monthly",
        first_payment_due_date: firstPaymentDueDate,
        regular_scheduled_payment_amount_cents: regularPaymentCents,
        maturity_date: null,
        allocation_policy: "scheduled_component_order",
        extra_payment_allocation_policy: "highest_rate_first_extra",
        prepayment_policy: "allowed_without_penalty_does_not_advance_due_date",
        day_count_convention: "actual_365",
        effective_date: "2026-01-01",
        acting_seller_id: ownerId,
        amendment_reason: null,
      },
    ],
    borrowers,
    existingDeliveries,
    ownerDisplayName: "FORGE Private Financing",
  };
}

describe("planReminderRun", () => {
  it("sends to every active borrower on an eligible account", () => {
    const account = accountFixture({
      borrowers: [
        { borrowerId: "b1", email: "alex@example.test", fullName: "Alex", membershipStatus: "active" },
        { borrowerId: "b2", email: "jordan@example.test", fullName: "Jordan", membershipStatus: "active" },
      ],
    });
    const results = planReminderRun({ asOfDate: ASOF, accounts: [account], siteUrl: "https://example.test" });
    const sends = results.filter((r) => r.action === "send");
    expect(sends).toHaveLength(2);
    expect(sends.map((r) => r.email).sort()).toEqual(["alex@example.test", "jordan@example.test"]);
    expect(sends[0].emailBody).toContain("https://example.test/forge/private-financing/portal?email=");
  });

  it("does not send to a suspended or revoked membership", () => {
    const account = accountFixture({
      borrowers: [
        { borrowerId: "b1", email: "alex@example.test", fullName: "Alex", membershipStatus: "active" },
        { borrowerId: "b2", email: "suspended@example.test", fullName: "Suspended One", membershipStatus: "suspended" },
      ],
    });
    const results = planReminderRun({ asOfDate: ASOF, accounts: [account], siteUrl: "https://example.test" });
    const sends = results.filter((r) => r.action === "send");
    expect(sends).toHaveLength(1);
    expect(sends[0].email).toBe("alex@example.test");
  });

  it("collapses a duplicate normalized email within one account to a single send", () => {
    const account = accountFixture({
      borrowers: [
        { borrowerId: "b1", email: "Alex@Example.test", fullName: "Alex", membershipStatus: "active" },
        { borrowerId: "b2", email: " alex@example.test ", fullName: "Alex Again", membershipStatus: "active" },
      ],
    });
    const results = planReminderRun({ asOfDate: ASOF, accounts: [account], siteUrl: "https://example.test" });
    expect(results.filter((r) => r.action === "send")).toHaveLength(1);
    expect(results.filter((r) => r.action === "skip" && r.reason === "duplicate_email_in_account")).toHaveLength(1);
  });

  it("does not send again once a delivery is already recorded as sent for this exact (account, borrower, due date, reminder type)", () => {
    const account = accountFixture({
      borrowers: [{ borrowerId: "b1", email: "alex@example.test", fullName: "Alex", membershipStatus: "active" }],
      existingDeliveries: [{ borrowerId: "b1", dueDate: "2026-03-01", reminderType: "due_date", status: "sent" }],
    });
    const results = planReminderRun({ asOfDate: ASOF, accounts: [account], siteUrl: "https://example.test" });
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("already_sent");
  });

  it("retries safely: a prior FAILED delivery does not block a new send attempt", () => {
    const account = accountFixture({
      borrowers: [{ borrowerId: "b1", email: "alex@example.test", fullName: "Alex", membershipStatus: "active" }],
      existingDeliveries: [{ borrowerId: "b1", dueDate: "2026-03-01", reminderType: "due_date", status: "failed" }],
    });
    const results = planReminderRun({ asOfDate: ASOF, accounts: [account], siteUrl: "https://example.test" });
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("send");
  });

  it("keeps two accounts under different owners fully isolated even when they share a borrower email and delivery history", () => {
    const ownerA = accountFixture({
      ownerId: "owner_a",
      accountId: "acct_a",
      borrowers: [{ borrowerId: "b1", email: "shared@example.test", fullName: "Shared Borrower", membershipStatus: "active" }],
      existingDeliveries: [{ borrowerId: "b1", dueDate: "2026-03-01", reminderType: "due_date", status: "sent" }], // already sent under owner_a
    });
    const ownerB = accountFixture({
      ownerId: "owner_b",
      accountId: "acct_b",
      borrowers: [{ borrowerId: "b1", email: "shared@example.test", fullName: "Shared Borrower", membershipStatus: "active" }],
      existingDeliveries: [], // nothing sent yet under owner_b
    });
    const results = planReminderRun({ asOfDate: ASOF, accounts: [ownerA, ownerB], siteUrl: "https://example.test" });
    const forA = results.find((r) => r.ownerId === "owner_a");
    const forB = results.find((r) => r.ownerId === "owner_b");
    expect(forA.action).toBe("already_sent");
    expect(forB.action).toBe("send"); // owner_a's prior send must not suppress owner_b's
  });

  it("skips (not unavailable) an account whose next due date is not today or 7 days out", () => {
    const account = accountFixture({ firstPaymentDueDate: "2026-06-01", borrowers: [{ borrowerId: "b1", email: "alex@example.test", fullName: "Alex", membershipStatus: "active" }] });
    const results = planReminderRun({ asOfDate: ASOF, accounts: [account], siteUrl: "https://example.test" });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ownerId: "owner_1", accountId: "acct_1", action: "skip", reason: "not_due_soon" });
  });

  it("marks an account unavailable (not skip) when the due-state engine cannot compute a due date, and never invents a send", () => {
    const account = accountFixture();
    account.termsRows[0].payment_frequency = "quarterly"; // outside V1's supported envelope
    const results = planReminderRun({ asOfDate: ASOF, accounts: [account], siteUrl: "https://example.test" });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ action: "unavailable", reason: "due_state_unsupported" });
  });

  it("skips an account with no active borrower memberships", () => {
    const account = accountFixture({ borrowers: [{ borrowerId: "b1", email: "revoked@example.test", fullName: "Revoked", membershipStatus: "revoked" }] });
    const results = planReminderRun({ asOfDate: ASOF, accounts: [account], siteUrl: "https://example.test" });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ action: "skip", reason: "no_active_borrowers" });
  });
});
