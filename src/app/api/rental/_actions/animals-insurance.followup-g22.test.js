import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./shared.js", () => ({
  badRequest: (message) => ({ status: 400, json: async () => ({ error: message }) }),
  id: (prefix, value) => value || `${prefix}_test`,
  readOnlyWriteBlocked: vi.fn().mockResolvedValue(false),
}));
// tenants.js also pulls the tenant-save/email chain; the G22 ops never
// touch it, so stub those modules instead of importing the Supabase client.
vi.mock("@/domains/rental-tenant", () => ({ createRentalTenant: vi.fn() }));
vi.mock("@/infrastructure/notifications/ResendRentalEmailProvider", () => ({ createResendRentalEmailProvider: vi.fn() }));
vi.mock("@/domains/rental-tenant/tenantInviteEmail", () => ({
  buildTenantInviteEmail: vi.fn(), buildTenantInviteIdempotencyKey: vi.fn(), fingerprintString: vi.fn(),
}));

import { readOnlyWriteBlocked } from "./shared.js";
import { createAnimal, revokeAnimal, reviewAnimal } from "./tenants.js";
import { recordInsuranceProof, updateInsuranceProof, reopenInsurancePolicy } from "./insurance.js";

// Controls-sweep follow-up G22 (O-12, O-13): landlord animal + insurance paths.
const AUTH = (client) => ({ user: { id: "user_1" }, supabaseClient: client });
const ACTIVE_LEASE = { id: "lease_1", status: "active" };
const MEMBERS = [
  { tenant_id: "tenant_co", occupancy_role: "co_tenant" },
  { tenant_id: "tenant_primary", occupancy_role: "primary" },
];

function makeClient({ lease = ACTIVE_LEASE, members = MEMBERS, animalLoad = null, animalUpdated = null,
  policyLoad = null, policyUpdated = null, feeError = null, rpcResult = null } = {}) {
  const calls = [];
  let animalCalls = 0;
  let policyCalls = 0;
  const chain = (table) => {
    const c = {
      select() { return c; },
      eq() { return c; },
      insert(payload) { calls.push({ table, op: "insert", payload }); return c; },
      update(payload) { calls.push({ table, op: "update", payload }); return c; },
      async maybeSingle() {
        if (table === "rental_leases") return { data: lease, error: null };
        if (table === "rental_animals") {
          animalCalls += 1;
          return { data: animalCalls === 1 ? animalLoad : (animalUpdated ?? animalLoad), error: null };
        }
        if (table === "renters_insurance_policies") {
          policyCalls += 1;
          return { data: policyCalls === 1 ? policyLoad : (policyUpdated ?? policyLoad), error: null };
        }
        return { data: null, error: null };
      },
      async single() { return { data: { id: "new_1" }, error: null }; },
      then(resolve) {
        if (table === "rental_lease_tenants") resolve({ data: members, error: null });
        else if (table === "monthly_pet_fees") resolve({ data: null, error: feeError });
        else resolve({ data: null, error: null });
      },
    };
    return c;
  };
  return {
    calls,
    from: (table) => chain(table),
    rpc: async (name, params) => {
      calls.push({ rpc: name, params });
      return rpcResult ?? { data: { ok: true }, error: null };
    },
  };
}

