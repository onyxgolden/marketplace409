import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260913030000_add_guest_agreement_and_timed_access.sql"), "utf8").toLowerCase();

describe("guest agreement and timed access migration", () => {
  it("snapshots the agreement and creates an opaque access credential", () => {
    expect(sql).toContain("new.guest_agreement_text := v_settings.public_guest_agreement");
    expect(sql).toContain("new.guest_agreement_acknowledged_at := now()");
    expect(sql).toContain("replace(gen_random_uuid()::text");
  });
  it("time-locks instructions and denies browser roles direct RPC access", () => {
    expect(sql).toContain("now() >= v_reservation.guest_access_release_at");
    expect(sql).toContain("case when v_available then v_settings.public_arrival_instructions else null end");
    expect(sql).toContain("revoke all on function public.get_public_reservation_access(text, text) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.get_public_reservation_access(text, text) to service_role");
  });
  it("removes access after cancellation and includes the private link in confirmation delivery", () => {
    expect(sql).toContain("r.status in ('confirmed', 'checked_in')");
    expect(sql).toContain("arrival and access details are released closer to check-in");
  });
});
