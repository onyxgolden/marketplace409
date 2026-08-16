import{describe,expect,it}from"vitest";import{scopeRentalDataToProperty}from"./scopeRentalDataToProperty.js";
const data={
  units:[{id:"u1",property_id:"kent"},{id:"u2",property_id:"rachal"}],
  tenants:[{id:"t1"},{id:"t2"}],
  leases:[{id:"l1",property_id:"kent",unit_id:"u1"},{id:"l2",property_id:"rachal",unit_id:"u2"}],
  memberships:[{lease_id:"l1",tenant_id:"t1"},{lease_id:"l2",tenant_id:"t2"}],
  charges:[{lease_id:"l1"},{lease_id:"l2"}],
  payments:[{lease_id:"l1"},{lease_id:"l2"}],
};
describe("scope rental data to property",()=>{
  it("returns everything unchanged when no property is given",()=>{expect(scopeRentalDataToProperty(data)).toEqual(data);});
  it("scopes every table down to the leases, tenants, and events for one property",()=>{const scoped=scopeRentalDataToProperty(data,"kent");
    expect(scoped.units.map(u=>u.id)).toEqual(["u1"]);expect(scoped.leases.map(l=>l.id)).toEqual(["l1"]);
    expect(scoped.tenants.map(t=>t.id)).toEqual(["t1"]);expect(scoped.memberships).toHaveLength(1);
    expect(scoped.charges).toHaveLength(1);expect(scoped.payments).toHaveLength(1);});
  it("excludes tenants who have no lease on the scoped property",()=>{const scoped=scopeRentalDataToProperty(data,"kent");expect(scoped.tenants.find(t=>t.id==="t2")).toBeUndefined();});
});
