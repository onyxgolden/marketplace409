import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Rentec-parity R10 follow-up (PR #515 review finding): period/start
// eligibility parity between the JS generator and the SQL RPC. The recreated
// generate_monthly_rent_charge() compared the period's DUE DATE to the
// schedule's effective start date, while the canonical JS generator
// (generateRentCharge) skips a period only when its last possible day
// (YYYY-MM-28) precedes the start date — so the two paths disagreed about
// whether a late-month move-in's month was eligible at all. Static contract
// over the fix migration SQL; the migration itself only runs against
// Supabase with Jason's explicit approval.
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261001030000_charge_period_start_parity.sql"), "utf8")
  .toLowerCase().replace(/\s+/g, " ");

describe("R10 charge period/start eligibility parity migration", () => {
  it("decides period eligibility from the period's last possible day, matching the JS generator", () => {
    // Canonical rule: eligible unless YYYY-MM-28 precedes the start date.
    expect(sql).toContain("required_period_end := (required_period || '-28')::date");
    expect(sql).toContain("if required_period_end < schedule.effective_start_date");
  });

  it("no longer compares the period's due date to the effective start date", () => {
    // The divergent pre-fix check: dropping the move-in month's charge
    // whenever the due day preceded a late-month move-in.
    expect(sql).not.toContain("if required_due_date < schedule.effective_start_date");
  });

  it("keeps the end-date check and the begin-charges gate unchanged, with the gate after eligibility", () => {
    expect(sql).toContain("schedule.effective_end_date is not null and required_due_date > schedule.effective_end_date");
    expect(sql).toContain("if lease_begin_charges_date is not null and required_due_date < lease_begin_charges_date");
    // Ordering: the common period eligibility check comes first, the R10
    // begin-charges gate decides after it.
    const eligibilityAt = sql.indexOf("if required_period_end < schedule.effective_start_date");
    const gateAt = sql.indexOf("if lease_begin_charges_date is not null and required_due_date < lease_begin_charges_date");
    expect(eligibilityAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(eligibilityAt);
  });

  it("preserves the function contract: signature, auth model, idempotency, grants", () => {
    expect(sql).toContain("create or replace function generate_monthly_rent_charge(");
    expect(sql).toContain("security definer");
    expect(sql).toContain("on conflict (owner_id, source_key) do nothing");
    expect(sql).toContain("revoke all on function generate_monthly_rent_charge(text, text, text) from public");
    expect(sql).toContain("grant execute on function generate_monthly_rent_charge(text, text, text) to authenticated");
  });
});
