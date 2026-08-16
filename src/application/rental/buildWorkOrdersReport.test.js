import{describe,expect,it}from"vitest";import{buildWorkOrdersReport,workOrdersReportToCsv}from"./buildWorkOrdersReport.js";
const input={units:[{id:"u1",label:"Main residence",property_id:"kent"},{id:"u2",label:"Rear unit",property_id:"rachal"}],requests:[{id:"r1",unit_id:"u1"},{id:"r2",unit_id:"u2"}],
contractors:[{id:"c1",business_name:"Gulf Coast Plumbing"}],
workOrders:[
  {id:"w1",request_id:"r1",contractor_id:"c1",status:"in_progress",scope_of_work:"Fix leak",scheduled_start:"2026-08-20T00:00:00Z",estimated_cost_cents:50000,actual_cost_cents:null},
  {id:"w2",request_id:"r1",contractor_id:"c1",status:"completed",scope_of_work:"Replace filter",scheduled_start:"2026-07-01T00:00:00Z",estimated_cost_cents:10000,actual_cost_cents:12000,completed_at:"2026-07-02T00:00:00Z"},
  {id:"w3",request_id:"r2",contractor_id:"c1",status:"draft",scope_of_work:"Paint fence",scheduled_start:"2026-08-01T00:00:00Z",estimated_cost_cents:5000},
]};
describe("work orders report",()=>{
  it("classifies open vs closed status and sorts open first",()=>{const report=buildWorkOrdersReport(input);
    expect(report.rows.map(row=>row.workOrderId)).toEqual(["w1","w3","w2"]);expect(report.rows[0]).toMatchObject({isOpen:true,unitLabel:"Main residence",contractorName:"Gulf Coast Plumbing"});});
  it("summarizes open/closed counts and cost totals",()=>{const report=buildWorkOrdersReport(input);expect(report.summary).toMatchObject({openCount:2,closedCount:1,totalEstimatedCents:65000,totalActualCents:12000});});
  it("labels an unassigned contractor",()=>{const report=buildWorkOrdersReport({...input,workOrders:[{...input.workOrders[0],contractor_id:null}]});expect(report.rows[0].contractorName).toBe("Unassigned");});
  it("filters by property while still listing every property for the dropdown",()=>{const report=buildWorkOrdersReport(input,{propertyId:"rachal"});expect(report.rows.map(row=>row.workOrderId)).toEqual(["w3"]);expect(report.availableProperties).toEqual(["kent","rachal"]);});
  it("exports quoted CSV rows",()=>{const csv=workOrdersReportToCsv(buildWorkOrdersReport(input));expect(csv).toContain('"Gulf Coast Plumbing"');expect(csv).toContain('"120.00"');});});
