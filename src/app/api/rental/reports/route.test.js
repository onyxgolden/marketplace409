import{beforeEach,describe,expect,it,vi}from"vitest";const from=vi.fn();
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication",()=>({createAuthenticatedForgeApplication:vi.fn(async()=>({user:{id:"owner_1"},supabaseClient:{from}}))}));
vi.mock("@/infrastructure/billing/StripeBillingProvider",()=>({createStripeBillingProvider:vi.fn(()=>({mode:"test"}))}));
import{GET}from"./route.js";
import{excludeOffModeStripePayments}from"./route.js";
const tables={
  rental_units:[{id:"u1",label:"Main",status:"occupied",property_id:"kent"},{id:"u2",label:"Second",status:"available",property_id:"rachal"}],
  rental_tenants:[{id:"t1",display_name:"John"},{id:"t2",display_name:"Jane"}],
  rental_leases:[{id:"l1",property_id:"kent",unit_id:"u1",status:"active",start_date:"2026-08-12",end_date:null,monthly_rent_cents:200000},{id:"l2",property_id:"rachal",unit_id:"u2",status:"active",start_date:"2026-08-12",end_date:"2026-09-01",monthly_rent_cents:150000}],
  rental_lease_tenants:[{lease_id:"l1",tenant_id:"t1"},{lease_id:"l2",tenant_id:"t2"}],
  rent_charges:[{lease_id:"l1",status:"overdue",due_date:"2026-08-01",amount_cents:200000,paid_amount_cents:0}],
  rental_payments:[],
  financial_events:[{id:"e1",event_date:"2026-01-01",description:"STARLINK",amount:120,transaction_kind:"expense",normalized_category:"utilities",property_id:"kent"}],
  rental_security_deposits:[{id:"d1",lease_id:"l1",tenant_id:"t1",status:"held",required_amount_cents:200000}],
  rental_security_deposit_transactions:[{id:"tx1",deposit_id:"d1",transaction_type:"received",amount_cents:200000}],
  renters_insurance_evidence:[{lease_id:"l1",created_at:"2026-06-01T00:00:00Z"}],
  rental_maintenance_requests:[{id:"r1",unit_id:"u1"}],
  rental_maintenance_work_orders:[{id:"w1",request_id:"r1",contractor_id:"c1",status:"in_progress",scope_of_work:"Fix leak",estimated_cost_cents:50000}],
  rental_contractors:[{id:"c1",business_name:"Gulf Coast Plumbing",status:"active",w9_status:"received"}],
  rental_contractor_payments:[{id:"p1",contractor_id:"c1",property_id:"kent",paid_at:"2026-02-09",amount_cents:72080}],
  rental_1099_reviews:[],
};
describe("rental reports route",()=>{beforeEach(()=>{vi.clearAllMocks();from.mockImplementation(table=>({select:vi.fn(async()=>({data:tables[table],error:null}))}));});
it("returns the owner rental operating report across all properties by default",async()=>{const response=await GET(new Request("https://example.test/api/rental/reports"));const body=await response.json();expect(response.status).toBe(200);expect(body.report.summary.activeLeases).toBe(2);expect(from).toHaveBeenCalledWith("rental_leases");});
it("exports the rent roll as a downloadable CSV",async()=>{const response=await GET(new Request("https://example.test/api/rental/reports?format=csv"));expect(response.headers.get("content-type")).toContain("text/csv");expect(response.headers.get("content-disposition")).toContain("forge-rental-rent-roll");expect(await response.text()).toContain('"Main"');});
it("returns the vacant units report by key",async()=>{const response=await GET(new Request("https://example.test/api/rental/reports?report=vacant-units"));const body=await response.json();expect(response.status).toBe(200);expect(body.report.summary).toMatchObject({vacantUnitCount:0,totalUnitCount:2});});
it("exports a named report as CSV",async()=>{const response=await GET(new Request("https://example.test/api/rental/reports?report=tenant-contacts&format=csv"));expect(response.headers.get("content-type")).toContain("text/csv");expect(response.headers.get("content-disposition")).toContain("forge-rental-tenant-contacts");expect(await response.text()).toContain('"John"');});
it("rejects an unknown report key",async()=>{const response=await GET(new Request("https://example.test/api/rental/reports?report=not-a-report"));expect(response.status).toBe(400);});
it("returns the account ledger report from financial_events instead of the rental tables",async()=>{const response=await GET(new Request("https://example.test/api/rental/reports?report=account-ledger"));const body=await response.json();expect(response.status).toBe(200);expect(body.report.summary).toMatchObject({transactionCount:1,totalDebits:120});expect(from).toHaveBeenCalledWith("financial_events");expect(from).not.toHaveBeenCalledWith("rental_units");});
it("exports the account ledger as CSV",async()=>{const response=await GET(new Request("https://example.test/api/rental/reports?report=account-ledger&format=csv"));expect(response.headers.get("content-type")).toContain("text/csv");expect(response.headers.get("content-disposition")).toContain("forge-account-ledger");expect(await response.text()).toContain('"STARLINK"');});
it("scopes a report to one property and lists every property for the filter dropdown",async()=>{const response=await GET(new Request("https://example.test/api/rental/reports?propertyId=kent"));const body=await response.json();expect(body.report.rentRoll).toHaveLength(1);expect(body.report.rentRoll[0].propertyId).toBe("kent");expect(body.report.availableProperties).toEqual(["kent","rachal"]);});
it("passes asOfDate through to point-in-time reports",async()=>{const before=await GET(new Request("https://example.test/api/rental/reports?report=delinquent-tenants&asOfDate=2026-07-01"));expect((await before.json()).report.summary.delinquentLeaseCount).toBe(0);const after=await GET(new Request("https://example.test/api/rental/reports?report=delinquent-tenants&asOfDate=2026-08-16"));expect((await after.json()).report.summary).toMatchObject({delinquentLeaseCount:1,totalOverdueCents:200000});});
it("passes an explicit start/end date range through to windowed reports",async()=>{const response=await GET(new Request("https://example.test/api/rental/reports?report=lease-expiration&startDate=2026-08-16&endDate=2026-08-20"));const body=await response.json();expect(body.report.rows).toHaveLength(0);const wider=await GET(new Request("https://example.test/api/rental/reports?report=lease-expiration&startDate=2026-08-16&endDate=2026-09-01"));expect((await wider.json()).report.rows.map(row=>row.leaseId)).toEqual(["l2"]);});
it("returns the income & expense statement from financial_events",async()=>{const response=await GET(new Request("https://example.test/api/rental/reports?report=income-expense-statement"));const body=await response.json();expect(response.status).toBe(200);expect(body.report.summary).toMatchObject({expenses:120});});
it("requires a valid tax year for schedule-e-assistant",async()=>{const response=await GET(new Request("https://example.test/api/rental/reports?report=schedule-e-assistant"));expect(response.status).toBe(400);});
it("returns the schedule-e assistant for a given tax year",async()=>{const response=await GET(new Request("https://example.test/api/rental/reports?report=schedule-e-assistant&taxYear=2026"));const body=await response.json();expect(response.status).toBe(200);expect(body.report.taxYear).toBe(2026);});
it("returns the security deposits report",async()=>{const response=await GET(new Request("https://example.test/api/rental/reports?report=security-deposits"));const body=await response.json();expect(response.status).toBe(200);expect(body.report.summary).toMatchObject({depositCount:1,totalHeldCents:200000});});
it("returns the renters insurance compliance report",async()=>{const response=await GET(new Request("https://example.test/api/rental/reports?report=renters-insurance"));const body=await response.json();expect(response.status).toBe(200);expect(body.report.summary).toMatchObject({compliantCount:1,missingCount:1});});
it("returns the work orders report",async()=>{const response=await GET(new Request("https://example.test/api/rental/reports?report=work-orders"));const body=await response.json();expect(response.status).toBe(200);expect(body.report.summary).toMatchObject({openCount:1,closedCount:0});expect(body.report.rows[0].contractorName).toBe("Gulf Coast Plumbing");});
it("returns the vendor contact list report",async()=>{const response=await GET(new Request("https://example.test/api/rental/reports?report=vendor-contacts"));const body=await response.json();expect(response.status).toBe(200);expect(body.report.rows[0]).toMatchObject({businessName:"Gulf Coast Plumbing"});});
it("returns the vendor ledger report",async()=>{const response=await GET(new Request("https://example.test/api/rental/reports?report=vendor-ledger"));const body=await response.json();expect(response.status).toBe(200);expect(body.report.summary).toMatchObject({paymentCount:1,totalPaidCents:72080});});
});

