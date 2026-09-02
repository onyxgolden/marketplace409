// Real-infrastructure integration test for the private FORGE Health tracker's RPCs and RLS
// policies, run against a local Supabase stack (Postgres + GoTrue + PostgREST) via Docker --
// never against the real, hosted project. The migration-text checks in
// private-health-tracker.migration.test.js confirm the SQL *says* the right thing; this confirms
// it *does* the right thing under real row-level security with real authenticated sessions.
//
// Requires a local Supabase stack reachable at 127.0.0.1:54321/54322 (e.g. `supabase start` from
// any worktree of this repo -- the local stack is shared across worktrees by fixed port). The
// suite self-skips (not fails) when that stack isn't reachable, so it never blocks a normal
// `vitest run` in an environment without Docker running.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const LOCAL_URL = "http://127.0.0.1:54321";
// Well-known, publicly documented Supabase CLI local-dev demo keys -- identical on every
// `supabase start` unless explicitly overridden, never secrets.
const LOCAL_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_marketplace409-reservation-validation";
const TEST_PASSWORD = "correct-horse-battery-staple-1";

const MIGRATION_SQL = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260901000700_create_private_health_tracker.sql"),
  "utf8",
);

const HEALTH_TABLES = [
  "health_audit_log", "health_clinical_timeline", "health_workouts", "health_measurements",
  "health_regimen_events", "health_regimen_items", "health_lab_results", "health_extraction_proposals",
  "health_documents", "health_authorization_verifications", "health_authorizations",
  "health_record_requests", "health_provider_insurance_history", "health_care_team",
  "health_conditions", "health_profiles", "health_workspace_members", "health_workspaces",
];
const HEALTH_FUNCTIONS = [
  "confirm_health_extraction_proposal(uuid,jsonb)", "health_has_workspace_access(uuid)",
  "bootstrap_private_health_workspace()", "add_health_managed_dependent(uuid,text,text,date)",
  "audit_health_record_change()",
];

function psql(sql) {
  return execFileSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
    input: sql, encoding: "utf8",
  });
}

