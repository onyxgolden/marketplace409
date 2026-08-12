import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260812000400_generate_monthly_rent_charge.sql"), "utf8")
  .toLowerCase().replace(/\s+/g, " ");
describe("monthly rent charge RPC", () => {
  it("uses authenticated owner authority", () => {
    expect(sql).toContain("security invoker");
    expect(sql).toContain("p_owner_id <> authenticated_owner_id");
    expect(sql).not.toContain("security definer");
  });
  it("locks the schedule and creates one idempotent charge", () => {
    expect(sql).toContain("from rent_schedules where owner_id = p_owner_id and id = p_schedule_id for update");
    expect(sql).toContain("on conflict (owner_id, source_key) do nothing");
    expect(sql).toContain("'rent:' || schedule.id || ':' || required_period");
  });
  it("does not generate outside an active effective schedule", () => {
    expect(sql).toContain("if schedule.status <> 'active' then return null");
    expect(sql).toContain("schedule.effective_end_date");
  });
});
