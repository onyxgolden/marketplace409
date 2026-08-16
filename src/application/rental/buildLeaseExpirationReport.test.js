import{describe,expect,it}from"vitest";import{buildLeaseExpirationReport,leaseExpirationReportToCsv}from"./buildLeaseExpirationReport.js";
const input={units:[{id:"u1",label:"Main residence"}],tenants:[{id:"t1",display_name:"John Jones"}],
leases:[{id:"l1",property_id:"kent",unit_id:"u1",status:"active",end_date:"2026-09-10",monthly_rent_cents:200000},
  {id:"l2",property_id:"kent",unit_id:"u1",status:"active",end_date:"2027-06-01",monthly_rent_cents:200000},
  {id:"l3",property_id:"kent",unit_id:"u1",status:"ended",end_date:"2026-09-01",monthly_rent_cents:200000}],memberships:[{lease_id:"l1",tenant_id:"t1"}]};
describe("lease expiration report",()=>{
  it("includes only active leases ending inside the window, soonest first",()=>{const report=buildLeaseExpirationReport(input,"2026-08-16",60);
    expect(report.rows).toHaveLength(1);expect(report.rows[0]).toMatchObject({leaseId:"l1",tenantNames:["John Jones"],daysUntilExpiration:25});});
  it("counts already-expired active leases separately",()=>{const report=buildLeaseExpirationReport({...input,leases:[{...input.leases[0],end_date:"2026-08-01"}]},"2026-08-16",60);
    expect(report.summary).toMatchObject({expiringCount:1,alreadyExpiredCount:1});});
  it("exports quoted CSV rows",()=>{const csv=leaseExpirationReportToCsv(buildLeaseExpirationReport(input,"2026-08-16",60));expect(csv).toContain('"John Jones"');expect(csv).toContain('"2026-09-10"');});});
