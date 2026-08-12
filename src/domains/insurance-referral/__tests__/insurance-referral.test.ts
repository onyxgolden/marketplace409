import { describe, expect, it } from "vitest"; import { createInsuranceReferralLink } from "../insurance-referral.types";
const link={id:"link_1",providerName:"Provider",product:"renters_insurance" as const,outboundUrl:"https://provider.test/shop",
  referralCompensationPossible:true,disclosureText:"FORGE may receive a referral fee.",active:true};
describe("insurance referral link",()=>{
  it("is an outbound disclosed referral only",()=>expect(createInsuranceReferralLink(link)).toMatchObject({referralCompensationPossible:true}));
  it("refuses insecure provider links",()=>expect(()=>createInsuranceReferralLink({...link,outboundUrl:"http://provider.test"})).toThrow("HTTPS"));
});
