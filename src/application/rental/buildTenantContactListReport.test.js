import{describe,expect,it}from"vitest";import{buildTenantContactListReport,tenantContactListReportToCsv}from"./buildTenantContactListReport.js";
const input={units:[{id:"u1",label:"Main residence"}],
tenants:[{id:"t1",display_name:"John Jones",email:"jj@example.com",phone:"555-1000",status:"active"},{id:"t2",display_name:"Amy Adams",email:"amy@example.com",phone:"",status:"former"}],
leases:[{id:"l1",property_id:"kent",unit_id:"u1",status:"active"}],memberships:[{lease_id:"l1",tenant_id:"t1"}]};
describe("tenant contact list report",()=>{
  it("includes every tenant sorted by name, with current unit for active leases",()=>{const report=buildTenantContactListReport(input);
    expect(report.rows.map(row=>row.displayName)).toEqual(["Amy Adams","John Jones"]);
    expect(report.rows[1]).toMatchObject({unitLabel:"Main residence",propertyId:"kent",leaseStatus:"active"});
    expect(report.rows[0]).toMatchObject({unitLabel:"",leaseStatus:"none"});});
  it("summarizes tenant count",()=>{expect(buildTenantContactListReport(input).summary).toMatchObject({tenantCount:2});});
  it("exports quoted CSV rows",()=>{const csv=tenantContactListReportToCsv(buildTenantContactListReport(input));expect(csv).toContain('"John Jones"');expect(csv).toContain('"jj@example.com"');});});
