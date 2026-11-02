// Invite claim flow smoke tests (scope §2.2).
//
// The send test needs Resend working in the test target (the send action
// returns 502 and flips nothing when the provider fails — that is the app's
// honest behavior, and the test reports it as a target gap, not a skip).
// The claim tests do not need email delivery at all: invited rows are
// seeded, and pre-confirmed synthetic users exercise the claim RPC's
// confirmed-email gate directly.
import { test, expect } from "@playwright/test";
import { readRunState, userFor } from "../helpers/fixtures.js";
import { signIn, signUp, signedInRequest, postRentalOperation } from "../helpers/auth.js";
import { expectNoCriticalViolations } from "../helpers/axe.js";
import { scratchClient, readRow } from "../helpers/seed.js";

test.describe.serial("tenant invite claim flow", () => {
  let state;
  let config;
  let db;

  test.beforeAll(() => {
    state = readRunState();
    config = {
      baseUrl: state.baseUrl,
      supabaseUrl: process.env.E2E_SUPABASE_URL,
      serviceRoleKey: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY,
    };
    db = scratchClient(config);
  });

  const invite = () => state.owners.invite;
  const inviteName = () => `Smoke Tenant Invite ${state.runId}`;
  const claimName = () => `Smoke Tenant Claim ${state.runId}`;

  test("owner send flips the tenant to invited, and only on actual send", async ({ page }, testInfo) => {
    const owner = userFor(state, "ownerInvite");
    await signIn(page, config.baseUrl, owner.email, owner.password);
    await page.goto(
      `${config.baseUrl}/forge/rental?section=tenants&recordType=tenant&recordId=${invite().tenantInviteId}`,
    );
    await expect(page.getByText(inviteName()).first()).toBeVisible();
    await expect(page.getByText("Invite not sent").first()).toBeVisible();
    await page.getByRole("button", { name: "Send invite email" }).first().click();
    await expect(page.getByRole("heading", { name: "Send invite email?" })).toBeVisible();
    await page.getByRole("button", { name: "Send invite", exact: true }).click();
    await expect(page.getByText(/Invite email sent to/)).toBeVisible();
    await expect(page.getByText(/Invite sent/).first()).toBeVisible();
    const row = await readRow(db, "rental_tenants", { id: invite().tenantInviteId });
    expect(row.status).toBe("invited");
    expect(row.invited_at).not.toBeNull();
    await expectNoCriticalViolations(page, "tenant panel", testInfo);
  });

  test("wrong-email sign-in sees no lease details and claims nothing", async ({ page }) => {
    const wrong = userFor(state, "tenantWrong");
    await signIn(page, config.baseUrl, wrong.email, wrong.password);
    await page.goto(`${config.baseUrl}/forge/rental/portal`);
    // Claim returns null for a non-matching email: no portal, no lease.
    await expect(page.getByRole("heading", { name: "Unable to load your tenant portal." })).toBeVisible();
    await expect(page.getByText("Current balance")).toHaveCount(0);
    const row = await readRow(db, "rental_tenants", { id: invite().tenantClaimId });
    expect(row.auth_user_id).toBeNull();
  });

  test("duplicate invitations for one email raise instead of linking", async ({ page }) => {
    const claim = userFor(state, "tenantClaim");
    await signIn(page, config.baseUrl, claim.email, claim.password);
    await page.goto(`${config.baseUrl}/forge/rental/portal`);
    // Two invited rows (two owners) match this email: the RPC raises and
    // the portal shows its error state, linking neither row.
    await expect(page.getByRole("heading", { name: "Unable to load your tenant portal." })).toBeVisible();
    const claimRow = await readRow(db, "rental_tenants", { id: invite().tenantClaimId });
    const dupRow = await readRow(db, "rental_tenants", { id: state.owners.dup.tenantDupId });
    expect(claimRow.auth_user_id).toBeNull();
    expect(dupRow.auth_user_id).toBeNull();
  });

  test("first portal load claims the invited tenant and shows lease details", async ({ page }, testInfo) => {
    // The duplicate row from the previous test must not block this claim:
    // remove it first (it served its purpose) so exactly one match remains.
    // This is fixture hygiene inside the scratch project, not app behavior.
    const { error } = await db.from("rental_lease_tenants")
      .delete().eq("owner_id", state.owners.dup.ownerId);
    if (error) throw new Error(`dup membership cleanup failed: ${error.message}`);
    const { error: tenantError } = await db.from("rental_tenants")
      .delete().eq("id", state.owners.dup.tenantDupId);
    if (tenantError) throw new Error(`dup tenant cleanup failed: ${tenantError.message}`);
    const claim = userFor(state, "tenantClaim");
    await signIn(page, config.baseUrl, claim.email, claim.password);
    await page.goto(`${config.baseUrl}/forge/rental/portal`);
    await expect(page.getByText(claimName()).first()).toBeVisible();
    await expect(page.getByText("Current balance")).toBeVisible();
    await expect(page.getByText(invite().unitLabel)).toBeVisible();
    const row = await readRow(db, "rental_tenants", { id: invite().tenantClaimId });
    expect(row.auth_user_id).toBe(claim.id);
    expect(row.status).toBe("active");
    expect(row.activated_at).not.toBeNull();
    await expectNoCriticalViolations(page, "portal claimed tenant", testInfo);
  });

  test("unconfirmed signup cannot claim: no session, no lease, row untouched", async ({ page }) => {
    const signupEmail = invite().tenantSignupEmail;
    await signUp(page, config.baseUrl, signupEmail, `Smk-${state.runId}-!9x`, { expectSession: false });
    // No session is established for an unconfirmed account: the portal
    // still shows the signed-out card, never lease details.
    await page.goto(`${config.baseUrl}/forge/rental/portal`);
    await expect(page.getByRole("heading", { name: "Sign in to view your tenant portal" })).toBeVisible();
    const row = await readRow(db, "rental_tenants", { id: invite().tenantSignupId });
    expect(row.auth_user_id).toBeNull();
    expect(row.status).toBe("invited");
  });

  test("API negatives: claimed 409, cross-workspace 404, read-only 403, delete claimed 409", async ({ page }) => {
    const owner = userFor(state, "ownerInvite");
    const request = await signedInRequest(page, config.baseUrl, owner.email, owner.password);
    // Already claimed (claim test ran before this one in file order).
    const claimed = await postRentalOperation(request, config.baseUrl, {
      operation: "send-tenant-invite", tenantId: invite().tenantClaimId,
    });
    expect(claimed.status).toBe(409);
    // Another workspace's tenant (the lease owner's tenant): 404, never a
    // 403 that leaks existence. Uses a row the earlier tests did not delete.
    const foreign = await postRentalOperation(request, config.baseUrl, {
      operation: "send-tenant-invite", tenantId: state.owners.lease.tenantOneId,
    });
    expect(foreign.status).toBe(404);
    // A claimed tenant cannot be deleted from the owner side.
    const deleteClaimed = await postRentalOperation(request, config.baseUrl, {
      operation: "delete-unused-tenant", tenantId: invite().tenantClaimId, confirmation: "DELETE",
    });
    expect(deleteClaimed.status).toBe(409);
    // Read-only member cannot send invites.
    const readonlyPage = await page.context().newPage();
    const readonly = userFor(state, "readonlyMember");
    const readonlyRequest = await signedInRequest(readonlyPage, config.baseUrl, readonly.email, readonly.password);
    const blocked = await postRentalOperation(readonlyRequest, config.baseUrl, {
      operation: "send-tenant-invite", tenantId: state.owners.lease.tenantOneId,
    });
    expect(blocked.status).toBe(403);
    await readonlyPage.close();
  });
});
