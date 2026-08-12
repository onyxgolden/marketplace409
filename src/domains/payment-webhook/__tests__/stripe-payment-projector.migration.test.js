import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260812000700_process_stripe_rental_payment_event.sql"), "utf8");
describe("Stripe rental payment event projector migration", () => {
  it("locks webhook and payment rows for idempotent projection", () => {
    expect(sql).toMatch(/payment_webhook_events[\s\S]*for update/i);
    expect(sql).toMatch(/rental_payments[\s\S]*for update/i);
    expect(sql).toContain("v_event.status in ('processed', 'ignored')");
  });
  it("does not mark ACH processing as paid", () => {
    expect(sql).toContain("status = 'processing'");
    expect(sql).toContain("p_event_type = 'payment_intent.succeeded'");
    expect(sql).toContain("paid_amount_cents = v_new_paid");
  });
  it("restricts execution to the service role", () => {
    expect(sql).toMatch(/revoke all[\s\S]*from authenticated/i);
    expect(sql).toMatch(/grant execute[\s\S]*to service_role/i);
  });
});
