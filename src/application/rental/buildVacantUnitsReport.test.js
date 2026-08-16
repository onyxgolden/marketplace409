import{describe,expect,it}from"vitest";import{buildVacantUnitsReport,vacantUnitsReportToCsv}from"./buildVacantUnitsReport.js";
const input={units:[{id:"u1",label:"Main residence",status:"occupied",available_at:null},{id:"u2",label:"Rear unit",status:"available",available_at:"2026-08-01",bedrooms:1,bathrooms:1,square_feet:600},{id:"u3",label:"Shed",status:"inactive",available_at:null}],
leases:[{id:"l1",unit_id:"u1",status:"active"}]};
describe("vacant units report",()=>{
  it("excludes occupied and inactive units",()=>{const report=buildVacantUnitsReport(input,"2026-08-16");expect(report.rows).toHaveLength(1);expect(report.rows[0]).toMatchObject({unitId:"u2",daysVacant:15});});
  it("summarizes vacant count against total unit count",()=>{const report=buildVacantUnitsReport(input,"2026-08-16");expect(report.summary).toMatchObject({vacantUnitCount:1,totalUnitCount:3});});
  it("exports quoted CSV rows",()=>{const csv=vacantUnitsReportToCsv(buildVacantUnitsReport(input,"2026-08-16"));expect(csv).toContain('"Rear unit"');expect(csv).toContain('"available"');});});
