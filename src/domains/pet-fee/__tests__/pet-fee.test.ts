import { describe, expect, it } from "vitest"; import { createMonthlyPetFee } from "../pet-fee.types";
const fee={id:"fee_1",animalId:"animal_1",leaseId:"lease_1",amountCents:2500,currencyCode:"usd",status:"active" as const,
  effectiveStartDate:"2026-09-01",effectiveEndDate:null,approvalEvidenceId:"approval_1",approvedAt:"2026-08-12T00:00:00Z"};
describe("monthly pet fee",()=>{
  it("belongs to one specifically approved animal",()=>expect(createMonthlyPetFee(fee)).toMatchObject({animalId:"animal_1",amountCents:2500,currencyCode:"USD"}));
  it("cannot exist without approval evidence",()=>expect(()=>createMonthlyPetFee({...fee,approvalEvidenceId:""})).toThrow("approvalEvidenceId"));
});
