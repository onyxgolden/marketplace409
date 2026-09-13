import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20260913020000_add_public_reservation_booking.sql", "utf8").toLowerCase();

describe("public reservation booking migration", () => {
  it("uses an opaque unique booking key and exposes no anonymous table grants", () => {
    expect(sql).toContain("public_booking_slug");
    expect(sql).toContain("reservation_inventory_public_booking_slug_key");
    expect(sql).toContain("revoke all on table public.reservation_confirmation_outbox from public, anon, authenticated");
    expect(sql).not.toMatch(/grant\s+(select|insert|update|delete).*\s+to\s+anon/);
  });

  it("records the public guest actor honestly and confirms atomically", () => {
    expect(sql).toContain("'public_guest'");
    expect(sql).toContain("insert into public.reservations");
    expect(sql).toContain("insert into public.reservation_events");
    expect(sql).toContain("insert into public.reservation_calendar_blocks");
    expect(sql).toContain("insert into public.reservation_confirmation_outbox");
    expect(sql).toContain("for update");
  });

  it("limits public confirmation execution to the server service role", () => {
    expect(sql).toContain("revoke all on function public.confirm_public_reservation");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("if found then");
  });
});
