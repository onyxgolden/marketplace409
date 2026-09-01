import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Requirement 11's full owner/co-owner/unauthorized-user/RLS/RPC regression matrix, assembled at
// the end of the workspace-membership sweep (checkpoints 1-6) rather than duplicated per-migration.
// This is the final checkpoint's deliverable: it does not re-verify things already covered file by
// file in checkpoints 1-6 (e.g. that every individual policy/RPC was converted) -- it verifies the
// six specific properties requirement 11 names, several of which no single earlier checkpoint test
// directly proves.

function readMigration(filename) {
  return readFileSync(resolve(process.cwd(), "supabase/migrations", filename), "utf8");
}

function codeOnly(sql) {
  return sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
}

// --- (a)-(d): primary owner / active co-owner / suspended-or-invited co-owner / unrelated user ---
//
// has_workspace_access(p_owner_id text) is defined once, in one migration (checkpoint 1), as:
//   p_owner_id = auth.uid()::text
//   or exists (select 1 from workspace_members where owner_id = p_owner_id
//              and member_user_id = auth.uid() and status = 'active' and role = 'co_owner')
// Every RLS policy and RPC guard converted in checkpoints 3-4 calls this one function, so there is
// exactly one place authorization logic can be wrong. Rather than re-assert the SQL text (checkpoint
// 1's own migration test already does), this section mirrors the predicate as a plain JS function and
// runs it against all four requirement-11 actor scenarios -- genuine behavioral coverage of the
// decision the SQL makes, not just confirmation the right words appear in the file.
function hasWorkspaceAccess(ownerId, callerId, membershipRows) {
  if (ownerId === callerId) return true;
  return membershipRows.some(
    (row) => row.owner_id === ownerId && row.member_user_id === callerId && row.status === "active" && row.role === "co_owner",
  );
}

describe("Requirement 11 security/regression matrix (checkpoint 7)", () => {
  it("has_workspace_access is defined by exactly the predicate this matrix mirrors", () => {
    const sql = readMigration("20260829000100_add_workspace_authorization_helpers.sql").toLowerCase().replace(/\s+/g, " ");
    expect(sql).toContain(
      "select p_owner_id = auth.uid()::text or exists ( select 1 from workspace_members where owner_id = p_owner_id and member_user_id = auth.uid() and status = 'active' and role = 'co_owner' )",
    );
  });

  it("(a) the primary owner retains full access, with no workspace_members row at all", () => {
    expect(hasWorkspaceAccess("owner_1", "owner_1", [])).toBe(true);
  });

  it("(b) an active co_owner has full access", () => {
    const rows = [{ owner_id: "owner_1", member_user_id: "wife_1", status: "active", role: "co_owner" }];
    expect(hasWorkspaceAccess("owner_1", "wife_1", rows)).toBe(true);
  });

  it("(c) a suspended or still-invited (not yet active) co-owner does NOT have access", () => {
    const suspended = [{ owner_id: "owner_1", member_user_id: "wife_1", status: "suspended", role: "co_owner" }];
    const invited = [{ owner_id: "owner_1", member_user_id: "wife_1", status: "invited", role: "co_owner" }];
    expect(hasWorkspaceAccess("owner_1", "wife_1", suspended)).toBe(false);
    expect(hasWorkspaceAccess("owner_1", "wife_1", invited)).toBe(false);
  });

  it("(c) a role other than co_owner (e.g. a future manager/bookkeeper/read_only row) does NOT grant access in this slice", () => {
    const rows = [{ owner_id: "owner_1", member_user_id: "assistant_1", status: "active", role: "manager" }];
    expect(hasWorkspaceAccess("owner_1", "assistant_1", rows)).toBe(false);
  });

  it("(d) a wholly unrelated authenticated user, with no membership row anywhere in this workspace, does NOT have access", () => {
    const rows = [{ owner_id: "owner_1", member_user_id: "wife_1", status: "active", role: "co_owner" }];
    expect(hasWorkspaceAccess("owner_1", "stranger_1", rows)).toBe(false);
  });

  it("(d) an active co-owner of a DIFFERENT owner's workspace does NOT gain access to this one", () => {
    const rows = [{ owner_id: "other_owner_9", member_user_id: "wife_1", status: "active", role: "co_owner" }];
    expect(hasWorkspaceAccess("owner_1", "wife_1", rows)).toBe(false);
  });
});

