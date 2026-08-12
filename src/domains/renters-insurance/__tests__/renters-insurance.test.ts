import { describe, expect, it } from "vitest"; import { createRentersInsurancePolicy } from "../renters-insurance.types";
const base = { id: "policy_1", tenantId: "tenant_1", leaseId: "lease_1", carrierName: "Carrier", policyNumberMasked: "***1234",
  liabilityLimitCents: 10000000, effectiveDate: "2026-09-01", expirationDate: "2027-09-01", status: "pending_verification" as const,
  verificationProvider: null, providerVerificationId: null, evidenceId: "evidence_1", verifiedAt: null, lastCheckedAt: null,
  createdAt: "2026-08-12T00:00:00Z", updatedAt: "2026-08-12T00:00:00Z" };
describe("renters insurance policy", () => {
  it("keeps policy numbers masked", () => { expect(createRentersInsurancePolicy(base).policyNumberMasked).toBe("***1234"); });
  it("requires evidence before marking coverage verified", () => {
    expect(() => createRentersInsurancePolicy({ ...base, status: "verified", evidenceId: null, verifiedAt: null })).toThrow("verification time and evidence");
  });
});
