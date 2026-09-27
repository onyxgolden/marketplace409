import { describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path";
const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260926210000_rental_owner_payment_notifications.sql"), "utf8");

describe("rental owner payment notifications migration", () => {
  it("creates the notification outbox table", () => {
    expect(sql).toContain("create table if not exists rental_owner_notifications");
  });

  it("uses the composite owner-scoped primary key per rental convention", () => {
    expect(sql).toMatch(/primary key\s*\(\s*owner_id\s*,\s*id\s*\)/);
  });

  it("covers exactly the four owner events", () => {
    expect(sql).toContain("upcoming_autopay");
    expect(sql).toContain("manual_payment_received");
    expect(sql).toContain("payment_completed");
    expect(sql).toContain("payment_failed");
    expect(sql).toMatch(/check\s*\(\s*event_type in\s*\('upcoming_autopay',\s*'manual_payment_received',\s*'payment_completed',\s*'payment_failed'\)/);
  });

  it("tracks the queue lifecycle including the disabled-sending terminal state", () => {
    expect(sql).toMatch(/check\s*\(\s*status in\s*\('queued',\s*'sending',\s*'sent',\s*'failed',\s*'skipped_disabled',\s*'superseded'\)/);
    expect(sql).toContain("provider_message_id");
    expect(sql).toContain("attempt_count");
  });

  it("carries a claim token so outcome writes are fenced to the claiming run", () => {
    expect(sql).toContain("claim_token");
  });

  it("is service-role-only: forced RLS with zero policies", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("force row level security");
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/revoke all on table rental_owner_notifications from public, anon, authenticated/);
  });
});
