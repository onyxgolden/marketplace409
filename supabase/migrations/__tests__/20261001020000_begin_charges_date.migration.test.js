import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Rentec-parity R10: move-in date vs "begin charges on" date. Static contract
// over the migration SQL — the migration itself only runs against Supabase
// with Jason's explicit approval.
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261001020000_begin_charges_date.sql"), "utf8")
  .toLowerCase().replace(/\s+/g, " ");

describe("R10 begin-charges date migration", () => {
  it("adds the column, backfills from the move-in date, then constrains it", () => {
    expect(sql).toContain("alter table rental_leases add column begin_charges_date date");
    // Backfill rule: existing leases get begin_charges_date = start_date.
    // This can only ever suppress future generation, never create a charge —
    // no bogus past-due balances for existing tenants.
    expect(sql).toContain("update rental_leases set begin_charges_date = start_date where begin_charges_date is null");
    expect(sql).toContain("alter table rental_leases alter column begin_charges_date set not null");
  });

  it("persists begin_charges_date in save_rental_lease, defaulting to the start date", () => {
    expect(sql).toContain("begin_charges_date, monthly_rent_cents");
    expect(sql).toContain("coalesce(nullif(p_lease ->> 'begin_charges_date', '')::date, (p_lease ->> 'start_date')::date)");
    expect(sql).toContain("begin_charges_date = excluded.begin_charges_date");
  });

  it("keeps the Rentec import path working with the NOT NULL column", () => {
    expect(sql).toContain("create or replace function commit_rentec_rental_import");
    expect(sql).toContain("begin_charges_date, monthly_rent_cents, currency_code, rent_due_day, source_system, source_record_id");
  });

  it("replaces update_lease_terms with an 8-arg signature where null keeps the current value", () => {
    // A changed signature cannot use CREATE OR REPLACE alone — the old
    // 7-arg overload must be dropped or it lingers beside the new one.
    expect(sql).toContain("drop function if exists update_lease_terms(text, text, bigint, integer, date, date, integer)");
    expect(sql).toContain("p_begin_charges_date date");
    expect(sql).toContain("begin_charges_date = coalesce(p_begin_charges_date, begin_charges_date)");
    expect(sql).toContain("grant execute on function update_lease_terms(text, text, bigint, integer, date, date, integer, date) to authenticated");
  });

  it("gates generate_monthly_rent_charge on the lease's begin-charges date without touching existing rows", () => {
    expect(sql).toContain("select begin_charges_date into lease_begin_charges_date from rental_leases");
    expect(sql).toContain("if lease_begin_charges_date is not null and required_due_date < lease_begin_charges_date");
    // Deliberately no void sweep: already-generated charges are Brandy's
    // books and must never be rewritten by this migration.
    expect(sql).not.toContain("voided automatically");
    expect(sql).not.toMatch(/update rent_charges set status = 'void'/);
  });
});
