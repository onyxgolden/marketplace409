import{describe,expect,it}from"vitest";import{buildIncomeExpenseStatement,incomeExpenseStatementToCsv}from"./buildIncomeExpenseStatement.js";
const events=[
  {id:"a",event_date:"2026-01-01",description:"George, Ashley",amount:1420,transaction_kind:"income",normalized_category:"rental_income",property_id:"4800-kent-ave",affects_noi:true},
  {id:"b",event_date:"2026-01-04",description:"STARLINK",amount:120,transaction_kind:"expense",normalized_category:"utilities",property_id:"4800-kent-ave",affects_noi:true},
  {id:"c",event_date:"2005-03-15",description:"Commissions (Purchase Price)",amount:112500,transaction_kind:"asset_purchase",normalized_category:"real_estate_purchase",property_id:"8760-old-hwy-90",affects_noi:false},
  {id:"d",event_date:"2026-01-02",description:"Voided",amount:500,transaction_kind:"expense",normalized_category:"utilities",property_id:"4800-kent-ave",status:"deleted",is_deleted:true},
];
describe("income & expense statement",()=>{
  it("totals income, expenses, net, and NOI while excluding capitalized asset purchases",()=>{const report=buildIncomeExpenseStatement({events});
    expect(report.summary).toMatchObject({income:1420,expenses:120,net:1300,noi:1300});});
  it("excludes deleted events",()=>{const report=buildIncomeExpenseStatement({events});expect(report.byCategory.find(row=>row.category==="real_estate_purchase")).toBeUndefined();});
  it("breaks totals down by category and by property",()=>{const report=buildIncomeExpenseStatement({events});
    expect(report.byCategory).toEqual(expect.arrayContaining([expect.objectContaining({category:"rental_income",income:1420}),expect.objectContaining({category:"utilities",expenses:120})]));
    expect(report.byProperty).toEqual([{propertyId:"4800-kent-ave",income:1420,expenses:120,net:1300,noi:1300}]);});
  it("filters by property and date range",()=>{const scoped=buildIncomeExpenseStatement({events},{propertyId:"4800-kent-ave"});expect(scoped.summary.income).toBe(1420);
    const ranged=buildIncomeExpenseStatement({events},{startDate:"2026-01-04",endDate:"2026-01-04"});expect(ranged.summary).toMatchObject({income:0,expenses:120});});
  it("lists available properties excluding asset-purchase-only scoping quirks",()=>{const report=buildIncomeExpenseStatement({events});expect(report.availableProperties).toEqual(["4800-kent-ave","8760-old-hwy-90"]);});
  it("exports quoted CSV rows",()=>{const csv=incomeExpenseStatementToCsv(buildIncomeExpenseStatement({events}));expect(csv).toContain('"utilities"');expect(csv).toContain('"1300.00"');});});
