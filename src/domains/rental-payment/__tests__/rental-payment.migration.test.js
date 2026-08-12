import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260812000500_create_rental_payments.sql"), "utf8").toLowerCase();
describe("rental payment migration", () => {
  it.each(["rental_payments", "rental_settlements", "payment_webhook_events", "ach_authorizations"])("forces RLS for %s", (table) => {
    expect(sql).toContain(`alter table ${table} enable row level security`);
    expect(sql).toContain(`alter table ${table} force row level security`);
  });
  it("deduplicates payment creation and provider webhook events", () => {
    expect(sql).toContain("unique (owner_id, idempotency_key)");
    expect(sql).toContain("unique (provider, provider_event_id)");
  });
  it("allows only one pending payment attempt per charge", () => {
    expect(sql).toContain("idx_rental_payments_one_pending_per_charge");
    expect(sql).toContain("where status in ('created','requires_payment_method','requires_action','processing')");
  });
  it("does not expose webhook payload metadata to authenticated actors", () => {
    expect(sql).not.toContain('policy "payment_webhook');
    expect(sql).toContain("service-role only");
  });
  it("allows tenant reads but no tenant payment mutation", () => {
    expect(sql).toContain('policy "rental_payments_tenant_select"');
    expect(sql).not.toContain("rental_payments_tenant_insert");
  });
});
