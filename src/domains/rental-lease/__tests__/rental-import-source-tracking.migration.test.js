import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260816000100_add_rental_import_source_tracking.sql"),
  "utf8",
);

const TABLES = ["rental_units", "rental_tenants", "rental_leases", "rental_lease_tenants"];

describe("rental import source tracking migration", () => {
  it.each(TABLES)("adds nullable source columns to %s", (table) => {
    expect(sql).toContain(`alter table ${table}`);
    expect(sql).toMatch(new RegExp(`alter table ${table}[\\s\\S]*?add column if not exists source_system text`));
    expect(sql).toMatch(new RegExp(`alter table ${table}[\\s\\S]*?add column if not exists source_record_id text`));
  });

  it.each(TABLES)("enforces a partial unique index on %s scoped to imported rows only", (table) => {
    expect(sql).toContain(`create unique index if not exists idx_${table}_owner_source_record`);
    expect(sql).toContain(`on ${table}(owner_id, source_system, source_record_id)`);
  });

  it("only enforces uniqueness when both source columns are set, never for manual rows", () => {
    const clauses = sql.match(/where source_system is not null and source_record_id is not null/g);
    expect(clauses?.length).toBe(TABLES.length);
  });

  it("does not add a not-null constraint that would require backfilling existing rows", () => {
    expect(sql).not.toContain("source_system text not null");
    expect(sql).not.toContain("source_record_id text not null");
  });
});
