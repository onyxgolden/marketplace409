import{describe,expect,it}from"vitest";import{buildFinancialLedgerReport,financialLedgerReportToCsv}from"./buildFinancialLedgerReport.js";
const events=[
  {id:"a",event_date:"2026-01-01",description:"George, Ashley",amount:1420,transaction_kind:"income",normalized_category:"rental_income",property_id:"4800-kent-ave"},
  {id:"b",event_date:"2026-01-04",description:"STARLINK",amount:120,transaction_kind:"expense",normalized_category:"utilities",property_id:"business-expenses"},
  {id:"c",event_date:"2005-03-15",description:"Commissions (Purchase Price)",amount:112500,transaction_kind:"asset_purchase",normalized_category:"real_estate_purchase",property_id:"8760-old-hwy-90"},
  {id:"d",event_date:"2026-01-02",description:"Voided entry",amount:500,transaction_kind:"expense",normalized_category:"utilities",property_id:"4800-kent-ave",status:"deleted",is_deleted:true},
];
describe("financial ledger report",()=>{
  it("sorts chronologically and computes a running balance from transaction kind sign",()=>{const report=buildFinancialLedgerReport({events});
    expect(report.rows.map(row=>row.id)).toEqual(["c","a","b"]);
    expect(report.rows[0]).toMatchObject({debit:112500,credit:0,balance:-112500});
    expect(report.rows[1]).toMatchObject({debit:0,credit:1420,balance:-111080});
    expect(report.rows[2]).toMatchObject({debit:120,credit:0,balance:-111200});});
  it("excludes deleted and inactive events",()=>{const report=buildFinancialLedgerReport({events});expect(report.rows.find(row=>row.id==="d")).toBeUndefined();});
  it("filters by property and date range",()=>{const report=buildFinancialLedgerReport({events},{propertyId:"business-expenses"});expect(report.rows.map(row=>row.id)).toEqual(["b"]);
    const ranged=buildFinancialLedgerReport({events},{startDate:"2026-01-01",endDate:"2026-01-01"});expect(ranged.rows.map(row=>row.id)).toEqual(["a"]);});
  it("lists distinct properties across the full unfiltered dataset",()=>{const report=buildFinancialLedgerReport({events},{propertyId:"business-expenses"});
    expect(report.availableProperties).toEqual(["4800-kent-ave","8760-old-hwy-90","business-expenses"]);});
  it("summarizes totals and ending balance",()=>{const report=buildFinancialLedgerReport({events});expect(report.summary).toMatchObject({transactionCount:3,totalDebits:112620,totalCredits:1420,endingBalance:-111200});});
  it("exports quoted CSV rows",()=>{const csv=financialLedgerReportToCsv(buildFinancialLedgerReport({events}));expect(csv).toContain('"STARLINK"');expect(csv).toContain('"-111200.00"');});});
