import { describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path";
const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260925150000_rental_rent_reminder_deliveries.sql"), "utf8");

describe("rental rent reminder deliveries migration", () => {
  it("creates the delivery ledger table", () => {
    expect(sql).toContain("create table if not exists rental_rent_reminder_deliveries");
  });

  it("uses the composite owner-scoped primary key per rental convention", () => {
    expect(sql).toMatch(/primary key\s*\(\s*owner_id\s*,\s*id\s*\)/);
  });

  it("dedups at the logical grain (owner, charge, tenant, due date, reminder type)", () => {
    expect(sql).toMatch(/unique\s*\(\s*owner_id\s*,\s*charge_id\s*,\s*tenant_id\s*,\s*due_date\s*,\s*reminder_type\s*\)/);
  });

  it("references the owner-scoped rent_charges identity", () => {
    expect(sql).toMatch(/foreign key\s*\(\s*owner_id\s*,\s*charge_id\s*\)\s*references\s*rent_charges\s*\(\s*owner_id\s*,\s*id\s*\)/);
  });

  it("restricts reminder types to the courtesy cadence (no overdue)", () => {
    expect(sql).toContain("seven_days_before");
    expect(sql).toContain("due_date");
    expect(sql).not.toContain("overdue");
    expect(sql).toMatch(/check\s*\(\s*reminder_type in\s*\('seven_days_before',\s*'due_date'\)/);
  });

  it("tracks the claim-before-send lifecycle", () => {
    expect(sql).toMatch(/check\s*\(\s*status in\s*\('sending',\s*'sent',\s*'failed',\s*'superseded'\)/);
    expect(sql).toContain("provider_message_id");
    expect(sql).toContain("attempt_count");
  });

  it("is service-role-only: forced RLS with zero policies", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("force row level security");
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/revoke all on table rental_rent_reminder_deliveries from public, anon, authenticated/);
  });
});
