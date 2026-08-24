import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readMigration = (name) => readFileSync(
  resolve(process.cwd(), `supabase/migrations/${name}`),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

const sql = readMigration("20260824050000_accept_v2_simplifi_fingerprints.sql");
const priorSql = readMigration("20260824040000_allow_personal_simplifi_import_rows.sql");

describe("approve_simplifi_csv_import v2 fingerprint acceptance", () => {
  it("re-declares the RPC rather than editing the already-applied 20260824040000 migration", () => {
    expect(priorSql).toContain("^v1:[0-9a-f]{64}$");
    expect(priorSql).not.toContain("v[12]");
  });

  it("accepts both legacy v1 and corrected v2 fingerprint formats", () => {
    expect(sql).toContain("^v[12]:[0-9a-f]{64}$");
  });

  it("validates fingerprint_version and stores it instead of hardcoding 'v1'", () => {
    expect(sql).toContain("^v[12]$");
    expect(sql).not.toContain("'v1', v_row->>'evidence_hash'");
    expect(sql).toContain("v_row->>'fingerprint_version', v_row->>'evidence_hash'");
  });

  it("preserves the security-definer settings and every prior business_scope/classification check", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set row_security = off");
    expect(sql).toContain("only freshly recomputed safe_missing or personal rows may be approved");
    expect(sql).toContain("v_business_scope := case when v_row->>'classification' = 'personal'");
    expect(sql).toContain("grant execute on function approve_simplifi_csv_import");
  });
});
