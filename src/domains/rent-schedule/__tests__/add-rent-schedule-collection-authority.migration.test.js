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

  it("backfills every existing schedule to 'external' via the column default only — no migration-level UPDATE targets a literal schedule id, and no exception exists for the pre-existing Brandy Morgan validation schedule", () => {
    // The only UPDATE ... SET collection_mode = 'forge' anywhere in this file must be the
    // activation function's own parameterized statement (owner_id = p_owner_id and id =
    // schedule.id) — never a literal id, which would mean a migration-time backfill exception.
    expect(sql).not.toContain("rent_schedule_3025a769-453d-41dc-a41e-b97642941efd");
    const forgeUpdates = sql.match(/update rent_schedules\s+set collection_mode = 'forge'[\s\S]*?where [^;]*;/g) || [];
    expect(forgeUpdates).toHaveLength(1);
    expect(forgeUpdates[0]).toContain("where owner_id = p_owner_id and id = schedule.id");
    expect(forgeUpdates[0]).not.toMatch(/where id = 'rent_schedule_/);
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

  it("never touches offline cash/check payment recording — record_offline_rental_payment remains untouched by both containment and the master pause", () => {
    expect(sql).not.toContain("record_offline_rental_payment");
  });

  describe("rental billing master pause", () => {
    it("adds rental_billing_settings defaulting every owner (existing and new) to paused", () => {
      expect(sql).toContain("create table if not exists rental_billing_settings");
      expect(sql).toContain("billing_enabled boolean not null default false");
    });

    it("protects rental_billing_settings with owner-scoped, forced row level security", () => {
      expect(sql).toContain("alter table rental_billing_settings enable row level security");
      expect(sql).toContain("alter table rental_billing_settings force row level security");
      expect(sql).toContain('create policy "rental_billing_settings_owner_select" on rental_billing_settings');
    });

    it("records an audit trail table for every pause/resume transition, RLS-protected and owner-scoped", () => {
      expect(sql).toContain("create table if not exists rental_billing_settings_audit");
      expect(sql).toContain("alter table rental_billing_settings_audit enable row level security");
      expect(sql).toContain("alter table rental_billing_settings_audit force row level security");
    });

    it("set_rental_billing_enabled is owner-authenticated, security invoker, and least-privilege granted", () => {
      expect(sql).toContain("create or replace function set_rental_billing_enabled(");
      expect(sql).toContain("security invoker");
      expect(sql).toContain("p_owner_id <> authenticated_owner_id");
      expect(sql).toContain("revoke all on function set_rental_billing_enabled(text, boolean) from public");
      expect(sql).toContain("grant execute on function set_rental_billing_enabled(text, boolean) to authenticated");
    });

    it("set_rental_billing_enabled requires an explicit boolean and audits every call, including a repeated/idempotent one", () => {
      expect(sql).toContain("if p_enabled is null then");
      expect(sql).toContain("raise exception 'an explicit billing_enabled value is required.'");
      const audits = (sql.match(/insert into rental_billing_settings_audit/g) || []).length;
      expect(audits).toBe(1); // single unconditional insert path — every call (including a no-op) is audited
    });

    it("no schedule anywhere becomes forge automatically, and no owner is auto-enabled — the only insert into rental_billing_settings is the parameterized RPC upsert, never a migration-time seed for an existing owner", () => {
      // The table is created with no seed INSERT of its own; every existing owner starts absent
      // (paused, via the application-level default) until they explicitly call
      // set_rental_billing_enabled. The one legitimate insert is the RPC's own parameterized
      // upsert keyed on p_owner_id — never a bulk seed selecting existing owner_id rows.
      const inserts = sql.match(/insert into rental_billing_settings\s*\([\s\S]*?(?:;|on conflict[\s\S]*?;)/g) || [];
      expect(inserts).toHaveLength(1);
      expect(inserts[0]).toContain("values (p_owner_id, p_enabled, now(), authenticated_owner_id)");
      expect(inserts[0]).not.toMatch(/select owner_id/);
    });

    it("request_rental_autopay_enrollment also rejects a FORGE-collectible lease while the owner's billing is globally paused", () => {
      expect(sql).toContain("select billing_enabled from rental_billing_settings where owner_id = t.owner_id");
      expect(sql).toContain("raise exception 'rental online billing is currently paused for this owner.'");
    });

    it("set_rental_billing_enabled is idempotent on a repeated request — an upsert, never a plain insert that would error on retry", () => {
      expect(sql).toContain("on conflict (owner_id) do update");
      expect(sql).toContain("set billing_enabled = excluded.billing_enabled");
    });
  });
});
