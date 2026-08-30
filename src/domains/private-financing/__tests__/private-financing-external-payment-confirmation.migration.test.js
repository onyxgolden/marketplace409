import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../../../supabase/migrations/20260830000500_add_atomic_external_payment_confirmation.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("atomic external-payment confirmation migration", () => {
  it("creates one SECURITY DEFINER confirmation RPC with a fixed search path and RLS disabled", () => {
    expect(sql).toContain("create function confirm_private_financing_external_payment(");
    expect(sql).toMatch(/security definer\s+set search_path = public\s+set row_security = off/i);
  });

  it("requires authentication and canonical-workspace access", () => {
    expect(sql).toContain("if v_authenticated_user is null then");
    expect(sql).toContain("if not has_workspace_access(p_owner_id) then");
  });

  it("accepts only a single manual_external payment_posted object", () => {
    expect(sql).toContain("jsonb_typeof(p_event_payload) <> 'object'");
    expect(sql).toContain("p_event_payload->>'p_event_type' <> 'payment_posted'");
    expect(sql).toContain("p_event_payload->>'p_event_origin' <> 'manual_external'");
  });

  it("locks the account before checking sequence or appending", () => {
    const lock = sql.indexOf("for update;");
    const stale = sql.indexOf("v_next_sequence - 1 <> p_expected_ledger_sequence");
    const append = sql.indexOf("v_row := append_private_financing_event(");
    expect(lock).toBeGreaterThan(0);
    expect(stale).toBeGreaterThan(lock);
    expect(append).toBeGreaterThan(stale);
  });

  it("derives idempotency from normalized method and source reference server-side", () => {
    expect(sql).toContain(
      "v_idempotency_key := 'manual_external:' || v_payment_method || ':' || v_source_reference;",
    );
    expect(sql).not.toMatch(/v_idempotency_key\s*:=\s*p_event_payload->>'p_idempotency_key'/);
  });

  it("returns an exact retry but rejects reference reuse for different facts", () => {
    expect(sql).toContain("return v_existing;");
    expect(sql).toContain(
      "This external payment reference is already attached to a different ledger event.",
    );
    expect(sql).toContain("using errcode = '23505'");
  });

  it("rejects a ledger that moved after preview with serialization semantics", () => {
    expect(sql).toContain("The financing ledger changed after preview.");
    expect(sql).toContain("using errcode = '40001'");
  });

  it("forces payment provenance instead of trusting payload values", () => {
    expect(sql).toContain("p_event_type := 'payment_posted'");
    expect(sql).toContain("p_event_origin := 'manual_external'");
    expect(sql).toContain("p_source_reference := v_source_reference");
    expect(sql).toContain("p_payment_method := v_payment_method");
  });

  it("never accepts created_by and relies on append RPC attribution", () => {
    expect(sql).not.toContain("p_created_by");
    expect(sql).toContain("v_authenticated_user uuid := auth.uid()");
  });

  it("grants execution only after revoking public access", () => {
    const signature =
      "confirm_private_financing_external_payment(text, text, bigint, jsonb)";
    expect(sql).toContain(`revoke all on function ${signature} from public;`);
    expect(sql).toContain(`grant execute on function ${signature} to authenticated;`);
    expect(sql).not.toContain(`grant execute on function ${signature} to anon`);
  });
});
