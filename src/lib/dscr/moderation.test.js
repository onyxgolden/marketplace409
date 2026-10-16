import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  MODERATION_TRANSITIONS,
  MODERATION_ACTIONS,
  canTransition,
  validateReport,
  REPORT_REASON_MIN,
  REPORT_REASON_MAX,
} from "./listings.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const seedSql = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261015230100_dscr_lender_seed.sql"),
  "utf8"
);
const fixSql = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261015230200_dscr_moderation_fix_round.sql"),
  "utf8"
);

describe("MODERATION_TRANSITIONS", () => {
  it("defines all eight required admin actions", () => {
    expect([...MODERATION_ACTIONS].sort()).toEqual(
      [
        "approve_submission",
        "reject_submission",
        "approve_version",
        "reject_version",
        "publish",
        "unpublish",
        "reconfirm",
        "remove",
      ].sort()
    );
  });

  it("approves submissions only from pending_review", () => {
    expect(canTransition("pending_review", "approve_submission")).toBe(true);
    expect(canTransition("published", "approve_submission")).toBe(false);
    expect(canTransition("unpublished", "approve_submission")).toBe(false);
    expect(canTransition("draft", "approve_submission")).toBe(false);
  });

  it("rejects submissions only from pending_review", () => {
    expect(canTransition("pending_review", "reject_submission")).toBe(true);
    expect(canTransition("published", "reject_submission")).toBe(false);
  });

  it("publishes only from unpublished; unpublishes only from published", () => {
    expect(canTransition("unpublished", "publish")).toBe(true);
    expect(canTransition("published", "publish")).toBe(false);
    expect(canTransition("pending_review", "publish")).toBe(false);
    expect(canTransition("published", "unpublish")).toBe(true);
    expect(canTransition("unpublished", "unpublish")).toBe(false);
  });

  it("reconfirms only published listings", () => {
    expect(canTransition("published", "reconfirm")).toBe(true);
    expect(canTransition("unpublished", "reconfirm")).toBe(false);
    expect(canTransition("pending_review", "reconfirm")).toBe(false);
  });

  it("soft-removes from live states but never from draft", () => {
    expect(canTransition("published", "remove")).toBe(true);
    expect(canTransition("unpublished", "remove")).toBe(true);
    expect(canTransition("pending_review", "remove")).toBe(true);
    expect(canTransition("draft", "remove")).toBe(false);
  });

  it("version review is allowed from any listing status (the version row itself must be pending)", () => {
    for (const s of ["draft", "pending_review", "published", "unpublished"]) {
      expect(canTransition(s, "approve_version")).toBe(true);
      expect(canTransition(s, "reject_version")).toBe(true);
    }
  });

  it("rejects unknown actions", () => {
    expect(canTransition("published", "delete")).toBe(false);
    expect(canTransition("published", "nuke")).toBe(false);
    expect(canTransition("published", "")).toBe(false);
  });

  it("remove lands on unpublished (soft removal, never hard delete)", () => {
    expect(MODERATION_TRANSITIONS.remove.to).toBe("unpublished");
  });
});

