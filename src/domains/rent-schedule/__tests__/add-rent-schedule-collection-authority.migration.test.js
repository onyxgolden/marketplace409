import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260822010000_add_rent_schedule_collection_authority.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("rent_schedules collection authority migration", () => {
  it("adds collection_mode defaulting to 'external', never silently making an existing lease FORGE-collectible", () => {
    expect(sql).toContain("add column if not exists collection_mode text not null default 'external'");
    expect(sql).toContain("check (collection_mode in ('external', 'forge', 'paused'))");
  });

  it("adds collection_provider constrained to known external providers, defaulting to 'rentec'", () => {
    expect(sql).toContain("add column if not exists collection_provider text default 'rentec'");
    expect(sql).toContain("check (collection_provider is null or collection_provider in ('rentec'))");
  });

  it("requires a cutover date for 'forge' mode and forbids one otherwise", () => {
    expect(sql).toContain("check (collection_mode <> 'forge' or forge_cutover_date is not null)");
    expect(sql).toContain("check (collection_mode = 'forge' or forge_cutover_date is null)");
  });

  it("does not backfill every active schedule to 'forge' — only the named pre-existing Brandy Morgan validation schedule is explicitly cut over", () => {
    expect(sql).not.toMatch(/update rent_schedules set collection_mode\s*=\s*'forge' where status\s*=\s*'active'/);
    // The one-time migration-level backfill is uniquely identifiable by its 'migration:' audit
    // marker — distinct from the RPC's own runtime UPDATE, which uses a caller-supplied owner id.
    const backfills = sql.match(/update rent_schedules set collection_mode = 'forge'[^;]*'migration:[^;]*;/g) || [];
    expect(backfills).toHaveLength(1);
    expect(backfills[0]).toContain("where id = 'rent_schedule_3025a769-453d-41dc-a41e-b97642941efd'");
  });

  it("records the cutover activation audit trail as a real table, RLS-protected and owner-scoped", () => {
    expect(sql).toContain("create table if not exists rent_schedule_collection_cutover_audit");
    expect(sql).toContain("alter table rent_schedule_collection_cutover_audit enable row level security");
    expect(sql).toContain("alter table rent_schedule_collection_cutover_audit force row level security");
    expect(sql).toContain("using (owner_id = auth.uid()::text)");
  });

  it("activate_forge_billing_collection is owner-authenticated, security invoker, and least-privilege granted", () => {
    expect(sql).toContain("create or replace function activate_forge_billing_collection(");
    expect(sql).toContain("security invoker");
    expect(sql).not.toContain("security definer");
    expect(sql).toContain("p_owner_id <> authenticated_owner_id");
    expect(sql).toContain("revoke all on function activate_forge_billing_collection(text, text, date, jsonb) from public");
    expect(sql).toContain("grant execute on function activate_forge_billing_collection(text, text, date, jsonb) to authenticated");
  });

  it("activate_forge_billing_collection requires an explicit cutover date and is idempotent on an identical retry", () => {
    expect(sql).toContain("if p_cutover_date is null then raise exception 'a reviewed forge cutover date is required.'");
    expect(sql).toContain("if schedule.collection_mode = 'forge' and schedule.forge_cutover_date = p_cutover_date then");
  });

  it("activate_forge_billing_collection refuses to silently re-cut-over a schedule to a different date", () => {
    expect(sql).toContain("if schedule.collection_mode = 'forge' then raise exception 'this schedule is already forge-collectible under a different cutover date; correct it explicitly rather than re-activating.'");
  });

  it("activate_forge_billing_collection writes an audit row on every call, including the idempotent no-op path", () => {
    const auditInserts = (sql.match(/insert into rent_schedule_collection_cutover_audit/g) || []).length;
    expect(auditInserts).toBe(2); // once for the no-op branch, once for the real activation branch
  });

  it("request_rental_autopay_enrollment now rejects a lease whose schedule is not FORGE-collectible", () => {
    expect(sql).toContain("s.collection_mode <> 'forge' or s.forge_cutover_date is null or s.forge_cutover_date > current_date");
    expect(sql).toContain("raise exception 'this lease is not currently collected through forge.'");
  });

  it("never touches Stripe keys, webhook destinations, or provider_mode isolation", () => {
    expect(sql).not.toMatch(/stripe_secret_key|stripe_connect_webhook_secret|provider_mode text check/);
  });
});
