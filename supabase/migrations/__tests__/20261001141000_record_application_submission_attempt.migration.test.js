import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static contract check for the R21 atomic submission-attempt RPC
// (PR #526 CHANGES fix): check-and-record must be atomic under an advisory
// lock so a double-submit race cannot slip two applications past the limit.
const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261001141000_record_application_submission_attempt.sql"),
  "utf8",
);
const lower = sql.toLowerCase();

describe("record_application_submission_attempt RPC migration", () => {
  it("creates a security-definer boolean RPC with the expected signature", () => {
    expect(lower).toContain("create or replace function public.record_application_submission_attempt(");
    expect(lower).toContain("security definer");
    expect(lower).toContain("returns boolean");
    for (const param of ["p_owner_id", "p_listing_id", "p_ip_hash", "p_window_seconds", "p_max_submissions"]) {
      expect(lower).toContain(param);
    }
  });

  it("serializes attempts per (owner, listing, ip) with an advisory lock", () => {
    expect(lower).toContain("pg_advisory_xact_lock");
    expect(lower).toContain("hashtext(p_owner_id || '|' || p_listing_id || '|' || p_ip_hash)");
  });

  it("counts in-window attempts and inserts the attempt row atomically", () => {
    expect(lower).toMatch(/select count\(\*\) into v_count[\s\S]*?from rental_application_rate_limits/);
    expect(lower).toContain("submitted_at >=");
    expect(lower).toContain("make_interval");
    expect(lower).toContain("insert into rental_application_rate_limits");
    // Denied attempts record nothing and return false.
    expect(lower).toMatch(/if v_count >= p_max_submissions then[\s\S]*?return false/);
    expect(lower).toMatch(/return true/);
  });

  it("grants execute to service_role only — never to authenticated callers", () => {
    // SECURITY DEFINER + caller-supplied owner/listing/ip: an authenticated
    // grant would let any logged-in user poison another workspace's
    // rate-limit rows, so execution is restricted to the service_role
    // client the public intake route uses.
    expect(lower).toContain("errcode = '22023'");
    expect(lower).toMatch(/grant execute on function public\.record_application_submission_attempt\([\s\S]*?\) to service_role;/);
    expect(lower).toMatch(/revoke all on function public\.record_application_submission_attempt\([\s\S]*?\) from public, anon, authenticated;/);
    expect(lower).not.toMatch(/grant execute on function public\.record_application_submission_attempt\([\s\S]*?\) to [^;]*authenticated/);
  });
});
