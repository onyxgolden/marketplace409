import{describe,expect,it}from"vitest";import{buildUpcomingChargesReport,upcomingChargesReportToCsv}from"./buildUpcomingChargesReport.js";
const input={units:[{id:"u1",label:"Main residence"}],tenants:[{id:"t1",display_name:"John Jones"}],
leases:[{id:"l1",property_id:"kent",unit_id:"u1"}],memberships:[{lease_id:"l1",tenant_id:"t1"}],
charges:[{id:"c1",lease_id:"l1",status:"due",due_date:"2026-09-01",amount_cents:200000,paid_amount_cents:0},
  {id:"c2",lease_id:"l1",status:"scheduled",due_date:"2026-12-01",amount_cents:200000,paid_amount_cents:0},
  {id:"c3",lease_id:"l1",status:"paid",due_date:"2026-08-20",amount_cents:200000,paid_amount_cents:200000},
  {id:"c4",lease_id:"l1",status:"overdue",due_date:"2026-08-01",amount_cents:200000,paid_amount_cents:0}]};
describe("upcoming charges report",()=>{
  it("includes only unpaid future charges inside the window, soonest first",()=>{const report=buildUpcomingChargesReport(input,"2026-08-16",30);
    expect(report.rows).toHaveLength(1);expect(report.rows[0]).toMatchObject({chargeId:"c1",unitLabel:"Main residence",tenantNames:["John Jones"],remainingCents:200000});});
  it("excludes already-overdue and paid charges",()=>{const report=buildUpcomingChargesReport(input,"2026-08-16",30);expect(report.rows.map(row=>row.chargeId)).not.toContain("c3");expect(report.rows.map(row=>row.chargeId)).not.toContain("c4");});
  it("summarizes upcoming count and total due",()=>{const report=buildUpcomingChargesReport(input,"2026-08-16",30);expect(report.summary).toMatchObject({upcomingCount:1,totalDueCents:200000});});
  it("exports quoted CSV rows",()=>{const csv=upcomingChargesReportToCsv(buildUpcomingChargesReport(input,"2026-08-16",30));expect(csv).toContain('"John Jones"');expect(csv).toContain('"2000.00"');});});
