import{describe,expect,it}from"vitest";import{buildSecurityDepositsReport,securityDepositsReportToCsv}from"./buildSecurityDepositsReport.js";
const input={units:[{id:"u1",label:"Main residence"}],tenants:[{id:"t1",display_name:"John Jones"}],
leases:[{id:"l1",property_id:"kent",unit_id:"u1"}],memberships:[{lease_id:"l1",tenant_id:"t1"}],
deposits:[{id:"d1",lease_id:"l1",tenant_id:"t1",status:"held",required_amount_cents:200000,jurisdiction_code:"TX",disposition_deadline:null}],
transactions:[{id:"tx1",deposit_id:"d1",transaction_type:"received",amount_cents:200000},{id:"tx2",deposit_id:"d1",transaction_type:"deduction",amount_cents:50000}]};
describe("security deposits report",()=>{
  it("computes the held balance from received/deduction/refund transactions",()=>{const report=buildSecurityDepositsReport(input);
    expect(report.rows[0]).toMatchObject({unitLabel:"Main residence",tenantNames:["John Jones"],requiredCents:200000,heldCents:150000,status:"held"});});
  it("summarizes required vs held totals",()=>{const report=buildSecurityDepositsReport(input);expect(report.summary).toMatchObject({depositCount:1,totalRequiredCents:200000,totalHeldCents:150000});});
  it("handles a deposit with no transactions yet",()=>{const report=buildSecurityDepositsReport({...input,transactions:[]});expect(report.rows[0].heldCents).toBe(0);});
  it("exports quoted CSV rows",()=>{const csv=securityDepositsReportToCsv(buildSecurityDepositsReport(input));expect(csv).toContain('"John Jones"');expect(csv).toContain('"1500.00"');});
  it("filters by property while still listing every property for the dropdown",()=>{const report=buildSecurityDepositsReport(input,{propertyId:"rachal"});expect(report.rows).toHaveLength(0);expect(report.availableProperties).toEqual(["kent"]);});});
