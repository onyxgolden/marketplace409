import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  TRANSITION_FRESHNESS,
  applyTransitionFreshness,
  filterListings,
  canPublish,
} from "./listings.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const r2Sql = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261015230400_dscr_fix_round_r2.sql"),
  "utf8"
);

/**
 * Extract the dscr_review_transition branch for one action from the migration
 * SQL. Branches are delimited by the next "ELSIF p_action = '...'" or the
 * final "ELSE" of the action dispatch.
 */
function branchSql(sql, action) {
  const start = sql.indexOf(`p_action = '${action}'`);
  if (start === -1) throw new Error(`action branch not found: ${action}`);
  const rest = sql.slice(start);
  const m = rest.match(/\n  ELSIF p_action = '|\n  ELSE\n/);
  return m ? rest.slice(0, m.index) : rest;
}

// ---------------------------------------------------------------------------
// DSCR-R2-001 — publish fails closed without identity confirmation
// ---------------------------------------------------------------------------

describe("R2-001 publish identity guard (RPC)", () => {
  it("publish requires identity_review_status = 'identity-confirmed'", () => {
    const branch = branchSql(r2Sql, "publish");
    expect(branch).toMatch(/identity-confirmed/);
    expect(branch).toMatch(/TRANSITION_INVALID.*publish requires identity-confirmed/);
  });

  it("publish reads identity_review_status alongside status", () => {
    // The guard needs the identity value; the initial SELECT must fetch it.
    const fnStart = r2Sql.indexOf("FUNCTION public.dscr_review_transition");
    const head = r2Sql.slice(fnStart, fnStart + 2000);
    expect(head).toMatch(/identity_review_status/);
  });

  it("publish does NOT manufacture provider-confirmed freshness", () => {
    const branch = branchSql(r2Sql, "publish");
    expect(
      branch,
      "publish must not set last_provider_confirmed_at"
    ).not.toMatch(/last_provider_confirmed_at\s*=\s*now\(\)/);
  });

  it("publish still refreshes the directory-review timestamp", () => {
    const branch = branchSql(r2Sql, "publish");
    expect(branch).toMatch(/last_directory_reviewed_at\s*=\s*now\(\)/);
  });

  it("reject_submission leaves identity unconfirmed (so publish stays closed)", () => {
    const branch = branchSql(r2Sql, "reject_submission");
    // Must not promote identity; publish's guard depends on it staying 'pending'.
    expect(branch).not.toMatch(/identity_review_status\s*=\s*'identity-confirmed'/);
    expect(branch).toMatch(/status\s*=\s*'unpublished'/);
  });

  it("approve_submission is the only transition that confers identity-confirmed", () => {
    // Every branch that sets identity-confirmed must be approve_submission.
    const conferring = [];
    for (const action of [
      "approve_submission",
      "reject_submission",
      "approve_version",
      "reject_version",
      "publish",
      "unpublish",
      "reconfirm",
      "remove",
    ]) {
      const branch = branchSql(r2Sql, action);
      if (/identity_review_status\s*=\s*'identity-confirmed'/.test(branch)) {
        conferring.push(action);
      }
    }
    expect(conferring).toEqual(["approve_submission"]);
  });
});

describe("R2-001 publish identity guard (JS mirror)", () => {
  it("TRANSITION_FRESHNESS.publish does not claim provider confirmation", () => {
    expect(TRANSITION_FRESHNESS.publish.provider_confirmed).toBe(false);
    expect(TRANSITION_FRESHNESS.publish.directory_reviewed).toBe(true);
  });

  it("applyTransitionFreshness for publish refreshes directory review only", () => {
    const before = {
      last_provider_confirmed_at: null,
      last_directory_reviewed_at: null,
    };
    const after = applyTransitionFreshness(before, "publish");
    expect(after.last_directory_reviewed_at).toBeTruthy();
    expect(after.last_provider_confirmed_at).toBeNull();
  });

  it("canPublish blocks a rejected initial submission", () => {
    // pending_review -> reject_submission -> unpublished, identity still pending.
    // This is the exact attack path from the verdict; it must fail closed.
    expect(
      canPublish({ status: "unpublished", identity_review_status: "pending" })
    ).toBe(false);
  });

  it("canPublish allows a previously approved, administratively unpublished listing", () => {
    // The intended republish path: identity was confirmed via approve_submission.
    expect(
      canPublish({
        status: "unpublished",
        identity_review_status: "identity-confirmed",
      })
    ).toBe(true);
  });

  it("canPublish rejects wrong statuses even with confirmed identity", () => {
    expect(
      canPublish({
        status: "published",
        identity_review_status: "identity-confirmed",
      })
    ).toBe(false);
    expect(
      canPublish({
        status: "pending_review",
        identity_review_status: "identity-confirmed",
      })
    ).toBe(false);
    expect(
      canPublish({
        status: "draft",
        identity_review_status: "identity-confirmed",
      })
    ).toBe(false);
  });

  it("canPublish handles null/undefined safely", () => {
    expect(canPublish(null)).toBe(false);
    expect(canPublish(undefined)).toBe(false);
    expect(canPublish({})).toBe(false);
  });
});

describe("R2-001 republished listing honors stale provider confirmation", () => {
  it("a republished listing with stale provider confirmation stays hidden from the default directory", () => {
    // publish refreshes directory review but NOT provider confirmation.
    // A listing whose provider assertion is >180 days old remains invisible
    // until the provider re-asserts — this is the honest behavior the
    // verdict requires (no manufactured freshness).
    const staleUnpublished = {
      company_name: "Test Lender",
      status: "unpublished",
      identity_review_status: "identity-confirmed",
      states_served: ["TX"],
      last_provider_confirmed_at: new Date(
        Date.now() - 200 * 24 * 3600 * 1000
      ).toISOString(),
      last_directory_reviewed_at: null,
    };
    const republished = {
      ...applyTransitionFreshness(staleUnpublished, "publish"),
      status: "published",
    };
    expect(republished.last_directory_reviewed_at).toBeTruthy();
    // Provider confirmation untouched -> still stale -> hidden by default.
    expect(filterListings([republished], {}).length).toBe(0);
  });

  it("a republished listing with fresh provider confirmation appears", () => {
    const freshUnpublished = {
      company_name: "Test Lender",
      status: "unpublished",
      identity_review_status: "identity-confirmed",
      states_served: ["TX"],
      last_provider_confirmed_at: new Date().toISOString(),
      last_directory_reviewed_at: null,
    };
    const republished = {
      ...applyTransitionFreshness(freshUnpublished, "publish"),
      status: "published",
    };
    expect(filterListings([republished], {}).length).toBe(1);
  });
});
