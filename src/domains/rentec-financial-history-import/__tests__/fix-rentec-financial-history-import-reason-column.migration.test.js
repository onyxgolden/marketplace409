import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260823010000_fix_rentec_financial_history_import_reason_column.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("fix: Rentec financial history import reason-column bug", () => {
  it("selects reasons.reason (the lateral subquery alias), not x.reason (which doesn't exist)", () => {
    expect(sql).toContain("select reasons.reason into v_invalid_reason");
    expect(sql).not.toContain("select x.reason into v_invalid_reason");
  });

  it("re-creates the same function signature so it replaces the original, not overloads it", () => {
    expect(sql).toContain("create or replace function approve_rentec_financial_history_import(");
    expect(sql).toContain("p_owner_id text,");
    expect(sql).toContain("p_import_batch_id text,");
    expect(sql).toContain("p_rows jsonb");
    expect(sql).toContain("revoke all on function approve_rentec_financial_history_import(text, text, jsonb) from public");
    expect(sql).toContain("grant execute on function approve_rentec_financial_history_import(text, text, jsonb) to authenticated");
  });

  it("preserves security invoker and owner authentication checks unchanged", () => {
    expect(sql).toContain("security invoker");
    expect(sql).not.toContain("security definer");
    expect(sql).toContain("p_owner_id <> authenticated_owner_id");
  });

  it("preserves idempotency via financial_events' own unique index, unchanged", () => {
    expect(sql).toContain("on conflict (owner_id, source_system, source_record_id) where source_record_id is not null do nothing");
  });

  it("preserves the audit-summary write, unchanged", () => {
    expect(sql).toContain("insert into rentec_financial_history_import_batches");
  });

  it("still forces source_system to rentec_api server-side", () => {
    expect(sql).toContain("'rentec_api', x.source_record_id");
  });

  it("NOT applied remotely by this change, matching the containment migration's convention", () => {
    expect(sql).toContain("not applied remotely by this change");
  });
});
