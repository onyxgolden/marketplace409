import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const raw = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260830000400_add_atomic_private_financing_adjustment_confirmation.sql"),
  "utf8",
);
const sql = raw.replace(/--[^\n]*/g, "").toLowerCase().replace(/\s+/g, " ");

describe("atomic private-financing adjustment confirmation migration", () => {
  it("uses a security-definer RPC with a closed search path and forced RLS bypass", () => {
    expect(sql).toContain("create function confirm_private_financing_adjustment(");
    expect(sql).toContain("security definer set search_path = public set row_security = off");
  });

  it("authorizes the effective owner before touching the ledger", () => {
    expect(sql).toContain("if not has_workspace_access(p_owner_id)");
  });

  it("locks the account row before either duplicate or sequence decisions", () => {
    const lock = sql.indexOf("for update;");
    const duplicate = sql.indexOf("idempotency_key = p_confirmation_id");
    const sequence = sql.indexOf("v_next_sequence - 1 <> p_expected_ledger_sequence");
    expect(lock).toBeGreaterThan(-1);
    expect(duplicate).toBeGreaterThan(lock);
    expect(sequence).toBeGreaterThan(duplicate);
  });

  it("uses the signed confirmation id as the immutable-event idempotency key", () => {
    expect(sql).toContain("p_idempotency_key := p_confirmation_id");
  });

  it("returns the existing event for a concurrent retry and fails a different stale preview", () => {
    expect(sql).toContain("if v_existing.id is not null then return v_existing;");
    expect(sql).toContain("using errcode = '40001'");
  });

  it("is executable only by authenticated users, never public", () => {
    expect(sql).toContain("revoke all on function confirm_private_financing_adjustment(text, text, bigint, text, jsonb) from public;");
    expect(sql).toContain("grant execute on function confirm_private_financing_adjustment(text, text, bigint, text, jsonb) to authenticated;");
  });
});
