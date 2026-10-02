import { describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path";
const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20261002013000_add_payment_initiated_owner_notification_event.sql"), "utf8");

describe("add payment_initiated owner notification event migration", () => {
  it("widens the event_type check to include payment_initiated", () => {
    expect(sql).toContain("rental_owner_notifications_event_type_check");
    expect(sql).toMatch(/check\s*\(\s*event_type in\s*\('upcoming_autopay',\s*'payment_initiated',\s*'manual_payment_received',\s*'payment_completed',\s*'payment_failed'\)/);
  });

  it("keeps every pre-existing event value so old rows stay valid", () => {
    for (const eventType of ["upcoming_autopay", "manual_payment_received", "payment_completed", "payment_failed"]) {
      expect(sql).toContain(eventType);
    }
  });

  it("is idempotent: drops the old constraint only if it exists", () => {
    expect(sql).toMatch(/drop constraint if exists rental_owner_notifications_event_type_check/i);
  });
});