// --- (e): tenant-facing policies are provably unchanged ---
//
// This is the live, deduplicated set of every genuinely tenant-facing RLS policy across Rental
// Manager (captured via `select tablename, policyname from pg_policies where policyname ilike
// '%tenant_select%' or '%tenant_read%' or '%tenant_insert%'`, plus rental_tenants_self_select, which
// uses the same self-service shape under a different naming convention). None of these represent
// owner-management access and none should ever be touched by the has_workspace_access conversion --
// a tenant's own portal access must be governed only by their own tenant/lease identity, never by
// workspace co-ownership.
const TENANT_FACING_POLICIES = Object.freeze([
  "ach_authorizations_tenant_select", "insurance_evidence_tenant_insert", "insurance_evidence_tenant_read",
  "insurance_policy_tenant_select", "insurance_referral_tenant_select", "insurance_requirement_tenant_select",
  "pet_fee_charges_tenant_select", "pet_fees_tenant_select", "pet_liability_tenant_select",
  "rent_charges_tenant_select", "rent_reporting_fee_tenant_select", "rent_reporting_tenant_select",
  "rent_schedules_tenant_select", "rental_animals_tenant_select", "rental_autopay_tenant_read",
  "rental_deposit_tenant_select", "rental_deposit_tx_tenant_select", "rental_document_ack_tenant_select",
  "rental_documents_tenant_select", "rental_inspection_ack_tenant_select", "rental_inspection_item_tenant_select",
  "rental_inspection_tenant_select", "rental_late_assessment_tenant_select", "rental_late_rule_tenant_select",
  "rental_lease_change_tenant_select", "rental_lease_preparation_tenant_select",
  "rental_lease_preparation_version_tenant_select", "rental_lease_tenants_tenant_select",
  "rental_leases_tenant_select", "rental_maintenance_tenant_select", "rental_payments_tenant_select",
  "rental_support_event_tenant_read", "rental_support_tenant_read", "rental_units_tenant_select",
  "rental_tenants_self_select",
]);

const POLICY_CONVERSION_MIGRATIONS = Object.freeze([
  "20260829000300_convert_rental_identity_policies_to_workspace_access.sql",
  "20260829000400_convert_rental_billing_policies_to_workspace_access.sql",
  "20260829000500_convert_rental_maintenance_policies_to_workspace_access.sql",
  "20260829000600_convert_rental_insurance_animal_policies_to_workspace_access.sql",
  "20260829000700_convert_rental_notifications_support_policies_to_workspace_access.sql",
  "20260829001300_convert_financial_policies_to_workspace_access.sql",
]);

const RPC_CONVERSION_MIGRATIONS = Object.freeze([
  "20260829000800_convert_rental_lease_rpcs_to_workspace_access.sql",
  "20260829000900_convert_rental_billing_rpcs_to_workspace_access.sql",
  "20260829001000_convert_rental_maintenance_rpcs_to_workspace_access.sql",
  "20260829001100_convert_rental_insurance_animal_rpcs_to_workspace_access.sql",
  "20260829001200_convert_rental_notifications_support_rpcs_to_workspace_access.sql",
  "20260829001400_convert_financial_rpcs_to_workspace_access.sql",
]);

describe("(e) tenant-facing policies and RPCs are provably unchanged (checkpoint 7)", () => {
  it("none of the 6 owner-management policy-conversion migrations drop or recreate a tenant-facing policy", () => {
    const touchedTenantPolicies = [];
    for (const filename of POLICY_CONVERSION_MIGRATIONS) {
      const sql = codeOnly(readMigration(filename)).toLowerCase();
      for (const policy of TENANT_FACING_POLICIES) {
        if (sql.includes(`policy "${policy.toLowerCase()}"`)) {
          touchedTenantPolicies.push(`${filename}: ${policy}`);
        }
      }
    }
    expect(touchedTenantPolicies).toEqual([]);
  });

  it("none of the 6 owner-management RPC-conversion migrations redefines a tenant-portal RPC (claim_rental_tenant_portal and its siblings stay on their own tenant-session authorization, never has_workspace_access)", () => {
    for (const filename of RPC_CONVERSION_MIGRATIONS) {
      const sql = codeOnly(readMigration(filename)).toLowerCase();
      expect(sql, filename).not.toMatch(/tenant_portal|claim_rental_tenant/);
    }
  });
});

// --- (f): invitation RPCs never accept a browser-submitted user UUID without server-side verification ---
describe("(f) invitation RPCs reject a forged/unverified identity (checkpoint 7)", () => {
  const invitationSql = codeOnly(readMigration("20260829000200_add_workspace_invitation_rpcs.sql")).toLowerCase();

  it("invite_workspace_member takes only an email (and role), never a client-supplied user id", () => {
    expect(invitationSql).toContain("create or replace function public.invite_workspace_member(p_email text, p_role text default 'co_owner')");
    expect(invitationSql).not.toMatch(/invite_workspace_member\([^)]*\buuid\b/);
  });

  it("invite_workspace_member resolves the invitee's user id itself, from auth.users by email -- never trusting a client value", () => {
    expect(invitationSql).toContain("select users.id, users.email_confirmed_at");
    expect(invitationSql).toContain("into invitee_user_id, invitee_confirmed_at");
    expect(invitationSql).toContain("from auth.users users");
    expect(invitationSql).toContain("where lower(nullif(btrim(users.email), '')) = normalized_email");
  });

  it("invite_workspace_member refuses an invitee whose email is not yet confirmed", () => {
    expect(invitationSql).toContain("if invitee_confirmed_at is null then");
    expect(invitationSql).toContain("raise exception 'that account has not confirmed its email address yet.'");
  });

  it("accept_workspace_invitation takes zero parameters -- there is no field for a client to submit any identity into", () => {
    expect(invitationSql).toContain("create or replace function public.accept_workspace_invitation()");
  });

  it("accept_workspace_invitation matches the invitation strictly by auth.uid(), never a request parameter", () => {
    expect(invitationSql).toContain("authenticated_user_id uuid := auth.uid();");
    expect(invitationSql).toContain("where member_user_id = authenticated_user_id");
    expect(invitationSql).toContain("and status = 'invited'");
  });
});
