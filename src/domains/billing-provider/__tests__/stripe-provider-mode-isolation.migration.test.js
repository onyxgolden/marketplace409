import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260821000000_add_stripe_provider_mode_isolation.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("Stripe provider_mode isolation migration", () => {
  it("never deletes or truncates any existing row", () => {
    expect(sql).not.toContain("delete from");
    expect(sql).not.toContain("truncate table");
    expect(sql).not.toContain("drop table");
  });

  it("adds provider_mode as a nullable, constrained column on every Stripe-identifier table", () => {
    for (const table of [
      "landlord_payment_accounts", "billing_customer_references", "rental_payments",
      "rental_settlements", "payment_webhook_events", "ach_authorizations",
    ]) {
      expect(sql).toContain(`alter table ${table} add column if not exists provider_mode text check (provider_mode in ('test','live'))`);
    }
  });

  it("requires provider_mode wherever provider = 'stripe', on every table with a nullable provider_mode", () => {
    for (const table of [
      "landlord_payment_accounts", "billing_customer_references", "rental_payments",
      "rental_settlements", "payment_webhook_events", "ach_authorizations",
    ]) {
      expect(sql).toContain(`check (provider <> 'stripe' or provider_mode is not null)`);
    }
    // one such check per table
    expect((sql.match(/check \(provider <> 'stripe' or provider_mode is not null\)/g) || []).length).toBe(6);
  });

  it("backfills every existing stripe-provider row to 'test' before enforcing the not-null-when-stripe check — never 'live'", () => {
    for (const table of [
      "landlord_payment_accounts", "billing_customer_references", "rental_payments",
      "rental_settlements", "payment_webhook_events", "ach_authorizations",
    ]) {
      expect(sql).toContain(`update ${table} set provider_mode = 'test' where provider_mode is null and provider = 'stripe'`);
    }
    expect(sql).not.toContain("provider_mode = 'live'");
  });

  it("widens landlord_payment_accounts uniqueness to include provider_mode, so a live row can coexist with a preserved sandbox row", () => {
    expect(sql).toContain("drop constraint if exists landlord_payment_accounts_owner_id_provider_key");
    expect(sql).toContain("unique (owner_id, provider, provider_mode)");
    expect(sql).toContain("drop constraint if exists landlord_payment_accounts_provider_provider_account_id_key");
    expect(sql).toContain("unique (provider, provider_mode, provider_account_id)");
  });

  it("widens billing_customer_references uniqueness (including its primary key) to include provider_mode", () => {
    expect(sql).toContain("primary key (owner_id, tenant_id, provider, provider_mode)");
    expect(sql).toContain("unique (provider, provider_mode, connected_account_id, customer_id)");
  });

  it("widens rental_payments and rental_settlements Stripe-object uniqueness to include provider_mode", () => {
    expect(sql).toContain("drop constraint if exists rental_payments_provider_provider_payment_id_key");
    expect(sql).toContain("unique (provider, provider_mode, provider_payment_id)");
    expect(sql).toContain("unique (provider, provider_mode, provider_balance_transaction_id)");
  });

  it("widens payment_webhook_events uniqueness to include provider_mode", () => {
    expect(sql).toContain("drop constraint if exists payment_webhook_events_provider_provider_event_id_key");
    expect(sql).toContain("unique (provider, provider_mode, provider_event_id)");
  });

  it("rescopes the one-current-autopay-enrollment index by provider_mode without changing enrollment status", () => {
    expect(sql).toContain("drop index if exists rental_autopay_one_current_enrollment");
    expect(sql).toContain("on rental_autopay_enrollments (owner_id, lease_id, tenant_id, provider_mode)");
    expect(sql).toContain("where status in ('setup_required','active','paused')");
    expect(sql).not.toContain("update rental_autopay_enrollments set status");
  });

  it("uses a dynamic column-based lookup (not a guessed name) for the two constraints whose auto-generated names would exceed the 63-byte identifier limit", () => {
    expect(sql).toContain("drop_unique_constraint_by_columns('billing_customer_references'");
    expect(sql).toContain("drop_unique_constraint_by_columns('rental_settlements'");
    expect(sql).toContain("create function pg_temp.drop_unique_constraint_by_columns");
  });

  it("casts pg_attribute.attname (type `name`) to text before comparing against the text[] column list — verified against a real disposable Postgres, where the uncast comparison fails with 'operator does not exist: name[] = text[]'", () => {
    expect(sql).toContain("select array_agg(a.attname::text order by k.ord)");
  });
});
