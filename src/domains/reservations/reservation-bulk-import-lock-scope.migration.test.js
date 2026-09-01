import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/20260901000700_fix_reservation_bulk_import_lock_scope.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("reservation bulk import lock-scope repair", () => {
  it("redefines import_reservation_inventory_bulk with the same signature", () => {
    expect(sql).toContain("create or replace function import_reservation_inventory_bulk(");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
  });

  it("locks per owner, not per owner+import id, so concurrent imports for one owner serialize", () => {
    expect(sql).toContain("perform pg_advisory_xact_lock(hashtextextended(p_owner_id, 0));");
    expect(sql).not.toContain("hashtextextended(p_owner_id || ':' || p_import_id, 0)");
  });

  it("still treats a re-submitted import id with a matching plan digest as idempotent", () => {
    expect(sql).toContain("if v_existing.plan_digest <> p_plan_digest then");
    expect(sql).toContain("return v_existing.result;");
  });

  it("keeps execute revoked from public and granted only to authenticated", () => {
    const signature = "import_reservation_inventory_bulk(text,text,text,jsonb)";
    expect(sql).toContain(`revoke all on function ${signature} from public;`);
    expect(sql).toContain(`grant execute on function ${signature} to authenticated;`);
  });
});
