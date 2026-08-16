import{describe,expect,it}from"vitest";import{buildVendorLedgerReport,vendorLedgerReportToCsv}from"./buildVendorLedgerReport.js";
const input={contractors:[{id:"c1",business_name:"Gulf Coast Plumbing"},{id:"c2",business_name:"RPS Pest Management"}],
contractorPayments:[
  {id:"p1",contractor_id:"c1",property_id:"kent",paid_at:"2026-02-09",amount_cents:72080,payment_method:"check",reference:"101",invoice_reference:"INV-1",work_order_id:"w1"},
  {id:"p2",contractor_id:"c2",property_id:"kent",paid_at:"2026-02-09",amount_cents:78481,payment_method:"check",reference:"102",invoice_reference:"INV-2",work_order_id:"w2"},
]};
describe("vendor ledger report",()=>{
  it("lists payments chronologically with the contractor name resolved",()=>{const report=buildVendorLedgerReport(input);
    expect(report.rows).toHaveLength(2);expect(report.rows[0]).toMatchObject({businessName:"Gulf Coast Plumbing",amountCents:72080});});
  it("filters by contractor and date range",()=>{const report=buildVendorLedgerReport(input,{contractorId:"c2"});expect(report.rows.map(row=>row.paymentId)).toEqual(["p2"]);});
  it("lists available contractors sorted by name",()=>{const report=buildVendorLedgerReport(input);expect(report.availableContractors.map(c=>c.businessName)).toEqual(["Gulf Coast Plumbing","RPS Pest Management"]);});
  it("summarizes payment count and total paid",()=>{const report=buildVendorLedgerReport(input);expect(report.summary).toMatchObject({paymentCount:2,totalPaidCents:150561});});
  it("exports quoted CSV rows",()=>{const csv=vendorLedgerReportToCsv(buildVendorLedgerReport(input));expect(csv).toContain('"Gulf Coast Plumbing"');expect(csv).toContain('"720.80"');});});
