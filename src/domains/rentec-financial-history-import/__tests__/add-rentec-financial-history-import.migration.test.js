import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260823000000_add_rentec_financial_history_import.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("Rentec financial history import migration", () => {
  it("creates an owner-scoped audit batch table", () => {
    expect(sql).toContain("create table if not exists rentec_financial_history_import_batches");
    expect(sql).toContain("owner_id text not null");
    expect(sql).toContain("import_batch_id text not null");
    expect(sql).toContain("requested_count integer not null check (requested_count >= 0)");
    expect(sql).toContain("inserted_count integer not null check (inserted_count >= 0)");
    expect(sql).toContain("skipped_count integer not null check (skipped_count >= 0)");
  });

  it("protects the audit table with owner-scoped, forced row level security", () => {
    expect(sql).toContain("alter table rentec_financial_history_import_batches enable row level security");
    expect(sql).toContain("alter table rentec_financial_history_import_batches force row level security");
    expect(sql).toContain('create policy "rentec_financial_history_import_batches_owner_select" on rentec_financial_history_import_batches');
    expect(sql).toContain('create policy "rentec_financial_history_import_batches_owner_insert" on rentec_financial_history_import_batches');
    expect(sql).toContain("using (owner_id = auth.uid()::text)");
    expect(sql).toContain("for insert to authenticated with check (owner_id = auth.uid()::text)");
  });

  it("approve_rentec_financial_history_import is owner-authenticated, security invoker, and least-privilege granted", () => {
    expect(sql).toContain("create or replace function approve_rentec_financial_history_import(");
    expect(sql).toContain("security invoker");
    expect(sql).not.toContain("security definer");
    expect(sql).toContain("p_owner_id <> authenticated_owner_id");
    expect(sql).toContain("revoke all on function approve_rentec_financial_history_import(text, text, jsonb) from public");
    expect(sql).toContain("grant execute on function approve_rentec_financial_history_import(text, text, jsonb) to authenticated");
  });

  it("caps batch size and rejects an empty row set", () => {
    expect(sql).toContain("jsonb_array_length(p_rows) = 0 then");
    expect(sql).toContain("jsonb_array_length(p_rows) > 1000 then");
  });

  it("forces source_system to rentec_api server-side — never trusts a client-supplied source_system", () => {
    const insertMatch = sql.match(/insert into financial_events \([^)]*\)[\s\S]*?returning id/);
    expect(insertMatch).toBeTruthy();
    // The literal 'rentec_api' appears in the select list feeding the insert, not a column pulled from x(...).
    expect(insertMatch[0]).toContain("'rentec_api', x.source_record_id");
    // jsonb_to_recordset's column list never even exposes a source_system field to read from.
    const recordsetMatch = sql.match(/jsonb_to_recordset\(p_rows\) as x\(([^)]*)\)/);
    expect(recordsetMatch[1]).not.toContain("source_system");
  });

  it("fails closed on structurally invalid rows before writing anything (checked ahead of the insert)", () => {
    const invalidCheckIndex = sql.indexOf("v_invalid_reason is not null");
    const insertIndex = sql.indexOf("insert into financial_events (");
    expect(invalidCheckIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(invalidCheckIndex);
    expect(sql).toContain("transaction_kind not in ('income', 'expense', 'asset_purchase', 'asset_sale', 'liability_payment', 'transfer')");
    expect(sql).toContain("x.amount is null or x.amount <= 0");
  });

  it("relies on financial_events' own unique index for idempotency via on conflict do nothing, never raising on a duplicate", () => {
    expect(sql).toContain("on conflict (owner_id, source_system, source_record_id) where source_record_id is not null do nothing");
  });

  it("computes skipped_count as requested minus actually-inserted, so a partial-duplicate batch is still fully audited", () => {
    expect(sql).toContain("v_skipped_count := v_requested_count - v_inserted_count");
  });

  it("writes exactly one audit summary row per approval call", () => {
    const auditInserts = (sql.match(/insert into rentec_financial_history_import_batches/g) || []).length;
    expect(auditInserts).toBe(1);
  });

  it("never writes to rental_payments, rent_charges, settlements, or any reconciliation/approval table", () => {
    expect(sql).not.toMatch(/insert into rental_payments/);
    expect(sql).not.toMatch(/(update|insert into) rent_charges/);
    expect(sql).not.toMatch(/(update|insert into) settlements/);
    expect(sql).not.toMatch(/(update|insert into) rentec_transaction_imports/);
  });

  it("only ever writes to financial_events and its own audit table", () => {
    const insertTargets = [...sql.matchAll(/insert into (\w+)/g)].map((match) => match[1]);
    expect(new Set(insertTargets)).toEqual(new Set(["financial_events", "rentec_financial_history_import_batches"]));
  });

  it("NOT applied remotely by this change, matching the containment migration's convention", () => {
    expect(sql).toContain("not applied remotely by this change");
  });
});