describe("rental operating report — mixed live/test/manual payments in one fixture",()=>{
  const mixedPayments=[
    {id:"pay_live",lease_id:"l1",provider:"stripe",provider_mode:"live",status:"succeeded",amount_cents:10000,refunded_amount_cents:0},
    {id:"pay_test",lease_id:"l1",provider:"stripe",provider_mode:"test",status:"succeeded",amount_cents:2000,refunded_amount_cents:0},
    {id:"pay_manual",lease_id:"l1",provider:"offline",status:"succeeded",amount_cents:5000,refunded_amount_cents:0},
  ];
  it("a live-mode server counts the live Stripe payment and the manual payment, but excludes the test Stripe payment, in collectedCents",async()=>{
    const {createStripeBillingProvider}=await import("@/infrastructure/billing/StripeBillingProvider");
    createStripeBillingProvider.mockReturnValueOnce({mode:"live"});
    from.mockImplementation(table=>({select:vi.fn(async()=>({data:table==="rental_payments"?mixedPayments:tables[table],error:null}))}));
    const response=await GET(new Request("https://example.test/api/rental/reports"));
    const body=await response.json();
    expect(response.status).toBe(200);
    expect(body.report.summary.collectedCents).toBe(15000); // live (10000) + manual (5000), never the test 2000
    const l1Row=body.report.rentRoll.find(r=>r.leaseId==="l1");
    expect(l1Row.collectedCents).toBe(15000);
  });
  it("a test-mode server counts only the test Stripe payment, never the live one", async()=>{
    const {createStripeBillingProvider}=await import("@/infrastructure/billing/StripeBillingProvider");
    createStripeBillingProvider.mockReturnValueOnce({mode:"test"});
    from.mockImplementation(table=>({select:vi.fn(async()=>({data:table==="rental_payments"?mixedPayments:tables[table],error:null}))}));
    const response=await GET(new Request("https://example.test/api/rental/reports"));
    const body=await response.json();
    expect(body.report.summary.collectedCents).toBe(7000); // test (2000) + manual (5000), never the live 10000
  });
  it("never removes the historical sandbox payment from the raw, unfiltered per-record list used by the audit/transaction views", async()=>{
    // /api/rental (the individual-transaction list powering RentalPaymentsPanel) is a
    // deliberately separate, unfiltered query — confirmed here only by contract, not by
    // re-testing that route: the reports route's own filtering must never touch rental_payments
    // in the database, only the in-memory copy it builds a report from.
    expect(excludeOffModeStripePayments(mixedPayments,"live").some(p=>p.id==="pay_test")).toBe(false);
    expect(mixedPayments.some(p=>p.id==="pay_test")).toBe(true); // the source array itself is untouched
  });
});

describe("excludeOffModeStripePayments",()=>{
  it("keeps a Stripe payment only when its provider_mode matches the server's current mode",()=>{
    const payments=[{id:"p1",provider:"stripe",provider_mode:"live"},{id:"p2",provider:"stripe",provider_mode:"test"}];
    expect(excludeOffModeStripePayments(payments,"live").map(p=>p.id)).toEqual(["p1"]);
    expect(excludeOffModeStripePayments(payments,"test").map(p=>p.id)).toEqual(["p2"]);
  });
  it("never excludes an offline/manual payment, regardless of server mode",()=>{
    const payments=[{id:"offline1",provider:"offline"},{id:"stripe_test",provider:"stripe",provider_mode:"test"}];
    expect(excludeOffModeStripePayments(payments,"live").map(p=>p.id)).toEqual(["offline1"]);
  });
});