describe("G22 animal ops", () => {
  beforeEach(() => { vi.clearAllMocks(); readOnlyWriteBlocked.mockResolvedValue(false); });

  it("O-12: landlord create lands as a requested dog against the primary tenant", async () => {
    const client = makeClient({});
    const res = await createAnimal({ authenticated: AUTH(client), effectiveOwnerId: "owner_1",
      body: { animal: { leaseId: "lease_1", name: "Rex", breedDescription: "Lab mix", requestType: "pet" } } });
    expect(res.status).toBe(200);
    const insert = client.calls.find((c) => c.table === "rental_animals" && c.op === "insert");
    expect(insert.payload.species).toBe("dog");
    expect(insert.payload.approval_status).toBe("requested");
    expect(insert.payload.tenant_id).toBe("tenant_primary");
  });

  it("O-12: create 409s on a non-active lease and 400s on a missing name", async () => {
    const cancelled = makeClient({ lease: { id: "lease_1", status: "cancelled" } });
    const res1 = await createAnimal({ authenticated: AUTH(cancelled), effectiveOwnerId: "owner_1",
      body: { animal: { leaseId: "lease_1", name: "Rex", breedDescription: "Lab", requestType: "pet" } } });
    expect(res1.status).toBe(409);
    const client = makeClient({});
    const res2 = await createAnimal({ authenticated: AUTH(client), effectiveOwnerId: "owner_1",
      body: { animal: { leaseId: "lease_1", name: " ", breedDescription: "Lab", requestType: "pet" } } });
    expect(res2.status).toBe(400);
  });

  it("O-12: create 409s when the lease has no tenants", async () => {
    const client = makeClient({ members: [] });
    const res = await createAnimal({ authenticated: AUTH(client), effectiveOwnerId: "owner_1",
      body: { animal: { leaseId: "lease_1", name: "Rex", breedDescription: "Lab", requestType: "pet" } } });
    expect(res.status).toBe(409);
  });

  it("O-12: revoke ends the fee before denying, and 409s when not approved", async () => {
    const client = makeClient({
      animalLoad: { id: "animal_1", approval_status: "approved" },
      animalUpdated: { id: "animal_1", approval_status: "denied" },
    });
    const res = await revokeAnimal({ authenticated: AUTH(client), effectiveOwnerId: "owner_1", body: { animalId: "animal_1" } });
    expect(res.status).toBe(200);
    const feeIdx = client.calls.findIndex((c) => c.table === "monthly_pet_fees");
    const denyIdx = client.calls.findIndex((c) => c.table === "rental_animals" && c.op === "update");
    expect(feeIdx).toBeGreaterThan(-1);
    expect(denyIdx).toBeGreaterThan(feeIdx);
    expect(client.calls[denyIdx].payload.approval_status).toBe("denied");
    expect(client.calls[denyIdx].payload.approved_at).toBeNull();
    expect(client.calls[feeIdx].payload.status).toBe("ended");

    const denied = makeClient({ animalLoad: { id: "animal_1", approval_status: "denied" } });
    const res2 = await revokeAnimal({ authenticated: AUTH(denied), effectiveOwnerId: "owner_1", body: { animalId: "animal_1" } });
    expect(res2.status).toBe(409);
  });

  it("O-12: revoke aborts before the denial when the fee-end fails", async () => {
    const client = makeClient({
      animalLoad: { id: "animal_1", approval_status: "approved" },
      feeError: { message: "fee update failed" },
    });
    await expect(revokeAnimal({ authenticated: AUTH(client), effectiveOwnerId: "owner_1", body: { animalId: "animal_1" } }))
      .rejects.toMatchObject({ message: "fee update failed" });
    expect(client.calls.some((c) => c.table === "rental_animals" && c.op === "update")).toBe(false);
  });

  it("O-12: re-deny through review ends the fee; approve does not touch fees", async () => {
    const denied = makeClient({});
    await reviewAnimal({ authenticated: AUTH(denied), effectiveOwnerId: "owner_1",
      body: { animalId: "animal_1", decision: "denied", classification: "pet", approvalEvidenceId: "ev_1" } });
    expect(denied.calls.some((c) => c.table === "monthly_pet_fees" && c.op === "update")).toBe(true);

    const approved = makeClient({});
    await reviewAnimal({ authenticated: AUTH(approved), effectiveOwnerId: "owner_1",
      body: { animalId: "animal_1", decision: "approved", classification: "pet", approvalEvidenceId: "ev_1", monthlyFeeCents: 5000, effectiveStartDate: "2026-11-01" } });
    expect(approved.calls.some((c) => c.table === "monthly_pet_fees")).toBe(false);
  });

  it("O-12: read-only members cannot create or revoke", async () => {
    readOnlyWriteBlocked.mockResolvedValue(true);
    const client = makeClient({});
    const res = await createAnimal({ authenticated: AUTH(client), effectiveOwnerId: "owner_1",
      body: { animal: { leaseId: "lease_1", name: "Rex", breedDescription: "Lab", requestType: "pet" } } });
    expect(res.status).toBe(403);
    const res2 = await revokeAnimal({ authenticated: AUTH(client), effectiveOwnerId: "owner_1", body: { animalId: "animal_1" } });
    expect(res2.status).toBe(403);
  });
});

