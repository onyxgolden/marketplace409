import{describe,expect,it}from"vitest";import{buildRentersInsuranceComplianceReport,rentersInsuranceComplianceReportToCsv}from"./buildRentersInsuranceComplianceReport.js";
const input={units:[{id:"u1",label:"Main residence"},{id:"u2",label:"Rear unit"}],tenants:[{id:"t1",display_name:"John Jones"},{id:"t2",display_name:"Amy Adams"}],
leases:[{id:"l1",property_id:"kent",unit_id:"u1",status:"active"},{id:"l2",property_id:"rachal",unit_id:"u2",status:"active"},{id:"l3",property_id:"kent",unit_id:"u1",status:"ended"}],
memberships:[{lease_id:"l1",tenant_id:"t1"},{lease_id:"l2",tenant_id:"t2"}],
evidence:[{lease_id:"l1",created_at:"2026-06-01T00:00:00Z"},{lease_id:"l1",created_at:"2026-07-01T00:00:00Z"}]};
describe("renters insurance compliance report",()=>{
  it("flags active leases with no evidence on file",()=>{const report=buildRentersInsuranceComplianceReport(input);
    const missing=report.rows.find(row=>row.leaseId==="l2");expect(missing).toMatchObject({hasEvidence:false,evidenceCount:0,tenantNames:["Amy Adams"]});});
  it("counts evidence and surfaces the most recent upload for compliant leases",()=>{const report=buildRentersInsuranceComplianceReport(input);
    const compliant=report.rows.find(row=>row.leaseId==="l1");expect(compliant).toMatchObject({hasEvidence:true,evidenceCount:2,mostRecentUploadAt:"2026-07-01T00:00:00Z"});});
  it("only considers active leases",()=>{const report=buildRentersInsuranceComplianceReport(input);expect(report.rows.find(row=>row.leaseId==="l3")).toBeUndefined();});
  it("summarizes compliant vs missing counts",()=>{const report=buildRentersInsuranceComplianceReport(input);expect(report.summary).toMatchObject({activeLeaseCount:2,compliantCount:1,missingCount:1});});
  it("exports quoted CSV rows",()=>{const csv=rentersInsuranceComplianceReportToCsv(buildRentersInsuranceComplianceReport(input));expect(csv).toContain('"Amy Adams"');expect(csv).toContain('"No"');});
  it("filters by property while still listing every property for the dropdown",()=>{const report=buildRentersInsuranceComplianceReport(input,{propertyId:"kent"});expect(report.rows).toHaveLength(1);expect(report.availableProperties).toEqual(["kent","rachal"]);});});
