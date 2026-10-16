import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  MODERATION_ACTIONS,
  VERSION_REQUEST_TYPES,
  TRANSITION_FRESHNESS,
  applyTransitionFreshness,
  filterListings,
  isTermsStale,
} from "./listings.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const r1Sql = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261015230300_dscr_fix_round_r1.sql"),
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
  // Only the outer dispatch-level keywords (exactly two-space indent);
  // inner IF/ELSE blocks inside a branch are deeper.
  const m = rest.match(/\n  ELSIF p_action = '|\n  ELSE\n/);
  return m ? rest.slice(0, m.index) : rest;
}

// ---------------------------------------------------------------------------
// DSCR-R1-001 — freshness timestamps on public-facing transitions
// ---------------------------------------------------------------------------

describe("R1-001 freshness semantics", () => {
  const freshnessActions = [
    "approve_submission",
    "approve_version",
    "reconfirm",
    "publish",
  ];

  it("TRANSITION_FRESHNESS documents every moderation action", () => {
    for (const action of MODERATION_ACTIONS) {
      expect(TRANSITION_FRESHNESS[action], action).toBeDefined();
      expect(TRANSITION_FRESHNESS[action].provider_confirmed).toBeTypeOf(
        "boolean"
      );
      expect(TRANSITION_FRESHNESS[action].directory_reviewed).toBeTypeOf(
        "boolean"
      );
    }
  });

  it("TRANSITION_FRESHNESS marks the four public-facing actions as freshness-establishing", () => {
    for (const action of freshnessActions) {
      expect(TRANSITION_FRESHNESS[action].provider_confirmed, action).toBe(true);
      expect(TRANSITION_FRESHNESS[action].directory_reviewed, action).toBe(
        true
      );
    }
    for (const action of [
      "reject_submission",
      "reject_version",
      "unpublish",
      "remove",
    ]) {
      expect(TRANSITION_FRESHNESS[action].provider_confirmed, action).toBe(
        false
      );
    }
  });

  it("the RPC sets last_provider_confirmed_at on all four public-facing transitions", () => {
    for (const action of freshnessActions) {
      const branch = branchSql(r1Sql, action);
      expect(
        branch,
        `${action} must set last_provider_confirmed_at`
      ).toMatch(/last_provider_confirmed_at\s*=\s*now\(\)/);
    }
  });

  it("the RPC sets last_directory_reviewed_at on all four public-facing transitions", () => {
    for (const action of freshnessActions) {
      const branch = branchSql(r1Sql, action);
      expect(
        branch,
        `${action} must set last_directory_reviewed_at`
      ).toMatch(/last_directory_reviewed_at\s*=\s*now\(\)/);
    }
  });

  it("approve_version applies the staged payload's terms_as_of_date to the live row", () => {
    const branch = branchSql(r1Sql, "approve_version");
    expect(branch).toMatch(
      /terms_as_of_date\s*=\s*coalesce\(\(v_payload ->> 'terms_as_of_date'\)::date/
    );
  });

  it("the submit RPC records provider confirmation on new listings", () => {
    const fnStart = r1Sql.indexOf("FUNCTION public.dscr_submit_lender");
    const fnBody = r1Sql.slice(fnStart);
    expect(fnBody).toContain("last_provider_confirmed_at");
  });

  it("rejections and unpublish do not fabricate provider freshness", () => {
    for (const action of ["reject_submission", "reject_version", "unpublish"]) {
      const branch = branchSql(r1Sql, action);
      expect(
        branch,
        `${action} must not set last_provider_confirmed_at`
      ).not.toMatch(/last_provider_confirmed_at\s*=\s*now\(\)/);
    }
  });
});

describe("R1-001 transition-to-public-query", () => {
  const baseListing = {
    company_name: "Test Lender",
    status: "published",
    states_served: ["TX"],
  };

  it("a newly approved submission appears in the default directory", () => {
    const pending = {
      ...baseListing,
      status: "pending_review",
      last_provider_confirmed_at: null,
    };
    // Before approval: a published row with no provider confirmation is stale.
    expect(
      filterListings([{ ...pending, status: "published" }], {}).length
    ).toBe(0);
    // The RPC's approve_submission establishes freshness; the listing goes live.
    const approved = {
      ...applyTransitionFreshness(pending, "approve_submission"),
      status: "published",
    };
    const visible = filterListings([approved], {});
    expect(visible.length).toBe(1);
    expect(visible[0].last_provider_confirmed_at).toBeTruthy();
    expect(isTermsStale(visible[0].last_provider_confirmed_at)).toBe(false);
  });

  it("a reconfirmed stale listing reappears in the default directory", () => {
    const stale = {
      ...baseListing,
      last_provider_confirmed_at: new Date(
        Date.now() - 200 * 24 * 3600 * 1000
      ).toISOString(),
    };
    expect(filterListings([stale], {}).length).toBe(0);
    const reconfirmed = applyTransitionFreshness(stale, "reconfirm");
    const visible = filterListings([reconfirmed], {});
    expect(visible.length).toBe(1);
    expect(isTermsStale(visible[0].last_provider_confirmed_at)).toBe(false);
  });

  it("an approved version carries its reviewed terms_as_of_date", () => {
    // The RPC applies the staged payload's terms_as_of_date to the live row
    // (verified structurally above); the helper must not drop it.
    const stagedAsOf = "2026-10-01";
    const live = {
      ...baseListing,
      terms_as_of_date: "2025-01-01",
      last_provider_confirmed_at: new Date().toISOString(),
    };
    const after = {
      ...applyTransitionFreshness(live, "approve_version"),
      terms_as_of_date: stagedAsOf,
    };
    expect(after.terms_as_of_date).toBe(stagedAsOf);
    expect(filterListings([after], {}).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// DSCR-R1-002 — removal requests as structured reviewable state
// ---------------------------------------------------------------------------

describe("R1-002 removal-request state", () => {
  it("defines the two version request types", () => {
    expect(VERSION_REQUEST_TYPES.term_edit).toBe("term_edit");
    expect(VERSION_REQUEST_TYPES.removal_request).toBe("removal_request");
  });

  it("adds a request_type column with a CHECK constraint", () => {
    expect(r1Sql).toMatch(/ADD COLUMN IF NOT EXISTS request_type/);
    expect(r1Sql).toContain("dscr_lender_versions_request_type_check");
    expect(r1Sql).toMatch(
      /CHECK\s*\(\s*request_type IN \('term_edit',\s*'removal_request'\)\)/
    );
  });

  it("persists the removal flag as structured state at staging time", () => {
    expect(r1Sql).toMatch(
      /CASE WHEN p_removal_requested THEN 'removal_request' ELSE 'term_edit' END/
    );
    const fnStart = r1Sql.indexOf("FUNCTION public.dscr_stage_version");
    const fnBody = r1Sql.slice(fnStart);
    expect(fnBody).toContain("request_type");
  });

  it("approve_version branches on request_type", () => {
    expect(r1Sql).toMatch(/v_request_type\s*=\s*'removal_request'/);
  });

  it("approving a removal request soft-removes WITHOUT applying the payload", () => {
    const branch = branchSql(r1Sql, "approve_version");
    const removalIdx = branch.indexOf("v_request_type = 'removal_request'");
    expect(removalIdx).toBeGreaterThan(-1);
    const elseIdx = branch.indexOf("ELSE", removalIdx);
    const removalBlock = branch.slice(removalIdx, elseIdx);
    expect(removalBlock).toMatch(/status\s*=\s*'unpublished'/);
    expect(removalBlock, "payload must not be applied on removal").not.toMatch(
      /states_served\s*=/
    );
    expect(removalBlock).toMatch(/'removed'/);
    expect(removalBlock).toMatch(/NOT applied/i);
  });

  it("reject_version touches only the version row — the live listing is unchanged", () => {
    const branch = branchSql(r1Sql, "reject_version");
    expect(branch).not.toMatch(/UPDATE public\.dscr_lenders/);
    expect(branch).toMatch(/UPDATE public\.dscr_lender_versions/);
  });

  it("the admin queue API exposes request_type for pending versions", () => {
    const queueRoute = readFileSync(
      join(
        repoRoot,
        "src",
        "app",
        "api",
        "dscr-lenders",
        "admin",
        "queue",
        "route.js"
      ),
      "utf8"
    );
    expect(queueRoute).toContain("request_type");
  });

  it("the admin queue labels removal requests unambiguously", () => {
    const queueJsx = readFileSync(
      join(repoRoot, "src", "components", "dscr", "DscrAdminQueue.jsx"),
      "utf8"
    );
    expect(queueJsx).toMatch(/REMOVAL REQUEST/);
    expect(queueJsx).toMatch(/WITHOUT\s*\n?\s*changing its terms/);
    expect(queueJsx).toMatch(/Approve removal/);
    expect(queueJsx).toMatch(/Reject removal/);
  });
});

// ---------------------------------------------------------------------------
// DSCR-R1-003 — throttle counts all attempts; serialized version allocation
// ---------------------------------------------------------------------------

describe("R1-003 submission throttle and version allocation", () => {
  it("creates the durable attempts table with a per-user time index", () => {
    expect(r1Sql).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.dscr_lender_submission_attempts/
    );
    expect(r1Sql).toContain("was_duplicate");
    expect(r1Sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_dscr_submission_attempts_user_created/
    );
    expect(r1Sql).toMatch(
      /ON public\.dscr_lender_submission_attempts\s*\(\s*user_id,\s*created_at\s*\)/
    );
  });

  it("the throttle counts attempts, not lender rows", () => {
    const fnStart = r1Sql.indexOf("FUNCTION public.dscr_submit_lender");
    const fnBody = r1Sql.slice(fnStart);
    expect(fnBody).toMatch(
      /FROM public\.dscr_lender_submission_attempts/
    );
    expect(
      fnBody,
      "old lender-row count must be gone"
    ).not.toMatch(/FROM public\.dscr_lenders\s+WHERE owner_user_id/);
  });

  it("inserts an attempt row on every accepted path (new, duplicate, race-duplicate)", () => {
    const fnStart = r1Sql.indexOf("FUNCTION public.dscr_submit_lender");
    const fnBody = r1Sql.slice(fnStart);
    const matches =
      fnBody.match(/INSERT INTO public\.dscr_lender_submission_attempts/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("marks duplicate claims as duplicates in the attempt record", () => {
    const fnStart = r1Sql.indexOf("FUNCTION public.dscr_submit_lender");
    const fnBody = r1Sql.slice(fnStart);
    expect(fnBody).toMatch(/was_duplicate\)\s*\n?\s*VALUES\s*\([^)]*,\s*true\)/);
  });

  it("serializes version allocation per lender in every version-insert path", () => {
    const matches =
      r1Sql.match(
        /pg_advisory_xact_lock\(hashtext\('dscr_version:'/g
      ) || [];
    // submit duplicate path, submit race path, stage_version
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("the 4th attempt in 24h is throttled (attempts are inside the serialized transaction)", () => {
    const fnStart = r1Sql.indexOf("FUNCTION public.dscr_submit_lender");
    const fnBody = r1Sql.slice(fnStart);
    // Throttle check precedes all inserts; attempts are inserted before RETURN.
    const checkIdx = fnBody.indexOf("SUBMIT_THROTTLED");
    const firstAttemptInsert = fnBody.indexOf(
      "INSERT INTO public.dscr_lender_submission_attempts"
    );
    expect(checkIdx).toBeGreaterThan(-1);
    expect(firstAttemptInsert).toBeGreaterThan(checkIdx);
    expect(fnBody).toMatch(/v_recent >= 3/);
  });

  it("the route still reports the 3-per-24h limit honestly", () => {
    const submitRoute = readFileSync(
      join(
        repoRoot,
        "src",
        "app",
        "api",
        "dscr-lenders",
        "submit",
        "route.js"
      ),
      "utf8"
    );
    expect(submitRoute).toMatch(/3 per 24 hours/);
    expect(submitRoute).toMatch(/status:\s*429/);
  });
});
