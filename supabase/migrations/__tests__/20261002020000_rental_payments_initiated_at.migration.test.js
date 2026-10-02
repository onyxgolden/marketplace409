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

  it("amends the CURRENT nine-argument RPC: p_provider_mode is part of the signature", () => {
    // Regression guard for the re-review NO-GO: the first revision recreated
    // the obsolete eight-argument overload (no p_provider_mode), which the
    // webhook route never calls. Every CREATE of this function in this file
    // must carry the nine-argument mode-aware signature.
    const creates = [...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+process_stripe_rental_payment_event\s*\(([\s\S]*?)\)\s*returns/gi)];
    expect(creates.length).toBeGreaterThan(0);
    for (const m of creates) {
      expect(m[1]).toMatch(/p_provider_mode text/);
    }
  });

  it("drops the mistakenly reintroduced eight-argument overload", () => {
    expect(sql).toMatch(
      /drop function if exists process_stripe_rental_payment_event\(text,text,text,text,text,text,text,timestamptz\)/i
    );
  });

  it("preserves the provider-mode validation and scoped lookups of the current function", () => {
    expect(sql).toMatch(/p_provider_mode not in \('test','live'\)/);
    expect(sql).toMatch(/landlord_payment_accounts\s+where provider = 'stripe' and provider_mode = p_provider_mode/);
    expect(sql).toMatch(/payment_webhook_events\s+where provider = 'stripe' and provider_mode = p_provider_mode/);
    expect(sql).toMatch(/rental_payments where owner_id = v_owner_id and id = p_payment_id and provider_mode = p_provider_mode/);
  });

  it("stamps initiated_at on the first processing event inside the projection RPC", () => {
    expect(sql).toMatch(/p_event_type = 'payment_intent\.processing'/);
    expect(sql).toMatch(/initiated_at = coalesce\(initiated_at, p_occurred_at\)/);
  });

  it("keeps the earliest detection: a repeat processing event never overwrites the marker", () => {
    // coalesce(initiated_at, p_occurred_at) — not a plain assignment.
    expect(sql).not.toMatch(/initiated_at = p_occurred_at,/);
  });

  it("records the marker independently of status downgrade: late processing on a terminal payment stamps without moving status", () => {
    // Second processing branch: terminal-status payments get a stamp-only
    // update — no status change, no updated_at touch (updated_at drives the
    // terminal reconciler's transition-time filter).
    const branch = sql.match(
      /elsif p_event_type = 'payment_intent\.processing' then([\s\S]*?)elsif p_event_type = 'payment_intent\.succeeded'/
    );
    expect(branch).not.toBeNull();
    const stmt = branch[1].match(/update rental_payments set ([\s\S]*?)where owner_id/);
    expect(stmt).not.toBeNull();
    expect(stmt[1]).toMatch(/initiated_at = coalesce\(initiated_at, p_occurred_at\)/);
    expect(stmt[1]).not.toMatch(/status\s*=/);
    expect(stmt[1]).not.toMatch(/updated_at/);
  });

  it("preserves the service-role grant contract on the nine-argument signature", () => {
    expect(sql).toMatch(
      /revoke all on function process_stripe_rental_payment_event\(text,text,text,text,text,text,text,timestamptz,text\) from public,anon,authenticated/i
    );
    expect(sql).toMatch(
      /grant execute on function process_stripe_rental_payment_event\(text,text,text,text,text,text,text,timestamptz,text\) to service_role/i
    );
  });

  it("leaves all other event branches intact", () => {
    expect(sql).toMatch(/p_event_type = 'payment_intent\.succeeded'/);
    expect(sql).toMatch(/p_event_type = 'payment_intent\.payment_failed'/);
    expect(sql).toMatch(/p_event_type like 'charge\.dispute\.%'/);
    expect(sql).toMatch(/return jsonb_build_object\('status', 'processed', 'payment_id', v_payment\.id, 'owner_id', v_owner_id\)/);
  });
});
