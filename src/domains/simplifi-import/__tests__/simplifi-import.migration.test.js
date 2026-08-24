import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260824000000_add_simplifi_csv_import.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("Simplifi CSV import persistence", () => {
  it("creates batch, account mapping, and row audit tables without raw CSV storage", () => {
    for (const table of ["simplifi_import_batches", "simplifi_account_mappings", "simplifi_import_rows"]) {
      expect(sql).toContain(`create table if not exists ${table}`);
      expect(sql).toContain(`alter table ${table} force row level security`);
    }
    expect(sql).not.toContain("raw_csv");
    expect(sql).not.toContain("file_bytes");
  });

  it("owner-scopes every policy and validates account ownership", () => {
    expect(sql.match(/owner_id = auth\.uid\(\)::text/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("a.id = financial_account_id and a.owner_id = auth.uid()::text");
  });

  it("deduplicates batches, active mappings, and imported row fingerprints", () => {
    expect(sql).toContain("unique (owner_id, file_hash, preview_hash)");
    expect(sql).toContain("on conflict (owner_id, file_hash, preview_hash) do nothing");
    expect(sql).toContain("idx_simplifi_mapping_active_label");
    expect(sql).toContain("unique (owner_id, batch_id, row_fingerprint)");
  });

  it("writes approved rows through one owner-authenticated, idempotent RPC", () => {
    expect(sql).toContain("create or replace function approve_simplifi_csv_import");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("p_owner_id is distinct from auth.uid()::text");
    expect(sql).toContain("only freshly recomputed safe_missing rows may be approved");
    expect(sql).toContain("previously approved under different mapping or evidence");
    expect(sql).toContain("insert into financial_events");
    expect(sql).toContain("'quicken_simplifi_csv'");
    expect(sql).toContain("on conflict (owner_id, source_system, source_record_id) do nothing");
    expect(sql).toContain("grant execute on function approve_simplifi_csv_import");
  });

  it("never mutates rental or Stripe domains", () => {
    expect(sql).not.toMatch(/insert into rental_/);
    expect(sql).not.toMatch(/update rental_/);
    expect(sql).not.toContain("stripe");
  });
});
