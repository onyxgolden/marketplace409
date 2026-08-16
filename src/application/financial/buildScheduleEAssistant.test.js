import{describe,expect,it}from"vitest";import{buildScheduleEAssistant,scheduleEAssistantToCsv}from"./buildScheduleEAssistant.js";
const events=[
  {id:"a",event_date:"2026-01-01",amount:1420,transaction_kind:"income",normalized_category:"rental_income",property_id:"kent"},
  {id:"b",event_date:"2026-01-04",amount:120,transaction_kind:"expense",normalized_category:"utilities",property_id:"kent"},
  {id:"c",event_date:"2026-01-06",amount:2326.91,transaction_kind:"expense",normalized_category:"property_tax",property_id:"kent"},
  {id:"d",event_date:"2025-12-31",amount:500,transaction_kind:"expense",normalized_category:"utilities",property_id:"kent"},
  {id:"e",event_date:"2026-01-05",amount:112500,transaction_kind:"asset_purchase",normalized_category:"real_estate_purchase",property_id:"kent"},
  {id:"f",event_date:"2026-01-07",amount:75,transaction_kind:"expense",normalized_category:"some_unmapped_thing",property_id:"kent"},
];
describe("schedule-E assistant",()=>{
  it("maps known categories to Schedule E lines and only includes the requested tax year",()=>{const report=buildScheduleEAssistant({events},{taxYear:2026});
    expect(report.lines.find(l=>l.line==="3")).toMatchObject({label:"Rents received",amountCents:1420});
    expect(report.lines.find(l=>l.line==="17")).toMatchObject({label:"Utilities",amountCents:-120});
    expect(report.lines.find(l=>l.label==="Taxes")).toMatchObject({amountCents:-2326.91});
    expect(report.lines.some(l=>l.categories.includes("real_estate_purchase"))).toBe(false);});
  it("excludes prior-year transactions",()=>{const report=buildScheduleEAssistant({events},{taxYear:2026});const utilitiesLine=report.lines.find(l=>l.line==="17");expect(utilitiesLine.transactionCount).toBe(1);});
  it("buckets unmapped categories into line 19 Other and marks depreciation untracked",()=>{const report=buildScheduleEAssistant({events},{taxYear:2026});
    expect(report.lines.find(l=>l.line==="19")).toMatchObject({label:"Other",categories:["some_unmapped_thing"]});expect(report.summary.depreciationTracked).toBe(false);});
  it("summarizes total rents, expenses, and net income",()=>{const report=buildScheduleEAssistant({events},{taxYear:2026});
    expect(report.summary.totalRentsReceivedCents).toBe(1420);expect(report.summary.totalExpensesCents).toBeCloseTo(2521.91);});
  it("exports quoted CSV rows including the depreciation reminder",()=>{const csv=scheduleEAssistantToCsv(buildScheduleEAssistant({events},{taxYear:2026}));expect(csv).toContain('"Rents received"');expect(csv).toContain("Depreciation");});});
