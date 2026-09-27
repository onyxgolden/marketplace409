import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Structural contract for 20260927140000_fund_transfer.sql.
// This test never touches a database: it proves the migration text carries the
// ledger-parity slice 3 contract — the transfer_group_id column on
// financial_events and the atomic create_fund_transfer RPC (two linked legs,
// one transaction, owner-scoped, authenticated-only, server-side validation).
// The migration itself is NOT applied anywhere by this test.
//
// Note on matching: the migration file is lowercased and whitespace-normalized
// before matching (runs of whitespace collapse to one space, spaces after
// commas are KEPT). Expected strings below were verified character-by-character
// against the normalized file.
const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260927140000_fund_transfer.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("fund transfer migration — structural contract", () => {
  it("adds transfer_group_id to financial_events with an index", () => {
    expect(sql).toContain("alter table financial_events add column if not exists transfer_group_id text");
    expect(sql).toContain("idx_financial_events_transfer_group");
    expect(sql).toContain("on financial_events(transfer_group_id)");
  });

  it("defines create_fund_transfer as a SECURITY INVOKER RPC", () => {
    expect(sql).toContain("create or replace function create_fund_transfer(");
    expect(sql).toContain("p_from_account_id text, p_to_account_id text, p_event jsonb");
    expect(sql).toContain("language plpgsql security invoker");
    expect(sql).toContain("if effective_owner_id is null then");
    expect(sql).toContain("revoke all on function create_fund_transfer(text, text, jsonb) from public");
    expect(sql).toContain("grant execute on function create_fund_transfer(text, text, jsonb) to authenticated");
  });

  it("resolves the effective owner so an authorized co-owner's transfer lands in the workspace owner's books", () => {
    // Same pattern as the financial-asset RPCs: derive the owner inside the
    // function instead of trusting auth.uid() directly.
    expect(sql).toContain("effective_owner_id text := public.resolve_effective_owner_id()");
    // Both accounts must belong to the effective owner — a non-member's
    // accounts simply are not found, so their transfer is rejected.
    expect(sql).toContain("where owner_id = effective_owner_id");
    // The legs are written under the effective owner; created_by still
    // records the actual person who made the transfer.
    expect(sql).toContain("effective_owner_id, v_event_date,");
    expect(sql).toContain("v_actor_id");
  });

  it("validates the two accounts, the amount, and the date server-side", () => {
    expect(sql).toContain("the source and destination accounts must be two different accounts.");
    expect(sql).toContain("the transfer amount must be greater than zero.");
    expect(sql).toContain("the transfer date is required.");
    expect(sql).toContain("one of the selected accounts was not found.");
  });

  it("writes both legs in one function body with the same transfer group id", () => {
    // Expense leg out of the source account, income leg into the destination.
    expect(sql).toContain("'transfer to ' || v_to_name, v_amount, 'expense'");
    expect(sql).toContain("'transfer from ' || v_from_name, v_amount, 'income'");
    expect(sql).toContain("transfer_group_id");
    // Each leg records its counterpart account and, after both inserts, the
    // counterpart event id — so each ledger shows the other side.
    expect(sql).toContain("counterpart_account_id");
    expect(sql).toContain("counterpart_event_id");
    // Returns both event ids plus the group id for the API response.
    expect(sql).toContain("'out_event_id', v_out_event_id");
    expect(sql).toContain("'in_event_id', v_in_event_id");
    expect(sql).toContain("'transfer_group_id', v_group_id");
  });
});

describe("transfer-leg date edit migration — structural contract", () => {
  // update_transfer_leg_with_history: the PATCH route calls this RPC -- and
  // nothing else -- when the edited event is a transfer leg. The initiating
  // edit + audit row (delegated to update_transaction_with_history) and the
  // pair-wide date propagation all run in one transaction, so the legs can
  // never be left with different dates.
  const legRpc = sql.split("create or replace function update_transfer_leg_with_history(")[1];

  it("defines update_transfer_leg_with_history as a SECURITY INVOKER RPC with the shared edit signature", () => {
    expect(legRpc).toBeDefined();
    expect(sql).toContain("p_owner_id text, p_event_id text, p_event jsonb, p_changes jsonb, p_edited_by text, p_cleared_at timestamptz");
    expect(legRpc).toContain("language plpgsql security invoker");
    expect(sql).toContain("revoke all on function update_transfer_leg_with_history(text, text, jsonb, jsonb, text, timestamptz) from public");
    expect(sql).toContain("grant execute on function update_transfer_leg_with_history(text, text, jsonb, jsonb, text, timestamptz) to authenticated");
  });

  it("resolves the effective owner so an authorized co-owner's leg edit lands in the workspace owner's books", () => {
    expect(legRpc).toContain("effective_owner_id text := public.resolve_effective_owner_id()");
    expect(legRpc).toContain("if effective_owner_id is null then");
    expect(legRpc).toContain("if required_owner is null or required_owner <> effective_owner_id then");
    // The actual person is recorded server-side: auth.uid(), never the
    // caller-supplied p_edited_by (which stays in the signature for
    // call-shape stability only).
    expect(legRpc).toContain("v_actor_id text := auth.uid()::text");
  });

  it("records the server-side actor on the counterpart leg, never p_edited_by", () => {
    expect(legRpc).toContain("updated_by = v_actor_id");
    expect(legRpc).not.toContain("v_edited_by");
  });

  it("refuses events that are not owned transfer legs", () => {
    expect(legRpc).toContain("select transfer_group_id into v_group_id");
    expect(legRpc).toContain("and source_system = 'manual'");
    expect(legRpc).toContain("and is_deleted = false");
    expect(legRpc).toContain("this transaction is not part of a fund transfer.");
  });

  it("delegates the edit + audit row to update_transaction_with_history with no subtransactions", () => {
    // A plain PL/pgSQL call inherits this function's implicit transaction.
    expect(legRpc).toContain("v_result := update_transaction_with_history(");
    // No EXCEPTION blocks: none of the writes may be wrapped in a
    // subtransaction that could commit or roll back independently.
    expect(legRpc).not.toContain("exception when");
  });

  it("propagates the date to every non-deleted leg of the pair in the same transaction", () => {
    expect(legRpc).toContain("and transfer_group_id = v_group_id");
    expect(legRpc).toContain("and is_deleted = false");
    // Only legs whose date actually differs are touched, so an
    // already-matching leg keeps its own updated_by / updated_at.
    expect(legRpc).toContain("and event_date is distinct from v_new_date");
    // The counterpart leg's actor is the server-side auth.uid(), consistent
    // with update_transaction_with_history — the caller-supplied p_edited_by
    // is never trusted.
    expect(legRpc).toContain("updated_by = v_actor_id");
    // Returns the delegated RPC's result (the edited leg's row).
    expect(legRpc).toContain("return v_result;");
  });
});
