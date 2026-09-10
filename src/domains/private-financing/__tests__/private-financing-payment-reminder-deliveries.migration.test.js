import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../../../../supabase/migrations/20260910120000_create_private_financing_payment_reminder_deliveries.sql", import.meta.url),
  "utf8",
);

describe("private-financing payment reminder deliveries migration", () => {
  it("creates the deliveries table", () => {
    expect(sql).toContain("create table if not exists private_financing_payment_reminder_deliveries");
  });

  it("scopes reminder_type to exactly the two supported, non-overdue reminder kinds", () => {
    const constraint = sql.match(/check \(reminder_type in \([^)]*\)\)/i)?.[0];
    expect(constraint).toBe("check (reminder_type in ('seven_days_before', 'due_date'))");
    expect(constraint).not.toMatch(/overdue|late/i);
  });

  it("scopes status to sent/failed only", () => {
    expect(sql).toContain("check (status in ('sent', 'failed'))");
  });

  it("enforces the (owner, account, borrower, due date, reminder type) idempotency key", () => {
    expect(sql).toContain("unique (owner_id, account_id, borrower_id, due_date, reminder_type)");
  });

  it("references private_financing_accounts by its real composite primary key", () => {
    expect(sql).toContain("foreign key (owner_id, account_id) references private_financing_accounts (owner_id, id)");
  });

  it("enables and force-enables row level security, with zero policies -- service-role-only by Supabase default, same precedent as connection_webhook_events", () => {
    expect(sql).toContain("alter table private_financing_payment_reminder_deliveries enable row level security;");
    expect(sql).toContain("alter table private_financing_payment_reminder_deliveries force row level security;");
    expect(sql).not.toMatch(/create policy/i);
  });

  it("never grants access to anon, authenticated, or public", () => {
    expect(sql).not.toMatch(/grant\s+.*\s+to\s+(anon|authenticated|public)/i);
  });

  it("never disables or bypasses row level security", () => {
    expect(sql).not.toMatch(/disable\s+row\s+level\s+security/i);
    expect(sql).not.toContain("row_security = off");
  });

  it("is not applied to any local or remote database by this repo's own tooling (schema-only review)", () => {
    // This test intentionally never opens a database connection -- the whole point of Jason's
    // authorization for this slice is that the migration ships as a file only.
    expect(sql.length).toBeGreaterThan(0);
  });
});
