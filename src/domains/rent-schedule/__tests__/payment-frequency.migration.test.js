// R13: payment frequency migration contract -- the new columns exist with the
// right constraints and defaults, and the period check accepts full due dates.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261001040000_rental_payment_frequency.sql"), "utf8")
  .toLowerCase().replace(/\s+/g, " ");
describe("payment frequency migration", () => {
  it("adds payment_frequency with the weekly/biweekly/monthly check and a monthly default", () => {
    expect(sql).toContain("add column if not exists payment_frequency text not null default 'monthly'");
    expect(sql).toContain("check (payment_frequency in ('weekly', 'biweekly', 'monthly'))");
  });
  it("adds the anchor date and backfills it from the effective start date", () => {
    expect(sql).toContain("add column if not exists payment_anchor_date date");
    expect(sql).toContain("set payment_anchor_date = effective_start_date");
  });
  it("adds the owner gate for tenant self-scheduling on rental_billing_settings", () => {
    expect(sql).toContain("add column if not exists tenant_may_change_payment_frequency boolean not null default true");
  });
  it("broadens the charge period check to accept full due dates alongside months", () => {
    expect(sql).toContain("drop constraint if exists rent_charges_period_check");
    expect(sql).toContain("period ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$'");
  });
  it("rewrites generate_monthly_rent_charge so weekly/bi-weekly periods carry full-date periods", () => {
    expect(sql).toContain("create or replace function generate_monthly_rent_charge");
    expect(sql).toContain("required_period !~ '^\\d{4}-\\d{2}-\\d{2}$'");
  });
  it("has no destructive statements", () => {
    expect(sql).not.toContain("drop table");
    expect(sql).not.toContain("delete from");
    expect(sql).not.toContain("truncate");
  });
});
