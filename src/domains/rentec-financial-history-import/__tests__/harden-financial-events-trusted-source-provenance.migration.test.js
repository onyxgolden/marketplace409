import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260824010000_harden_financial_events_trusted_source_provenance.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("harden: financial_events trusted-source provenance", () => {
  it("restricts the owner-scoped insert policy to source_system = manual", () => {
    expect(sql).toContain('create policy "financial_events_owner_insert"');
    expect(sql).toContain("with check ( owner_id = auth.uid()::text and source_system = 'manual' )");
  });

  it("restricts the owner-scoped update policy to source_system = manual on both sides", () => {
    expect(sql).toContain('create policy "financial_events_owner_update"');
    expect(sql).toContain("using ( owner_id = auth.uid()::text and source_system = 'manual' ) with check ( owner_id = auth.uid()::text and source_system = 'manual' )");
  });

  it("restricts the owner-scoped delete policy to source_system = manual", () => {
    expect(sql).toContain('create policy "financial_events_owner_delete"');
    expect(sql).toContain("using ( owner_id = auth.uid()::text and source_system = 'manual' )");
  });

  it("drops each policy before recreating it, so re-running this migration is idempotent", () => {
    expect(sql).toContain('drop policy if exists "financial_events_owner_insert" on financial_events');
    expect(sql).toContain('drop policy if exists "financial_events_owner_update" on financial_events');
    expect(sql).toContain('drop policy if exists "financial_events_owner_delete" on financial_events');
  });

  it("promotes approve_rentec_financial_history_import to security definer with row_security off", () => {
    expect(sql).toContain("create or replace function approve_rentec_financial_history_import(");
    expect(sql).toContain("language plpgsql security definer");
    expect(sql).not.toContain("language plpgsql security invoker");
    expect(sql).toContain("set row_security = off");
  });

  it("preserves every existing validation check in the promoted function, unchanged", () => {
    expect(sql).toContain("p_owner_id <> authenticated_owner_id");
    expect(sql).toContain("select reasons.reason into v_invalid_reason");
    expect(sql).toContain("on conflict (owner_id, source_system, source_record_id) where source_record_id is not null do nothing");
    expect(sql).toContain("insert into rentec_financial_history_import_batches");
    expect(sql).toContain("'rentec_api', x.source_record_id");
  });

  it("keeps the function grant scoped to authenticated only", () => {
    expect(sql).toContain("revoke all on function approve_rentec_financial_history_import(text, text, jsonb) from public");
    expect(sql).toContain("grant execute on function approve_rentec_financial_history_import(text, text, jsonb) to authenticated");
  });
});
