import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { buildRentalOperatingReport, rentalReportToCsv } from "@/application/rental/buildRentalOperatingReport";
import { buildRentalTaxPackage, rentalTaxPackageToCsv } from "@/application/rental/buildRentalTaxPackage";
import { buildDelinquentTenantsReport, delinquentTenantsReportToCsv } from "@/application/rental/buildDelinquentTenantsReport";
import { buildLeaseExpirationReport, leaseExpirationReportToCsv } from "@/application/rental/buildLeaseExpirationReport";
import { buildVacantUnitsReport, vacantUnitsReportToCsv } from "@/application/rental/buildVacantUnitsReport";
import { buildTenantContactListReport, tenantContactListReportToCsv } from "@/application/rental/buildTenantContactListReport";
import { buildUpcomingChargesReport, upcomingChargesReportToCsv } from "@/application/rental/buildUpcomingChargesReport";
import { buildFinancialLedgerReport, financialLedgerReportToCsv } from "@/application/financial/buildFinancialLedgerReport";
import { buildIncomeExpenseStatement, incomeExpenseStatementToCsv } from "@/application/financial/buildIncomeExpenseStatement";
import { buildScheduleEAssistant, scheduleEAssistantToCsv } from "@/application/financial/buildScheduleEAssistant";
import { buildSecurityDepositsReport, securityDepositsReportToCsv } from "@/application/rental/buildSecurityDepositsReport";
import { buildRentersInsuranceComplianceReport, rentersInsuranceComplianceReportToCsv } from "@/application/rental/buildRentersInsuranceComplianceReport";
import { buildWorkOrdersReport, workOrdersReportToCsv } from "@/application/rental/buildWorkOrdersReport";
import { buildVendorContactListReport, vendorContactListReportToCsv } from "@/application/rental/buildVendorContactListReport";
import { buildVendorLedgerReport, vendorLedgerReportToCsv } from "@/application/rental/buildVendorLedgerReport";
import { scopeRentalDataToProperty } from "@/application/rental/scopeRentalDataToProperty";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { fetchAllOwnerFinancialEvents } from "@/domains/rentec-financial-history-import/fetchAllOwnerFinancialEvents";

// rent_schedules is required by every core report that classifies a charge's collection authority
// (buildRentalOperatingReport, buildDelinquentTenantsReport) — without it, those builders have no
// evidence to distinguish a FORGE-collectible charge from an externally-managed one and must fail
// safe to "externally managed," which would silently zero out every FORGE total.
const CORE_RENTAL_TABLES = ["rental_units", "rental_tenants", "rental_leases", "rental_lease_tenants", "rent_charges", "rental_payments", "rent_schedules"];
const CORE_RENTAL_KEYS = {
  rental_units: "units",
  rental_tenants: "tenants",
  rental_leases: "leases",
  rental_lease_tenants: "memberships",
  rent_charges: "charges",
  rental_payments: "payments",
  rent_schedules: "schedules",
};

async function fetchTables(supabaseClient, tables, columns = {}) {
  const results = await Promise.all(tables.map((table) => supabaseClient.from(table).select(columns[table] || "*")));
  const error = results.find((r) => r.error)?.error;
  if (error) throw error;
  return Object.fromEntries(tables.map((table, index) => [table, results[index].data || []]));
}

