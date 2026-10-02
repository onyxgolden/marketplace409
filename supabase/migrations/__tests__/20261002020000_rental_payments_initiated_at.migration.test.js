import { describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path";
const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20261002020000_rental_payments_initiated_at.sql"), "utf8");

describe("rental_payments initiated_at marker migration", () => {
  it("adds a nullable initiated_at timestamptz column, idempotently", () => {
    expect(sql).toMatch(/alter table rental_payments add column if not exists initiated_at timestamptz/i);
  });

  it("indexes initiated_at for the recovery scan, partial to non-null rows", () => {
    expect(sql).toMatch(/create index if not exists rental_payments_initiated_at_idx/i);
    expect(sql).toMatch(/on rental_payments\s*\(\s*initiated_at\s*\)\s*where initiated_at is not null/i);
  });

  it("stamps initiated_at on the first processing event inside the projection RPC", () => {
    expect(sql).toMatch(/p_event_type = 'payment_intent\.processing'/);
    expect(sql).toMatch(/initiated_at = coalesce\(initiated_at, p_occurred_at\)/);
  });

  it("keeps the earliest detection: a repeat processing event never overwrites the marker", () => {
    // coalesce(initiated_at, p_occurred_at) — not a plain assignment.
    expect(sql).not.toMatch(/initiated_at = p_occurred_at,/);
  });

  it("preserves the existing function contract: signature, grants, and all other branches", () => {
    expect(sql).toContain("process_stripe_rental_payment_event(");
    expect(sql).toContain("p_provider_event_id text, p_connected_account_id text, p_event_type text,");
    expect(sql).toMatch(/p_event_type = 'payment_intent\.succeeded'/);
    expect(sql).toMatch(/p_event_type = 'payment_intent\.payment_failed'/);
    expect(sql).toMatch(/p_event_type like 'charge\.dispute\.%'/);
    expect(sql).toContain("grant execute on function process_stripe_rental_payment_event");
    expect(sql).toContain("to service_role;");
  });
});
