import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static contract check for the Rentec-parity R21 listings/applications
// migration: tables/indexes are IF NOT EXISTS, policies are idempotent
// (drop-if-exists guards), workspace-access policy expressions plus forced
// RLS are preserved exactly, and the status/fee invariants hold.
const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261001131000_rental_listings_applications.sql"),
  "utf8",
);
const lower = sql.toLowerCase();

const TABLES = [
  "rental_listing_forms",
  "rental_listings",
  "rental_applications",
  "rental_application_decisions",
  "rental_application_rate_limits",
];

describe("r21 listings/applications migration", () => {
  it("creates all five tables and the guard indexes idempotently", () => {
    for (const table of TABLES) {
      expect(lower).toContain(`create table if not exists ${table}`);
      expect(lower).toMatch(new RegExp(`primary key\\s*\\(\\s*owner_id\\s*,\\s*id\\s*\\)`));
    }
    expect(lower).toContain("create index if not exists idx_rental_listings_owner_status");
    expect(lower).toContain("create index if not exists idx_rental_applications_owner_status");
    expect(lower).toContain("create index if not exists idx_rental_application_rate_limits_guard");
    expect(lower).toContain("unique (owner_id, public_slug)");
  });

  it("keeps forced workspace-access RLS and the explicit-grant contract", () => {
    for (const table of TABLES) {
      expect(lower).toContain(`alter table ${table} enable row level security`);
      expect(lower).toContain(`alter table ${table} force row level security`);
      expect(lower).toContain(`revoke all on ${table} from anon, authenticated`);
    }
    expect(lower).toContain("grant select, insert, update, delete on rental_listings to authenticated");
    // Decisions are append-only for workspace members: no update/delete grant.
    expect(lower).toContain("grant select, insert on rental_application_decisions to authenticated");
    // Rate-limit rows are service-role only: no grant to authenticated at all.
    expect(lower).not.toMatch(/grant [^;]*on rental_application_rate_limits to authenticated/);
    expect(lower.match(/create policy "rental_listing_forms_owner_[a-z]+"/g)).toHaveLength(4);
  });

  it("creates each policy idempotently on has_workspace_access", () => {
    for (const name of [
      "rental_listing_forms_owner_select", "rental_listing_forms_owner_insert",
      "rental_listings_owner_select", "rental_listings_owner_insert",
      "rental_applications_owner_select", "rental_applications_owner_update",
      "rental_application_decisions_owner_insert",
    ]) {
      const guarded = new RegExp(`drop policy if exists "${name}"[\\s\\S]*?create policy "${name}"`);
      expect(guarded.test(lower), `policy ${name} is not created idempotently`).toBe(true);
      const body = lower.match(new RegExp(`create policy "${name}"[\\s\\S]*?;`));
      expect(body, `missing policy ${name}`).toBeTruthy();
      expect(body[0]).toContain("has_workspace_access(owner_id)");
    }
  });

  it("constrains listing/application statuses and the record-only fee", () => {
    expect(lower).toMatch(/status in\s*\(\s*'draft'\s*,\s*'published'\s*,\s*'unpublished'\s*\)/);
    expect(lower).toMatch(/status in\s*\(\s*'pending'\s*,\s*'approved'\s*,\s*'denied'\s*,\s*'withdrawn'\s*\)/);
    expect(lower).toMatch(/action in\s*\(\s*'approved'\s*,\s*'denied'\s*,\s*'withdrawn'\s*\)/);
    // Fee is record-only: non-negative, never a collected amount column.
    expect(lower).toMatch(/fee_amount_cents bigint not null default 0 check\s*\(fee_amount_cents >= 0\)/);
    expect(lower).not.toMatch(/fee_collected|stripe|payment_intent/);
    // A denied application must carry the reason.
    expect(lower).toContain("status <> 'denied' or denial_reason is not null");
  });
});