function csvResponse(csvText, filenameBase, dateHint) {
  return new Response(csvText, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="forge-${filenameBase}-${dateHint}.csv"`,
    },
  });
}

const CORE_REPORT_BUILDERS = {
  "": { build: (data, url) => buildRentalOperatingReport(data, url.searchParams.get("asOfDate") || undefined), toCsv: rentalReportToCsv, filename: "rental-rent-roll" },
  "delinquent-tenants": { build: (data, url) => buildDelinquentTenantsReport(data, url.searchParams.get("asOfDate") || undefined), toCsv: delinquentTenantsReportToCsv, filename: "rental-delinquent-tenants" },
  "lease-expiration": { build: (data, url) => buildLeaseExpirationReport(data, { startDate: url.searchParams.get("startDate") || undefined, endDate: url.searchParams.get("endDate") || undefined }), toCsv: leaseExpirationReportToCsv, filename: "rental-lease-expiration" },
  "vacant-units": { build: (data, url) => buildVacantUnitsReport(data, url.searchParams.get("asOfDate") || undefined), toCsv: vacantUnitsReportToCsv, filename: "rental-vacant-units" },
  "tenant-contacts": { build: (data) => buildTenantContactListReport(data), toCsv: tenantContactListReportToCsv, filename: "rental-tenant-contacts" },
  "upcoming-charges": { build: (data, url) => buildUpcomingChargesReport(data, { startDate: url.searchParams.get("startDate") || undefined, endDate: url.searchParams.get("endDate") || undefined }), toCsv: upcomingChargesReportToCsv, filename: "rental-upcoming-charges" },
};

// Operational reports (rent roll, delinquency, upcoming charges) must never count a preserved
// sandbox payment as live rent, and must never hide a real 'offline'/manual payment (which has no
// Stripe mode at all) just because the server happens to be running in live mode.
export function excludeOffModeStripePayments(payments, currentMode) {
  return payments.filter((payment) => payment.provider !== "stripe" || payment.provider_mode === currentMode);
}

async function loadCoreReport(a, url, reportKey) {
  const builder = CORE_REPORT_BUILDERS[reportKey];
  const raw = await fetchTables(a.supabaseClient, CORE_RENTAL_TABLES);
  raw.rental_payments = excludeOffModeStripePayments(raw.rental_payments, createStripeBillingProvider().mode);
  const data = Object.fromEntries(CORE_RENTAL_TABLES.map((table) => [CORE_RENTAL_KEYS[table], raw[table]]));
  const availableProperties = Object.freeze([...new Set(data.units.map((unit) => unit.property_id))].filter(Boolean).sort());
  const scoped = scopeRentalDataToProperty(data, url.searchParams.get("propertyId") || "");
  const report = { ...builder.build(scoped, url), availableProperties };
  return { report, toCsv: () => builder.toCsv(report), filename: builder.filename, dateHint: report.asOfDate || report.startDate || report.generatedAt.slice(0, 10) };
}

// account-ledger, income-expense-statement, and schedule-e-assistant are all business/tax
// dashboards — personal Simplifi transactions (business_scope='personal') must never appear in
// any of them, so the exclusion is applied once here rather than in each report builder.
//
// Paginated via fetchAllOwnerFinancialEvents — a plain unbounded .select() is silently capped by
// PostgREST's default page size (1000 rows), which for an owner with more financial_events
// history than that (this owner has 11,000+) truncated to an arbitrary 1000 rows, making a
// freshly-recorded property (e.g. via the Financial setup workflow) invisible to every report
// here even though the underlying financial_events rows existed and were correct.
async function loadFinancialEvents(a) {
  const events = await fetchAllOwnerFinancialEvents(a.supabaseClient, a.user.id, {
    columns: "id,event_date,description,amount,transaction_kind,normalized_category,property_id,status,is_deleted,business_scope",
  });
  return events.filter((event) => event.business_scope !== "personal");
}

const FINANCIAL_EVENT_HANDLERS = {
  "account-ledger": {
    load: async (a, url) => {
      const events = await loadFinancialEvents(a);
      const report = buildFinancialLedgerReport({ events }, { propertyId: url.searchParams.get("propertyId") || "", startDate: url.searchParams.get("startDate") || "", endDate: url.searchParams.get("endDate") || "" });
      return { report, toCsv: () => financialLedgerReportToCsv(report), filename: "account-ledger", dateHint: report.generatedAt.slice(0, 10) };
    },
  },
  "income-expense-statement": {
    load: async (a, url) => {
      const events = await loadFinancialEvents(a);
      const report = buildIncomeExpenseStatement({ events }, { propertyId: url.searchParams.get("propertyId") || "", startDate: url.searchParams.get("startDate") || "", endDate: url.searchParams.get("endDate") || "" });
      return { report, toCsv: () => incomeExpenseStatementToCsv(report), filename: "income-expense-statement", dateHint: report.generatedAt.slice(0, 10) };
    },
  },
  "schedule-e-assistant": {
    load: async (a, url) => {
      const taxYear = Number(url.searchParams.get("taxYear"));
      if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100) throw Object.assign(new Error("A valid tax year is required."), { status: 400 });
      const events = await loadFinancialEvents(a);
      const report = buildScheduleEAssistant({ events }, { taxYear, propertyId: url.searchParams.get("propertyId") || "" });
      return { report, toCsv: () => scheduleEAssistantToCsv(report), filename: `schedule-e-${taxYear}`, dateHint: String(taxYear) };
    },
  },
};

const REPORT_HANDLERS = {
  ...FINANCIAL_EVENT_HANDLERS,
  "security-deposits": {
    load: async (a, url) => {
      const raw = await fetchTables(a.supabaseClient, [...CORE_RENTAL_TABLES, "rental_security_deposits", "rental_security_deposit_transactions"]);
      const report = buildSecurityDepositsReport({
        units: raw.rental_units, tenants: raw.rental_tenants, leases: raw.rental_leases, memberships: raw.rental_lease_tenants,
        deposits: raw.rental_security_deposits, transactions: raw.rental_security_deposit_transactions,
      }, { propertyId: url.searchParams.get("propertyId") || "" });
      return { report, toCsv: () => securityDepositsReportToCsv(report), filename: "security-deposits", dateHint: report.generatedAt.slice(0, 10) };
    },
  },
  "renters-insurance": {
    load: async (a, url) => {
      const raw = await fetchTables(a.supabaseClient, [...CORE_RENTAL_TABLES, "renters_insurance_evidence"]);
      const report = buildRentersInsuranceComplianceReport({
        units: raw.rental_units, tenants: raw.rental_tenants, leases: raw.rental_leases, memberships: raw.rental_lease_tenants,
        evidence: raw.renters_insurance_evidence,
      }, { propertyId: url.searchParams.get("propertyId") || "" });
      return { report, toCsv: () => rentersInsuranceComplianceReportToCsv(report), filename: "renters-insurance", dateHint: report.generatedAt.slice(0, 10) };
    },
  },
  "work-orders": {
    load: async (a, url) => {
      const raw = await fetchTables(a.supabaseClient, ["rental_units", "rental_maintenance_requests", "rental_maintenance_work_orders", "rental_contractors"]);
      const report = buildWorkOrdersReport({ units: raw.rental_units, requests: raw.rental_maintenance_requests, workOrders: raw.rental_maintenance_work_orders, contractors: raw.rental_contractors }, { propertyId: url.searchParams.get("propertyId") || "" });
      return { report, toCsv: () => workOrdersReportToCsv(report), filename: "work-orders", dateHint: report.generatedAt.slice(0, 10) };
    },
  },
  "vendor-contacts": {
    load: async (a) => {
      const raw = await fetchTables(a.supabaseClient, ["rental_contractors"]);
      const report = buildVendorContactListReport({ contractors: raw.rental_contractors });
      return { report, toCsv: () => vendorContactListReportToCsv(report), filename: "vendor-contacts", dateHint: report.generatedAt.slice(0, 10) };
    },
  },
  "vendor-ledger": {
    load: async (a, url) => {
      const raw = await fetchTables(a.supabaseClient, ["rental_contractors", "rental_contractor_payments"]);
      const report = buildVendorLedgerReport({ contractors: raw.rental_contractors, contractorPayments: raw.rental_contractor_payments }, {
        contractorId: url.searchParams.get("contractorId") || "", startDate: url.searchParams.get("startDate") || "", endDate: url.searchParams.get("endDate") || "",
      });
      return { report, toCsv: () => vendorLedgerReportToCsv(report), filename: "vendor-ledger", dateHint: report.generatedAt.slice(0, 10) };
    },
  },
};

export async function GET(request) {
  try {
    const a = await createAuthenticatedForgeApplication();
    if (a.response) return a.response;
    const url = new URL(request.url);

    if (url.searchParams.get("format") === "tax-csv") {
      const taxYear = Number(url.searchParams.get("taxYear"));
      if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100) return NextResponse.json({ error: "A valid tax year is required." }, { status: 400 });
      const raw = await fetchTables(a.supabaseClient, ["rental_contractors", "rental_contractor_payments", "rental_1099_reviews"]);
      const report = buildRentalTaxPackage({ contractors: raw.rental_contractors, contractorPayments: raw.rental_contractor_payments, reviews: raw.rental_1099_reviews }, taxYear, url.searchParams.get("propertyId") || "");
      return csvResponse(rentalTaxPackageToCsv(report), "rental-contractor-tax", taxYear);
    }

    const reportKey = url.searchParams.get("report") || "";
    let loaded;
    if (REPORT_HANDLERS[reportKey]) {
      loaded = await REPORT_HANDLERS[reportKey].load(a, url);
    } else if (reportKey in CORE_REPORT_BUILDERS) {
      loaded = await loadCoreReport(a, url, reportKey);
    } else {
      return NextResponse.json({ error: "Unknown report." }, { status: 400 });
    }

    if (url.searchParams.get("format") === "csv") return csvResponse(loaded.toCsv(), loaded.filename, loaded.dateHint);
    return NextResponse.json({ success: true, report: loaded.report });
  } catch (error) {
    if (error?.status === 400) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Rental report error", error);
    return NextResponse.json({ error: "Unable to build rental reports." }, { status: 500 });
  }
}