async function isLocalStackReachable() {
  try {
    const response = await fetch(`${LOCAL_URL}/auth/v1/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

const reachable = await isLocalStackReachable();

describe.skipIf(!reachable)("private FORGE Health RPCs and RLS (real local Supabase)", () => {
  const admin = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  let owner;
  let coOwner;
  let stranger;
  let ownerClient;
  let coOwnerClient;
  let strangerClient;
  let workspaceId;

  async function signInFreshClient(email) {
    const client = createClient(LOCAL_URL, LOCAL_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
    if (error) throw error;
    return client;
  }

  beforeAll(async () => {
    // Idempotency guard: a prior run's afterAll should have dropped these, but if it didn't
    // (e.g. the run was killed mid-suite), `drop ... if exists` is a safe no-op either way, so
    // this always leaves a clean slate before re-applying the migration fresh.
    psql(`drop table if exists ${HEALTH_TABLES.map((t) => `public.${t}`).join(", ")} cascade;`);
    psql(`drop function if exists ${HEALTH_FUNCTIONS.map((fn) => `public.${fn}`).join(", ")} cascade;`);
    psql(MIGRATION_SQL);
    // Raw psql DDL doesn't go through Supabase's migration tooling, which normally triggers
    // PostgREST's schema-cache reload automatically. Without this, PostgREST can still 404 the
    // brand-new tables for a few seconds after they exist, causing exactly the kind of flake this
    // suite is meant to catch real bugs, not infrastructure lag.
    psql("notify pgrst, 'reload schema';");
    await new Promise((resolve) => setTimeout(resolve, 500));

    const suffix = crypto.randomUUID().slice(0, 8);
    const created = await Promise.all([
      admin.auth.admin.createUser({ email: `health-owner-${suffix}@example.test`, password: TEST_PASSWORD, email_confirm: true }),
      admin.auth.admin.createUser({ email: `health-coowner-${suffix}@example.test`, password: TEST_PASSWORD, email_confirm: true }),
      admin.auth.admin.createUser({ email: `health-stranger-${suffix}@example.test`, password: TEST_PASSWORD, email_confirm: true }),
    ]);
    for (const result of created) if (result.error) throw result.error;
    [owner, coOwner, stranger] = created.map((result) => result.data.user);

    // workspace_members grants INSERT/SELECT/UPDATE/DELETE only to the table owner (`postgres`) --
    // not even service_role -- so real membership changes only ever happen through this repo's own
    // SECURITY DEFINER RPCs. Test setup goes through the same superuser connection the migration
    // itself uses, matching that this is infrastructure setup, not an app-level mutation.
    psql(`insert into public.workspace_members(owner_id,id,member_user_id,role,status,invited_email,invited_by,activated_at)
      values ('${owner.id}', '${crypto.randomUUID()}', '${coOwner.id}', 'co_owner', 'active', '${coOwner.email}', '${owner.id}', now());`);

    [ownerClient, coOwnerClient, strangerClient] = await Promise.all([
      signInFreshClient(owner.email), signInFreshClient(coOwner.email), signInFreshClient(stranger.email),
    ]);
  }, 30000);

  afterAll(async () => {
    if (!reachable) return;
    // Order matters: health_documents.uploaded_by, health_extraction_proposals.created_by/
    // reviewed_by, and workspace_members.invited_by all reference auth.users(id) with no ON DELETE
    // cascade/set-null, so deleting a test user while those rows still exist is a foreign-key
    // violation. Drop the health tables (which cascade away their own rows) and the membership row
    // first, then delete the auth users last.
    // The health-documents storage bucket row is left in place: Supabase Storage refuses direct
    // SQL deletes on its own tables ("Use the Storage API instead"), and the migration's own
    // `insert ... on conflict do update` makes bucket creation idempotent, so there's nothing to
    // clean up here -- the next run's migration re-apply just updates the existing row in place.
    psql(`drop table if exists ${HEALTH_TABLES.map((t) => `public.${t}`).join(", ")} cascade;`);
    psql(`drop function if exists ${HEALTH_FUNCTIONS.map((fn) => `public.${fn}`).join(", ")} cascade;`);
    if (owner) psql(`delete from public.workspace_members where owner_id = '${owner.id}';`);
    for (const user of [owner, coOwner, stranger]) {
      if (!user) continue;
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) throw new Error(`Failed to delete test user ${user.email}: ${error.message}`);
    }
  }, 30000);

  it("bootstraps a workspace with exactly the owner and co-owner as profiles, and is idempotent", async () => {
    const first = await ownerClient.rpc("bootstrap_private_health_workspace");
    expect(first.error).toBeNull();
    workspaceId = first.data;
    expect(workspaceId).toBeTruthy();

    const second = await ownerClient.rpc("bootstrap_private_health_workspace");
    expect(second.error).toBeNull();
    expect(second.data).toBe(workspaceId);

    const profiles = await ownerClient.from("health_profiles").select("display_name,auth_user_id,profile_type").eq("workspace_id", workspaceId);
    expect(profiles.error).toBeNull();
    expect(profiles.data).toHaveLength(2);
    expect(profiles.data.map((row) => row.auth_user_id).sort()).toEqual([coOwner.id, owner.id].sort());
    expect(profiles.data.every((row) => row.profile_type === "member")).toBe(true);
  });

  it("refuses to bootstrap a workspace for a user with no active co-owner", async () => {
    const result = await strangerClient.rpc("bootstrap_private_health_workspace");
    expect(result.error).toBeTruthy();
    expect(result.error.message).toContain("co-owner");
  });

  it("denies a non-member both the access-check RPC and direct table reads under RLS", async () => {
    const access = await strangerClient.rpc("health_has_workspace_access", { p_workspace_id: workspaceId });
    expect(access.data).toBe(false);

    const read = await strangerClient.from("health_profiles").select("id").eq("workspace_id", workspaceId);
    expect(read.data).toEqual([]);
  });

  it("lets a co-owner add a managed dependent with no login, attributed to them", async () => {
    const result = await coOwnerClient.rpc("add_health_managed_dependent", {
      p_workspace_id: workspaceId, p_display_name: "Elderly Parent", p_relationship: "parent", p_date_of_birth: null,
    });
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ display_name: "Elderly Parent", profile_type: "managed_dependent", auth_user_id: null, managed_by: coOwner.id });
  });

  it("confirms a reviewed lab-results proposal atomically and rejects re-confirming it", async () => {
    const ownerProfile = await ownerClient.from("health_profiles").select("id").eq("workspace_id", workspaceId).eq("auth_user_id", owner.id).single();
    expect(ownerProfile.error).toBeNull();
    const profileId = ownerProfile.data.id;

    const document = await ownerClient.from("health_documents").insert({
      workspace_id: workspaceId, profile_id: profileId, category: "lab_report", title: "Integration test lab report",
      bucket: "health-documents", object_path: `${workspaceId}/${profileId}/integration-test.pdf`,
      original_filename: "integration-test.pdf", mime_type: "application/pdf", byte_size: 1024,
      extraction_method: "native_pdf", extracted_text: "Hemoglobin A1c 5.4 %", uploaded_by: owner.id,
    }).select("id").single();
    expect(document.error).toBeNull();

    const proposal = await ownerClient.from("health_extraction_proposals").insert({
      workspace_id: workspaceId, profile_id: profileId, document_id: document.data.id, proposal_type: "lab_results",
      proposed_data: { collectedOn: "2026-08-01", results: [{ markerName: "Hemoglobin A1c", valueNumeric: 5.4, unit: "%", flag: "unknown" }] },
      parser_version: "integration-test-1", created_by: owner.id,
    }).select("id").single();
    expect(proposal.error).toBeNull();

    // Either household member can review -- confirm as the co-owner, not the uploader.
    const confirmed = await coOwnerClient.rpc("confirm_health_extraction_proposal", {
      p_proposal_id: proposal.data.id,
      p_reviewed_data: { collectedOn: "2026-08-01", results: [{ markerName: "Hemoglobin A1c", valueNumeric: 5.4, unit: "%", flag: "normal" }] },
    });
    expect(confirmed.error).toBeNull();
    expect(confirmed.data).toMatchObject({ recordType: "lab_results", createdCount: 1 });

    const labResults = await ownerClient.from("health_lab_results").select("marker_name,value_numeric,flag").eq("profile_id", profileId);
    expect(labResults.data).toEqual([{ marker_name: "Hemoglobin A1c", value_numeric: 5.4, flag: "normal" }]);

    const documentAfter = await ownerClient.from("health_documents").select("review_status").eq("id", document.data.id).single();
    expect(documentAfter.data.review_status).toBe("confirmed");

    const reConfirm = await ownerClient.rpc("confirm_health_extraction_proposal", {
      p_proposal_id: proposal.data.id, p_reviewed_data: { collectedOn: "2026-08-01", results: [] },
    });
    expect(reConfirm.error).toBeTruthy();
    expect(reConfirm.error.message).toContain("already been reviewed");
  });

  it("records an append-only audit trail that members can read but not modify or delete", async () => {
    const entries = await ownerClient.from("health_audit_log").select("table_name,action,actor_id").eq("workspace_id", workspaceId);
    expect(entries.error).toBeNull();
    expect(entries.data.length).toBeGreaterThan(0);
    expect(entries.data.some((row) => row.table_name === "health_lab_results" && row.action === "insert")).toBe(true);

    const deleteAttempt = await ownerClient.from("health_audit_log").delete().eq("workspace_id", workspaceId);
    expect(deleteAttempt.error).toBeTruthy();

    const updateAttempt = await ownerClient.from("health_audit_log").update({ action: "update" }).eq("workspace_id", workspaceId);
    expect(updateAttempt.error).toBeTruthy();
  });
});
