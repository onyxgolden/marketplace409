// Lease creation flow smoke tests (scope §2.3).
//
// Order matters: the primary-less warning test runs first, while tenantOne
// belongs to exactly one lease — the tenant-context navigation that selects
// a lease finds the first membership for that tenant, so it stays
// deterministic only before the create test adds a second membership.
import { test, expect } from "@playwright/test";
import { readRunState, userFor } from "../helpers/fixtures.js";
import { signIn, signedInRequest, postRentalOperation } from "../helpers/auth.js";
import { expectNoCriticalViolations } from "../helpers/axe.js";
import { scratchClient, readRow } from "../helpers/seed.js";

test.describe.serial("rental lease creation flow", () => {
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

  const lease = () => state.owners.lease;
  const owner = () => userFor(state, "ownerLease");

  async function leasesSection(page, tenantContextId) {
    const params = tenantContextId
      ? `?section=leases&recordType=tenant&recordId=${tenantContextId}`
      : "?section=leases";
    await page.goto(`${config.baseUrl}/forge/rental${params}`);
    await expect(page.getByText("Leases and rent schedules")).toBeVisible();
  }

  async function memberRow(page, tenantName) {
    return page.locator("li", { hasText: tenantName }).first();
  }

  async function membershipRole(leaseId, tenantId) {
    const row = await readRow(db, "rental_lease_tenants", { lease_id: leaseId, tenant_id: tenantId });
    return row?.occupancy_role || null;
  }

  test("pre-seeded primary-less lease shows the no-primary warning", async ({ page }, testInfo) => {
    await signIn(page, config.baseUrl, owner().email, owner().password);
    await leasesSection(page, lease().tenantOneId);
    await expect(page.getByText(
      "This lease has no primary tenant — make one primary below before adding a co-tenant.",
    )).toBeVisible();
    // The warning lease has exactly one member, a co-tenant, and no primary.
    expect(await membershipRole(lease().leaseNoPrimaryId, lease().tenantOneId)).toBe("co_tenant");
    await expectNoCriticalViolations(page, "lease detail no-primary", testInfo);
  });

  test("creating a lease lands the first picked tenant as primary", async ({ page }, testInfo) => {
    await signIn(page, config.baseUrl, owner().email, owner().password);
    await leasesSection(page);
    await page.getByRole("button", { name: "+ Add a lease for an existing tenant" }).click();
    const form = page.locator("form", { has: page.locator('select[name="unitId"]') });
    await expect(form).toBeVisible();
    await form.locator('select[name="unitId"]').selectOption(lease().unitId);
    await form.locator('select[name="tenantId"]').selectOption(lease().tenantTwoId);
    const today = new Date().toISOString().slice(0, 10);
    await form.locator('input[name="startDate"]').fill(today);
    await form.locator('input[name="monthlyRent"]').fill("1750");
    await form.locator('input[name="petFee"]').fill("25");
    await form.locator('input[name="securityDeposit"]').fill("1750");
    await form.locator('input[name="jurisdiction"]').fill("TX");
    await form.locator('input[name="dueDay"]').fill("1");
    await form.locator('input[name="notes"]').fill("Smoke test lease");
    // beginChargesDate and endDate stay blank: charges from move-in, ongoing.
    await form.getByRole("button", { name: "Save draft lease and schedule" }).click();
    await expect(page.getByText(/Lease saved:/)).toBeVisible();
    // Backstop reads: the new lease, its primary membership, its draft
    // schedule, and the deposit the create flow records.
    const { data: leases, error } = await db.from("rental_leases").select("*").eq("owner_id", lease().ownerId);
    if (error) throw new Error(`created lease lookup failed: ${error.message}`);
    const created = leases.find((item) => item.id !== lease().leaseNoPrimaryId);
    expect(created).toBeTruthy();
    expect(Number(created.monthly_rent_cents)).toBe(175000);
    expect(await membershipRole(created.id, lease().tenantTwoId)).toBe("primary");
    const schedule = await readRow(db, "rent_schedules", { lease_id: created.id });
    expect(schedule).not.toBeNull();
    const deposit = await readRow(db, "rental_security_deposits", { lease_id: created.id });
    expect(deposit).not.toBeNull();
    expect(Number(deposit.required_amount_cents)).toBe(175000);
    state.createdLeaseId = created.id;
    await expectNoCriticalViolations(page, "lease create form", testInfo);
  });

  test("co-tenant add then make-primary swap", async ({ page }) => {
    const createdId = state.createdLeaseId;
    expect(createdId).toBeTruthy();
    await signIn(page, config.baseUrl, owner().email, owner().password);
    // tenantTwo's only lease is the created one, so context selects it.
    await leasesSection(page, lease().tenantTwoId);
    await expect(page.getByText(lease().tenantTwoName)).toBeVisible();
    const addForm = page.locator("form", { has: page.locator('select[name="coTenantId"]') });
    await expect(addForm).toBeVisible();
    await addForm.locator('select[name="coTenantId"]').selectOption(lease().tenantOneId);
    await addForm.getByRole("button", { name: "Add co-tenant" }).click();
    await expect(memberRow(page, lease().tenantOneName)).toBeVisible();
    expect(await membershipRole(createdId, lease().tenantOneId)).toBe("co_tenant");
    // Swap: tenantOne becomes primary, tenantTwo drops to co-tenant.
    await memberRow(page, lease().tenantOneName).getByRole("button", { name: "Make primary" }).click();
    await expect(async () => {
      expect(await membershipRole(createdId, lease().tenantOneId)).toBe("primary");
      expect(await membershipRole(createdId, lease().tenantTwoId)).toBe("co_tenant");
    }).toPass({ timeout: 20000 });
    await expect(page.getByText("This lease has no primary tenant")).toHaveCount(0);
  });

  test("read-only member cannot save a lease via the API", async ({ page }) => {
    const readonly = userFor(state, "readonlyMember");
    const request = await signedInRequest(page, config.baseUrl, readonly.email, readonly.password);
    const unit = await readRow(db, "rental_units", { id: lease().unitId });
    const response = await postRentalOperation(request, config.baseUrl, {
      operation: "save-lease",
      lease: {
        propertyId: unit.property_id, unitId: lease().unitId, tenantIds: [lease().tenantTwoId],
        status: "draft", startDate: new Date().toISOString().slice(0, 10), endDate: null,
        beginChargesDate: null, monthlyRentCents: 175000, currencyCode: "USD", rentDueDay: 1, notes: null,
      },
    });
    expect(response.status).toBe(403);
  });
});