describe("validateReport", () => {
  it("rejects empty and too-short reasons (fail closed)", () => {
    expect(validateReport("").valid).toBe(false);
    expect(validateReport("   ").valid).toBe(false);
    expect(validateReport("bad site").valid).toBe(false);
  });

  it("accepts a reason at exactly the minimum length", () => {
    expect(validateReport("x".repeat(REPORT_REASON_MIN)).valid).toBe(true);
  });

  it("rejects reasons over the maximum length", () => {
    expect(validateReport("x".repeat(REPORT_REASON_MAX + 1)).valid).toBe(false);
    expect(validateReport("x".repeat(REPORT_REASON_MAX)).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Seed verification (DSCR-IMPL-004)
// ---------------------------------------------------------------------------

function statesForLender(seed, companyName) {
  const idx = seed.indexOf(`'${companyName}'`);
  if (idx === -1) throw new Error(`lender block not found: ${companyName}`);
  const chunk = seed.slice(idx, idx + 4000);
  const m = chunk.match(/ARRAY\[([^\]]+)\]/);
  if (!m) throw new Error(`states ARRAY not found for ${companyName}`);
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, ""));
}

describe("seed states_served (IMPL-004)", () => {
  const lenders = ["Visio Lending", "Lima One Capital", "CoreVest Finance"];

  it("has no duplicate states for any seeded lender", () => {
    for (const name of lenders) {
      const states = statesForLender(seedSql, name);
      expect(new Set(states).size, `${name} has duplicate states`).toBe(
        states.length
      );
    }
  });

  it("CoreVest excludes NV/ID/ND/SD per its official contact page", () => {
    const states = statesForLender(seedSql, "CoreVest Finance");
    for (const excluded of ["NV", "ID", "ND", "SD"]) {
      expect(states, `CoreVest must not list ${excluded}`).not.toContain(excluded);
    }
  });

  it("CoreVest lists Nebraska exactly once", () => {
    const states = statesForLender(seedSql, "CoreVest Finance");
    expect(states.filter((s) => s === "NE")).toHaveLength(1);
  });

  it("CoreVest seed cites the contact page as the states source", () => {
    const idx = seedSql.indexOf("'CoreVest Finance'");
    const chunk = seedSql.slice(idx, idx + 6000);
    expect(chunk).toContain("https://www.corevestfinance.com/contact");
    expect(chunk).toContain("not currently lend in");
  });

  it("seed is idempotent under the NMLS unique constraint", () => {
    expect(seedSql).toContain("ON CONFLICT (nmls_number) DO NOTHING");
  });
});

// ---------------------------------------------------------------------------
// Fix-round migration static checks (IMPL-001/002/003/005)
// No local Postgres is available in this environment, so these assert the
// migration contains the required database-boundary constructs.
// ---------------------------------------------------------------------------

describe("fix-round migration (IMPL-001/002/003/005)", () => {
  it("enforces NMLS uniqueness at the DB boundary (IMPL-003)", () => {
    expect(fixSql).toContain("dscr_lenders_nmls_unique");
    expect(fixSql).toMatch(/UNIQUE\s*\(\s*nmls_number\s*\)/);
  });

  it("replaces CASCADE with RESTRICT on audit/versions/reports (IMPL-002)", () => {
    expect(fixSql).toContain("ON DELETE RESTRICT");
    // No FOREIGN KEY clause may still use CASCADE (comments may mention it).
    expect(fixSql).not.toMatch(/FOREIGN KEY[^;]*ON DELETE CASCADE/);
  });

  it("makes the audit table append-only for every role (IMPL-002)", () => {
    expect(fixSql).toContain("trg_dscr_audit_immutable");
    expect(fixSql).toMatch(/BEFORE UPDATE OR DELETE ON public\.dscr_lender_audit/);
    expect(fixSql).toContain("append-only");
  });

  it("serializes per-user submits with an advisory lock (IMPL-003)", () => {
    expect(fixSql).toContain("pg_advisory_xact_lock(hashtext('dscr_submit:'");
  });

  it("handles the cross-user NMLS race via unique_violation (IMPL-003)", () => {
    expect(fixSql).toContain("EXCEPTION WHEN unique_violation");
  });

  it("preserves duplicate NMLS submissions as staged versions (IMPL-003)", () => {
    expect(fixSql).toContain("dscr_lender_versions");
    expect(fixSql).toContain("Duplicate-NMLS");
  });

  it("defines atomic lifecycle RPCs with SECURITY DEFINER (IMPL-001/002)", () => {
    for (const fn of [
      "dscr_submit_lender",
      "dscr_stage_version",
      "dscr_review_transition",
      "dscr_report_abuse",
    ]) {
      expect(fixSql).toContain(`FUNCTION public.${fn}(`);
      expect(fixSql).toContain("SECURITY DEFINER");
    }
  });

  it("implements all eight moderation transitions in the RPC (IMPL-001)", () => {
    for (const action of MODERATION_ACTIONS) {
      expect(fixSql).toContain(`p_action = '${action}'`);
    }
  });

  it("couples abuse reports with counter bump + audit atomically (IMPL-005)", () => {
    expect(fixSql).toContain("abuse_report_count = abuse_report_count + 1");
    expect(fixSql).toContain("REPORT_THROTTLED");
    expect(fixSql).toContain("REPORT_NOT_FOUND");
  });

  it("guards states_served against duplicates at the DB boundary (IMPL-004)", () => {
    expect(fixSql).toContain("dscr_lenders_states_unique");
    expect(fixSql).toContain("dscr_states_unique");
  });
});
