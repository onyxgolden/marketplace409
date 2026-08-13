import { describe, expect, it } from "vitest";
import { filterRentalRecordsByContext, rentalContextLeaseIds } from "./filterRentalRecordsByContext.js";
const data={leases:[{id:"lease_1",unit_id:"unit_1"},{id:"lease_2",unit_id:"unit_2"}],leaseMemberships:[{lease_id:"lease_1",tenant_id:"tenant_1"},{lease_id:"lease_2",tenant_id:"tenant_2"}]};
describe("rental contextual record filtering",()=>{
  it("resolves leases for a selected unit or tenant",()=>{expect([...rentalContextLeaseIds(data,{recordType:"unit",recordId:"unit_1"})]).toEqual(["lease_1"]);expect([...rentalContextLeaseIds(data,{recordType:"tenant",recordId:"tenant_2"})]).toEqual(["lease_2"])});
  it("filters direct and lease-related records",()=>{const records=[{id:"one",lease_id:"lease_1",tenant_id:"tenant_1"},{id:"two",lease_id:"lease_2",tenant_id:"tenant_2"}];expect(filterRentalRecordsByContext(records,data,{recordType:"unit",recordId:"unit_1"}).map(item=>item.id)).toEqual(["one"]);expect(filterRentalRecordsByContext(records,data,{recordType:"tenant",recordId:"tenant_2"}).map(item=>item.id)).toEqual(["two"])});
  it("leaves unscoped pages unchanged",()=>{const records=[{id:"one"}];expect(filterRentalRecordsByContext(records,data,null)).toBe(records)});
});
