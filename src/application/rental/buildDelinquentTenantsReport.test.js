import{describe,expect,it}from"vitest";import{buildDelinquentTenantsReport,delinquentTenantsReportToCsv}from"./buildDelinquentTenantsReport.js";
const input={units:[{id:"u1",label:"Main residence"}],tenants:[{id:"t1",display_name:"John Jones",email:"jj@example.com",phone:"555-1000"}],
leases:[{id:"l1",property_id:"kent",unit_id:"u1",status:"active",monthly_rent_cents:200000}],memberships:[{lease_id:"l1",tenant_id:"t1"}],
charges:[{lease_id:"l1",status:"overdue",due_date:"2026-07-01",amount_cents:200000,paid_amount_cents:50000},{lease_id:"l1",status:"paid",due_date:"2026-08-01",amount_cents:200000,paid_amount_cents:200000}]};
describe("delinquent tenants report",()=>{
  it("includes only leases with an overdue balance and totals it",()=>{const report=buildDelinquentTenantsReport(input,"2026-08-16");
    expect(report.summary).toMatchObject({delinquentLeaseCount:1,totalOverdueCents:150000});
    expect(report.rows[0]).toMatchObject({unitLabel:"Main residence",tenantNames:["John Jones"],tenantEmails:["jj@example.com"],overdueCents:150000,oldestDueDate:"2026-07-01"});});
  it("excludes leases with no overdue charges",()=>{const report=buildDelinquentTenantsReport({...input,charges:[input.charges[1]]},"2026-08-16");expect(report.rows).toHaveLength(0);});
  it("excludes void charges from overdue totals",()=>{const report=buildDelinquentTenantsReport({...input,charges:[{...input.charges[0],status:"void"}]},"2026-08-16");expect(report.summary.totalOverdueCents).toBe(0);});
  it("exports quoted CSV rows",()=>{const csv=delinquentTenantsReportToCsv(buildDelinquentTenantsReport(input,"2026-08-16"));expect(csv).toContain('"John Jones"');expect(csv).toContain('"1500.00"');});});
