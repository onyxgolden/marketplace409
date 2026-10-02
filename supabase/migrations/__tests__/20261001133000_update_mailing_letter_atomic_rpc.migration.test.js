import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static contract check for the Rentec-parity R20 atomic mailing-letter RPC
// migration: the letter mutation and the compliance audit event insert(s)
// happen in one SECURITY DEFINER transaction, authorized narrowly via
// has_workspace_access (owner / active co_owner only) — never a best-effort
// stamp after the fact, never broad staff workspace writes.
const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261001133000_update_mailing_letter_atomic_rpc.sql"),
  "utf8",
);
const lower = sql.toLowerCase();

describe("atomic mailing-letter RPC migration contract (20261001133000)", () => {
  it("defines update_mailing_letter_atomic as SECURITY DEFINER with a fixed search_path", () => {
    expect(lower).toContain("create or replace function public.update_mailing_letter_atomic(");
    expect(lower).toContain("security definer");
    expect(lower).toContain("set search_path = public");
  });

  it("authorizes narrowly via has_workspace_access (owner / active co_owner only)", () => {
    expect(lower).toContain("has_workspace_access(p_owner_id)");
    expect(lower).toContain("only the owner or co-owner can update mailings");
  });

  it("locks the letter and compare-and-swaps on the caller's read", () => {
    expect(lower).toContain("for update");
    expect(lower).toContain("is distinct from p_expected_status");
    expect(lower).toContain("is distinct from p_expected_tracking");
    expect(lower).toContain("using errcode = 'p0001'");
  });

  it("mutates the letter and inserts the audit events in the same transaction", () => {
    expect(lower).toContain("update rental_mail_letters");
    expect(lower).toContain("insert into rental_mail_letter_events");
    expect(lower).toContain("'status_changed'");
    expect(lower).toContain("'tracking_set'");
    expect(lower).toContain("'tracking_changed'");
    expect(lower).toContain("'tracking_cleared'");
    // No best-effort escape hatch: the old comment/behavior is gone.
    expect(lower).not.toContain("best-effort");
  });

  it("derives mailed_at/delivered_at from the transition inside the RPC", () => {
    expect(lower).toContain("when p_next_status = 'mailed' then now()");
    expect(lower).toContain("when p_next_status = 'delivered' then now()");
    expect(lower).toContain("when p_next_status = 'queued' then null");
  });

  it("requires an authenticated caller and rejects out-of-vocabulary statuses", () => {
    expect(lower).toContain("auth.uid()");
    expect(lower).toContain("authenticated user is required");
    expect(lower).toContain("status must be one of: queued, mailed, delivered");
  });

  it("is executable by authenticated only, never anon or public", () => {
    expect(lower).toContain("revoke all on function public.update_mailing_letter_atomic(text, text, text, text, text, boolean, text) from public, anon");
    expect(lower).toContain("grant execute on function public.update_mailing_letter_atomic(text, text, text, text, text, boolean, text) to authenticated");
  });
});
