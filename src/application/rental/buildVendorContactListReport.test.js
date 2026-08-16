import{describe,expect,it}from"vitest";import{buildVendorContactListReport,vendorContactListReportToCsv}from"./buildVendorContactListReport.js";
const input={contractors:[{id:"c1",business_name:"Gulf Coast Plumbing",contact_name:"Mike",email:"mike@gcplumb.com",phone:"555-2000",trade:"plumbing",status:"active",insurance_expiration:"2027-01-01",w9_status:"received"},
{id:"c2",business_name:"RPS Pest Management",status:"inactive",w9_status:"not_requested"}]};
describe("vendor contact list report",()=>{
  it("sorts vendors by business name",()=>{const report=buildVendorContactListReport(input);expect(report.rows.map(row=>row.businessName)).toEqual(["Gulf Coast Plumbing","RPS Pest Management"]);});
  it("summarizes vendor and active counts",()=>{const report=buildVendorContactListReport(input);expect(report.summary).toMatchObject({vendorCount:2,activeCount:1});});
  it("exports quoted CSV rows",()=>{const csv=vendorContactListReportToCsv(buildVendorContactListReport(input));expect(csv).toContain('"Gulf Coast Plumbing"');expect(csv).toContain('"mike@gcplumb.com"');});});