describe("G22 insurance ops", () => {
  beforeEach(() => { vi.clearAllMocks(); readOnlyWriteBlocked.mockResolvedValue(false); });
  const PROOF = { leaseId: "lease_1", carrierName: "Acme", policyNumberMasked: "POL-1",
    liabilityLimitCents: 100000, effectiveDate: "2026-11-01", expirationDate: "2027-11-01", evidenceReference: "file drawer A" };

  it("O-13: paper proof lands pending_verification with the evidence reference", async () => {
    const client = makeClient({});
    const res = await recordInsuranceProof({ authenticated: AUTH(client), effectiveOwnerId: "owner_1", body: { policy: PROOF } });
    expect(res.status).toBe(200);
    const insert = client.calls.find((c) => c.table === "renters_insurance_policies" && c.op === "insert");
    expect(insert.payload.status).toBe("pending_verification");
    expect(insert.payload.evidence_id).toBe("file drawer A");
    expect(insert.payload.tenant_id).toBe("tenant_primary");
  });

  it("O-13: record 400s when expiration precedes effective, and 409s on a cancelled lease", async () => {
    const client = makeClient({});
    const res = await recordInsuranceProof({ authenticated: AUTH(client), effectiveOwnerId: "owner_1",
      body: { policy: { ...PROOF, expirationDate: "2026-10-01" } } });
    expect(res.status).toBe(400);
    const cancelled = makeClient({ lease: { id: "lease_1", status: "cancelled" } });
    const res2 = await recordInsuranceProof({ authenticated: AUTH(cancelled), effectiveOwnerId: "owner_1", body: { policy: PROOF } });
    expect(res2.status).toBe(409);
  });

  it("O-13: edit refuses a decided policy but allows a pending one", async () => {
    const decided = makeClient({ policyLoad: { id: "pol_1", status: "verified" } });
    const res = await updateInsuranceProof({ authenticated: AUTH(decided), effectiveOwnerId: "owner_1",
      body: { policy: { id: "pol_1", ...PROOF } } });
    expect(res.status).toBe(409);
    const pending = makeClient({
      policyLoad: { id: "pol_1", status: "pending_verification" },
      policyUpdated: { id: "pol_1", status: "pending_verification" },
    });
    const res2 = await updateInsuranceProof({ authenticated: AUTH(pending), effectiveOwnerId: "owner_1",
      body: { policy: { id: "pol_1", ...PROOF } } });
    expect(res2.status).toBe(200);
  });

  it("O-13: reopen moves rejected and verified-expired to pending, refuses in-force and pending", async () => {
    const rejected = makeClient({
      policyLoad: { id: "pol_1", status: "rejected", expiration_date: "2027-11-01" },
      policyUpdated: { id: "pol_1", status: "pending_verification" },
    });
    const res = await reopenInsurancePolicy({ authenticated: AUTH(rejected), effectiveOwnerId: "owner_1",
      body: { policyId: "pol_1" }, timestamp: "2026-11-01T00:00:00Z" });
    expect(res.status).toBe(200);
    const update = rejected.calls.find((c) => c.table === "renters_insurance_policies" && c.op === "update");
    expect(update.payload.status).toBe("pending_verification");
    expect(update.payload.verified_at).toBeNull();

    const expiredVerified = makeClient({
      policyLoad: { id: "pol_1", status: "verified", expiration_date: "2026-10-01" },
      policyUpdated: { id: "pol_1", status: "pending_verification" },
    });
    const res2 = await reopenInsurancePolicy({ authenticated: AUTH(expiredVerified), effectiveOwnerId: "owner_1",
      body: { policyId: "pol_1" }, timestamp: "2026-11-01T00:00:00Z" });
    expect(res2.status).toBe(200);

    const inForce = makeClient({ policyLoad: { id: "pol_1", status: "verified", expiration_date: "2027-11-01" } });
    const res3 = await reopenInsurancePolicy({ authenticated: AUTH(inForce), effectiveOwnerId: "owner_1",
      body: { policyId: "pol_1" }, timestamp: "2026-11-01T00:00:00Z" });
    expect(res3.status).toBe(409);

    const pending = makeClient({ policyLoad: { id: "pol_1", status: "pending_verification", expiration_date: "2027-11-01" } });
    const res4 = await reopenInsurancePolicy({ authenticated: AUTH(pending), effectiveOwnerId: "owner_1",
      body: { policyId: "pol_1" }, timestamp: "2026-11-01T00:00:00Z" });
    expect(res4.status).toBe(409);
  });
});
