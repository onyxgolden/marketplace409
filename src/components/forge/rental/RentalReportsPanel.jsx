"use client";
import { useCallback, useEffect, useState } from "react";
import ManualFinancialEventForm from "@/components/forge/rental/ManualFinancialEventForm";
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const FAVORITES_STORAGE_KEY = "forge-rental-report-favorites";
const REPORTS = [
  { key: "", label: "Rent roll" },
  { key: "delinquent-tenants", label: "Delinquent tenants" },
  { key: "lease-expiration", label: "Lease expiration" },
  { key: "vacant-units", label: "Vacant units" },
  { key: "tenant-contacts", label: "Tenant contact list" },
  { key: "upcoming-charges", label: "Upcoming charges due" },
  { key: "account-ledger", label: "Account ledger" },
  { key: "income-expense-statement", label: "Income & expense statement" },
  { key: "schedule-e-assistant", label: "Schedule-E assistant" },
  { key: "security-deposits", label: "Security deposits held" },
  { key: "renters-insurance", label: "Renters insurance compliance" },
  { key: "work-orders", label: "Work orders" },
  { key: "vendor-contacts", label: "Vendor contact list" },
  { key: "vendor-ledger", label: "Vendor ledger" },
];
const REPORT_GROUPS = [
  { label: "Overview", keys: ["", "vacant-units"] },
  { label: "Tenants", keys: ["delinquent-tenants", "lease-expiration", "tenant-contacts", "security-deposits", "renters-insurance"] },
  { label: "Financial", keys: ["account-ledger", "income-expense-statement", "upcoming-charges"] },
  { label: "Tax", keys: ["schedule-e-assistant"] },
  { label: "Vendors", keys: ["work-orders", "vendor-contacts", "vendor-ledger"] },
];
// Each report needs a different filter shape — this is the single source of
// truth FilterBar and buildReportParams both read from.
const FILTER_MODES = {
  "": "asOf",
  "delinquent-tenants": "asOf",
  "vacant-units": "asOf",
  "lease-expiration": "range",
  "upcoming-charges": "range",
  "account-ledger": "range",
  "income-expense-statement": "range",
  "schedule-e-assistant": "taxYear",
  "security-deposits": "propertyOnly",
  "renters-insurance": "propertyOnly",
  "work-orders": "propertyOnly",
  "tenant-contacts": "propertyOnly",
  "vendor-contacts": "none",
  "vendor-ledger": "contractorRange",
};
const PROPERTY_FILTER_MODES = new Set(["asOf", "range", "taxYear", "propertyOnly"]);
function buildReportParams(key, filters, extra = {}) {
  const params = new URLSearchParams();
  if (key) params.set("report", key);
  const mode = FILTER_MODES[key] || "none";
  if (PROPERTY_FILTER_MODES.has(mode) && filters.propertyId) params.set("propertyId", filters.propertyId);
  if (mode === "asOf" && filters.asOfDate) params.set("asOfDate", filters.asOfDate);
  if (mode === "range" || mode === "contractorRange") {
    if (filters.startDate) params.set("startDate", filters.startDate);
    if (filters.endDate) params.set("endDate", filters.endDate);
  }
  if (mode === "taxYear" && filters.taxYear) params.set("taxYear", filters.taxYear);
  if (mode === "contractorRange" && filters.contractorId) params.set("contractorId", filters.contractorId);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return params;
}
function loadFavorites() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
export default function RentalReportsPanel() {
  const [reportKey, setReportKey] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [asOfDate, setAsOfDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [taxYear, setTaxYear] = useState(String(new Date().getFullYear()));
  const [contractorId, setContractorId] = useState("");
  const [availableProperties, setAvailableProperties] = useState([]);
  const [availableContractors, setAvailableContractors] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [loaded, setLoaded] = useState(null);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  useEffect(() => {
    setFavorites(loadFavorites());
  }, []);
  const toggleFavorite = useCallback((key) => {
    setFavorites((current) => {
      const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
      window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  const favoriteReports = REPORTS.filter((item) => favorites.includes(item.key));
  const selectReport = (key) => {
    setReportKey(key);
    setPropertyId("");
    setAsOfDate("");
    setStartDate("");
    setEndDate("");
    setContractorId("");
  };
  const filters = { propertyId, asOfDate, startDate, endDate, taxYear, contractorId };
  const load = useCallback((key, currentFilters) => {
    const params = buildReportParams(key, currentFilters);
    return fetch(`/api/rental/reports?${params.toString()}`).then(
      async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        return body.report;
      },
    );
  }, []);
  useEffect(() => {
    let cancelled = false;
    setError("");
    load(reportKey, filters)
      .then((nextReport) => {
        if (cancelled) return;
        setLoaded({ key: reportKey, report: nextReport });
        if (nextReport.availableProperties) {
          setAvailableProperties(nextReport.availableProperties);
        }
        if (nextReport.availableContractors) {
          setAvailableContractors(nextReport.availableContractors);
        }
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, reportKey, propertyId, asOfDate, startDate, endDate, taxYear, contractorId, refreshToken]);
  // Only trust `loaded` when it was fetched for the currently-selected tab —
  // otherwise a render can land between a tab switch and its effect running,
  // pairing the new reportKey with a report shaped for the previous tab.
  const report = loaded && loaded.key === reportKey ? loaded.report : null;
  const csvHref = `/api/rental/reports?${buildReportParams(reportKey, filters, { format: "csv" }).toString()}`;
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none">
      <div className="border-b border-slate-200 p-6 print:hidden">
        <p className="text-sm font-bold uppercase tracking-widest text-amber-700">
          Rental reporting
        </p>
        <h2 className="mt-2 text-2xl font-black">Rent roll and tenant ledger</h2>
        <p className="mt-2 text-slate-600">
          See scheduled rent, collected payments, open balances, and delinquency
          as of today.
        </p>
      </div>
      <div className="hidden print:block p-6">
        <h2 className="text-2xl font-black">
          {REPORTS.find((item) => item.key === reportKey)?.label}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Generated {new Date().toLocaleString()}
          {propertyId ? ` — ${propertyLabel(propertyId)}` : ""}
          {asOfDate ? ` — as of ${asOfDate}` : ""}
          {startDate || endDate ? ` — ${startDate || "…"} to ${endDate || "…"}` : ""}
          {FILTER_MODES[reportKey] === "taxYear" ? ` — tax year ${taxYear}` : ""}
        </p>
      </div>
      <div className="flex flex-col md:flex-row">
        <ReportSidebar
          reportKey={reportKey}
          onSelect={selectReport}
          favorites={favorites}
          favoriteReports={favoriteReports}
          onToggleFavorite={toggleFavorite}
        />
        <div className="min-w-0 flex-1 p-6">
      <div className="print:hidden">
        <FilterBar
          mode={FILTER_MODES[reportKey] || "none"}
          propertyId={propertyId}
          onPropertyChange={setPropertyId}
          availableProperties={availableProperties}
          asOfDate={asOfDate}
          onAsOfDateChange={setAsOfDate}
          startDate={startDate}
          onStartDateChange={setStartDate}
          endDate={endDate}
          onEndDateChange={setEndDate}
          taxYear={taxYear}
          onTaxYearChange={setTaxYear}
          contractorId={contractorId}
          onContractorChange={setContractorId}
          availableContractors={availableContractors}
        />
      </div>
      <ManualFinancialEventForm
        availableProperties={availableProperties}
        onSaved={() => setRefreshToken((token) => token + 1)}
      />
      {error ? (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-800">
          {error}
        </p>
      ) : !report ? (
        <p className="mt-4 text-slate-500">Loading report…</p>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap gap-3 print:hidden">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg border border-slate-300 px-5 py-3 font-bold text-slate-700 hover:border-slate-400"
            >
              Print / Save as PDF
            </button>
            <a
              href={csvHref}
              className="rounded-lg bg-slate-950 px-5 py-3 font-bold text-white"
            >
              Download CSV
            </a>
            {!reportKey && (
              <a
                href={`/api/rental/reports?format=tax-csv&taxYear=${new Date().getFullYear()}`}
                className="rounded-lg border px-5 py-3 font-bold"
              >
                Download accountant/contractor tax CSV
              </a>
            )}
          </div>
          {!reportKey && (
            <p className="mt-3 text-sm text-slate-600 print:hidden">Review package only—not a filed 1099 or an automatic eligibility decision.</p>
          )}
          {reportKey === "schedule-e-assistant" && (
            <p className="mt-3 text-sm text-slate-600 print:hidden">Starting point for your accountant—not a filed tax return. Depreciation isn&apos;t tracked yet.</p>
          )}
          {reportKey === "" && <RentRollView report={report} />}
          {reportKey === "delinquent-tenants" && <DelinquentTenantsView report={report} />}
          {reportKey === "lease-expiration" && <LeaseExpirationView report={report} />}
          {reportKey === "vacant-units" && <VacantUnitsView report={report} />}
          {reportKey === "tenant-contacts" && <TenantContactsView report={report} />}
          {reportKey === "upcoming-charges" && <UpcomingChargesView report={report} />}
          {reportKey === "account-ledger" && <AccountLedgerView report={report} />}
          {reportKey === "income-expense-statement" && <IncomeExpenseStatementView report={report} />}
          {reportKey === "schedule-e-assistant" && <ScheduleEAssistantView report={report} />}
          {reportKey === "security-deposits" && <SecurityDepositsView report={report} />}
          {reportKey === "renters-insurance" && <RentersInsuranceView report={report} />}
          {reportKey === "work-orders" && <WorkOrdersView report={report} />}
          {reportKey === "vendor-contacts" && <VendorContactsView report={report} />}
          {reportKey === "vendor-ledger" && <VendorLedgerView report={report} />}
        </>
      )}
        </div>
      </div>
    </section>
  );
}
function propertyLabel(id) {
  return id === "unassigned" ? "Unassigned / general" : id;
}
const SIDEBAR_COLLAPSE_STORAGE_KEY = "forge-rental-report-sidebar-collapsed";
function loadCollapsedGroups() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function ReportSidebar({ reportKey, onSelect, favorites, favoriteReports, onToggleFavorite }) {
  const [collapsed, setCollapsed] = useState([]);
  useEffect(() => {
    setCollapsed(loadCollapsedGroups());
  }, []);
  const toggleGroup = (label) => {
    setCollapsed((current) => {
      const next = current.includes(label) ? current.filter((item) => item !== label) : [...current, label];
      window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };
  return (
    <aside className="shrink-0 border-b border-slate-200 p-4 md:w-64 md:border-b-0 md:border-r print:hidden">
      {favoriteReports.length > 0 && (
        <SidebarGroup
          label="Favorites"
          items={favoriteReports}
          reportKey={reportKey}
          onSelect={onSelect}
          favorites={favorites}
          onToggleFavorite={onToggleFavorite}
          collapsed={collapsed.includes("Favorites")}
          onToggleGroup={toggleGroup}
        />
      )}
      {REPORT_GROUPS.map((group) => (
        <SidebarGroup
          key={group.label}
          label={group.label}
          items={REPORTS.filter((item) => group.keys.includes(item.key))}
          reportKey={reportKey}
          onSelect={onSelect}
          favorites={favorites}
          onToggleFavorite={onToggleFavorite}
          collapsed={collapsed.includes(group.label)}
          onToggleGroup={toggleGroup}
        />
      ))}
    </aside>
  );
}
function SidebarGroup({ label, items, reportKey, onSelect, favorites, onToggleFavorite, collapsed, onToggleGroup }) {
  const containsActive = items.some((item) => item.key === reportKey);
  const open = !collapsed || containsActive;
  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => onToggleGroup(label)}
        className="flex w-full items-center justify-between px-2 text-xs font-black uppercase tracking-wide text-slate-400 hover:text-slate-600"
      >
        <span>{label}</span>
        <span className="text-sm">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
      <div className="mt-1 space-y-1">
        {items.map((item) => (
          <div
            key={item.key || "rent-roll"}
            className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-sm ${
              reportKey === item.key ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            <button type="button" onClick={() => onSelect(item.key)} className="flex-1 text-left font-bold">
              {item.label}
            </button>
            <button
              type="button"
              aria-label={favorites.includes(item.key) ? `Unfavorite ${item.label}` : `Favorite ${item.label}`}
              onClick={() => onToggleFavorite(item.key)}
              className={`ml-1 leading-none ${
                favorites.includes(item.key)
                  ? "text-amber-400"
                  : reportKey === item.key
                    ? "text-slate-500 hover:text-slate-300"
                    : "text-slate-300 hover:text-slate-400"
              }`}
            >
              {favorites.includes(item.key) ? "★" : "☆"}
            </button>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
function FilterBar({
  mode,
  propertyId,
  onPropertyChange,
  availableProperties,
  asOfDate,
  onAsOfDateChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  taxYear,
  onTaxYearChange,
  contractorId,
  onContractorChange,
  availableContractors,
}) {
  if (mode === "none") return null;
  return (
    <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl bg-slate-50 p-3">
      {mode === "contractorRange" ? (
        <label className="text-sm">
          <span className="block font-bold text-slate-700">Contractor</span>
          <select
            value={contractorId}
            onChange={(event) => onContractorChange(event.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2"
          >
            <option value="">All contractors</option>
            {availableContractors.map((contractor) => (
              <option key={contractor.id} value={contractor.id}>
                {contractor.businessName}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="text-sm">
          <span className="block font-bold text-slate-700">Property</span>
          <select
            value={propertyId}
            onChange={(event) => onPropertyChange(event.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2"
          >
            <option value="">All properties</option>
            {availableProperties.map((id) => (
              <option key={id} value={id}>
                {propertyLabel(id)}
              </option>
            ))}
          </select>
        </label>
      )}
      {mode === "asOf" && (
        <label className="text-sm">
          <span className="block font-bold text-slate-700">As of</span>
          <input
            type="date"
            value={asOfDate}
            onChange={(event) => onAsOfDateChange(event.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
      )}
      {(mode === "range" || mode === "contractorRange") && (
        <>
          <label className="text-sm">
            <span className="block font-bold text-slate-700">From</span>
            <input
              type="date"
              value={startDate}
              onChange={(event) => onStartDateChange(event.target.value)}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="block font-bold text-slate-700">To</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => onEndDateChange(event.target.value)}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
        </>
      )}
      {mode === "taxYear" && (
        <label className="text-sm">
          <span className="block font-bold text-slate-700">Tax year</span>
          <input
            type="number"
            value={taxYear}
            onChange={(event) => onTaxYearChange(event.target.value)}
            className="mt-1 w-28 rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
      )}
    </div>
  );
}
function Kpi({ label, value, attention = false }) {
  return (
    <div
      className={`rounded-xl p-4 ${attention ? "bg-red-50 text-red-900" : "bg-slate-50"}`}
    >
      <p className="text-xs font-bold uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}
function RentRollView({ report }) {
  return (
    <>
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <Kpi
          label="Monthly scheduled"
          value={money.format(report.summary.monthlyScheduledCents / 100)}
        />
        <Kpi
          label="Collected"
          value={money.format(report.summary.collectedCents / 100)}
        />
        <Kpi
          label="Open balance"
          value={money.format(report.summary.openBalanceCents / 100)}
          attention={report.summary.openBalanceCents > 0}
        />
        <Kpi
          label="Overdue"
          value={money.format(report.summary.overdueBalanceCents / 100)}
          attention={report.summary.overdueBalanceCents > 0}
        />
        <Kpi label="Active leases" value={report.summary.activeLeases} />
        <Kpi label="Occupied units" value={report.summary.occupiedUnits} />
      </div>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3">Unit / tenant</th>
              <th className="p-3">Lease</th>
              <th className="p-3">Monthly rent</th>
              <th className="p-3">Open</th>
              <th className="p-3">Overdue</th>
              <th className="p-3">Collected</th>
            </tr>
          </thead>
          <tbody>
            {report.rentRoll.map((row) => (
              <tr key={row.leaseId} className="border-b">
                <td className="p-3">
                  <strong>{row.unitLabel}</strong>
                  <br />
                  <span className="text-slate-500">
                    {row.tenantNames.join(", ") || "No tenant"}
                  </span>
                </td>
                <td className="p-3 capitalize">
                  {row.status}
                  <br />
                  <span className="text-xs text-slate-500">
                    {row.startDate}
                    {row.endDate ? ` — ${row.endDate}` : " — current"}
                  </span>
                </td>
                <td className="p-3">
                  {money.format(row.monthlyRentCents / 100)}
                </td>
                <td className="p-3">
                  {money.format(row.balanceCents / 100)}
                </td>
                <td
                  className={`p-3 font-bold ${row.overdueCents > 0 ? "text-red-700" : ""}`}
                >
                  {money.format(row.overdueCents / 100)}
                </td>
                <td className="p-3">
                  {money.format(row.collectedCents / 100)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
function DelinquentTenantsView({ report }) {
  return (
    <>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <Kpi label="Delinquent leases" value={report.summary.delinquentLeaseCount} />
        <Kpi
          label="Total overdue"
          value={money.format(report.summary.totalOverdueCents / 100)}
          attention={report.summary.totalOverdueCents > 0}
        />
      </div>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3">Unit / tenant</th>
              <th className="p-3">Contact</th>
              <th className="p-3">Overdue</th>
              <th className="p-3">Overdue charges</th>
              <th className="p-3">Oldest due date</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length ? (
              report.rows.map((row) => (
                <tr key={row.leaseId} className="border-b">
                  <td className="p-3">
                    <strong>{row.unitLabel}</strong>
                    <br />
                    <span className="text-slate-500">{row.tenantNames.join(", ") || "No tenant"}</span>
                  </td>
                  <td className="p-3 text-slate-500">
                    {row.tenantEmails.join(", ")}
                    <br />
                    {row.tenantPhones.filter(Boolean).join(", ")}
                  </td>
                  <td className="p-3 font-bold text-red-700">{money.format(row.overdueCents / 100)}</td>
                  <td className="p-3">{row.overdueChargeCount}</td>
                  <td className="p-3">{row.oldestDueDate}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="p-3 text-slate-500" colSpan={5}>No delinquent tenants.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
function LeaseExpirationView({ report }) {
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="p-3">Unit / tenant</th>
            <th className="p-3">End date</th>
            <th className="p-3">Days until expiration</th>
            <th className="p-3">Monthly rent</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.length ? (
            report.rows.map((row) => (
              <tr key={row.leaseId} className="border-b">
                <td className="p-3">
                  <strong>{row.unitLabel}</strong>
                  <br />
                  <span className="text-slate-500">{row.tenantNames.join(", ") || "No tenant"}</span>
                </td>
                <td className="p-3">{row.endDate}</td>
                <td className={`p-3 font-bold ${row.daysUntilExpiration < 0 ? "text-red-700" : ""}`}>
                  {row.daysUntilExpiration}
                </td>
                <td className="p-3">{money.format(row.monthlyRentCents / 100)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="p-3 text-slate-500" colSpan={4}>No leases expiring in this window.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function VacantUnitsView({ report }) {
  return (
    <>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <Kpi label="Vacant units" value={report.summary.vacantUnitCount} />
        <Kpi label="Total units" value={report.summary.totalUnitCount} />
      </div>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3">Unit</th>
              <th className="p-3">Status</th>
              <th className="p-3">Beds / baths / sqft</th>
              <th className="p-3">Available since</th>
              <th className="p-3">Days vacant</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length ? (
              report.rows.map((row) => (
                <tr key={row.unitId} className="border-b">
                  <td className="p-3">
                    <strong>{row.unitLabel}</strong>
                  </td>
                  <td className="p-3 capitalize">{row.status}</td>
                  <td className="p-3">
                    {row.bedrooms ?? "—"} / {row.bathrooms ?? "—"} / {row.squareFeet ?? "—"}
                  </td>
                  <td className="p-3">{row.availableAt || "—"}</td>
                  <td className="p-3 font-bold">{row.daysVacant ?? "—"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="p-3 text-slate-500" colSpan={5}>No vacant units.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
function TenantContactsView({ report }) {
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="p-3">Tenant</th>
            <th className="p-3">Contact</th>
            <th className="p-3">Status</th>
            <th className="p-3">Current unit</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.tenantId} className="border-b">
              <td className="p-3">
                <strong>{row.displayName}</strong>
              </td>
              <td className="p-3 text-slate-500">
                {row.email}
                {row.phone ? <><br />{row.phone}</> : null}
              </td>
              <td className="p-3 capitalize">{row.status}</td>
              <td className="p-3">
                {row.unitLabel || "—"}
                {row.unitLabel ? <br /> : null}
                <span className="text-xs text-slate-500">{row.propertyId}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function UpcomingChargesView({ report }) {
  return (
    <>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <Kpi label="Upcoming charges" value={report.summary.upcomingCount} />
        <Kpi label="Total due" value={money.format(report.summary.totalDueCents / 100)} />
      </div>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3">Unit / tenant</th>
              <th className="p-3">Due date</th>
              <th className="p-3">Amount due</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length ? (
              report.rows.map((row) => (
                <tr key={row.chargeId} className="border-b">
                  <td className="p-3">
                    <strong>{row.unitLabel}</strong>
                    <br />
                    <span className="text-slate-500">{row.tenantNames.join(", ") || "No tenant"}</span>
                  </td>
                  <td className="p-3">{row.dueDate}</td>
                  <td className="p-3">{money.format(row.remainingCents / 100)}</td>
                  <td className="p-3 capitalize">{row.status}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="p-3 text-slate-500" colSpan={4}>No charges due in this window.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
function AccountLedgerView({ report }) {
  return (
    <>
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <Kpi label="Transactions" value={report.summary.transactionCount} />
        <Kpi label="Total debits" value={money.format(report.summary.totalDebits)} />
        <Kpi label="Total credits" value={money.format(report.summary.totalCredits)} />
        <Kpi label="Ending balance" value={money.format(report.summary.endingBalance)} attention={report.summary.endingBalance < 0} />
      </div>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3">Date</th>
              <th className="p-3">Description</th>
              <th className="p-3">Category</th>
              <th className="p-3">Property</th>
              <th className="p-3">Debit</th>
              <th className="p-3">Credit</th>
              <th className="p-3">Balance</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length ? (
              report.rows.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="p-3">{row.date}</td>
                  <td className="p-3">{row.description}</td>
                  <td className="p-3 capitalize text-slate-500">{row.category.replaceAll("_", " ")}</td>
                  <td className="p-3 text-slate-500">{propertyLabel(row.propertyId)}</td>
                  <td className="p-3">{row.debit ? money.format(row.debit) : ""}</td>
                  <td className="p-3">{row.credit ? money.format(row.credit) : ""}</td>
                  <td className={`p-3 font-bold ${row.balance < 0 ? "text-red-700" : ""}`}>{money.format(row.balance)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="p-3 text-slate-500" colSpan={7}>No transactions in this scope.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
function IncomeExpenseStatementView({ report }) {
  return (
    <>
      <div className="mt-6 grid gap-3 md:grid-cols-4">
        <Kpi label="Income" value={money.format(report.summary.income)} />
        <Kpi label="Expenses" value={money.format(report.summary.expenses)} />
        <Kpi label="Net" value={money.format(report.summary.net)} attention={report.summary.net < 0} />
        <Kpi label="NOI" value={money.format(report.summary.noi)} attention={report.summary.noi < 0} />
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">By property</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="p-2">Property</th>
                  <th className="p-2">Income</th>
                  <th className="p-2">Expenses</th>
                  <th className="p-2">Net</th>
                  <th className="p-2">NOI</th>
                </tr>
              </thead>
              <tbody>
                {report.byProperty.map((row) => (
                  <tr key={row.propertyId} className="border-b">
                    <td className="p-2">{propertyLabel(row.propertyId)}</td>
                    <td className="p-2">{money.format(row.income)}</td>
                    <td className="p-2">{money.format(row.expenses)}</td>
                    <td className="p-2">{money.format(row.net)}</td>
                    <td className="p-2">{money.format(row.noi)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">By category</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="p-2">Category</th>
                  <th className="p-2">Income</th>
                  <th className="p-2">Expenses</th>
                  <th className="p-2">Net</th>
                </tr>
              </thead>
              <tbody>
                {report.byCategory.map((row) => (
                  <tr key={row.category} className="border-b">
                    <td className="p-2 capitalize">{row.category.replaceAll("_", " ")}</td>
                    <td className="p-2">{money.format(row.income)}</td>
                    <td className="p-2">{money.format(row.expenses)}</td>
                    <td className="p-2">{money.format(row.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
function ScheduleEAssistantView({ report }) {
  return (
    <>
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <Kpi label="Rents received" value={money.format(report.summary.totalRentsReceivedCents / 100)} />
        <Kpi label="Total expenses" value={money.format(report.summary.totalExpensesCents / 100)} />
        <Kpi label="Net income" value={money.format(report.summary.netIncomeCents / 100)} attention={report.summary.netIncomeCents < 0} />
      </div>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3">Line</th>
              <th className="p-3">Label</th>
              <th className="p-3">Amount</th>
              <th className="p-3">Transactions</th>
              <th className="p-3">Source categories</th>
            </tr>
          </thead>
          <tbody>
            {report.lines.map((row) => (
              <tr key={row.line} className="border-b">
                <td className="p-3">{row.line}</td>
                <td className="p-3">{row.label}</td>
                <td className="p-3">{money.format(row.amountCents / 100)}</td>
                <td className="p-3">{row.transactionCount}</td>
                <td className="p-3 text-xs text-slate-500">{row.categories.join(", ")}</td>
              </tr>
            ))}
            <tr>
              <td className="p-3">18</td>
              <td className="p-3">Depreciation</td>
              <td className="p-3 text-slate-500" colSpan={3}>Not tracked — add manually with your accountant.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
function SecurityDepositsView({ report }) {
  return (
    <>
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <Kpi label="Deposits" value={report.summary.depositCount} />
        <Kpi label="Total required" value={money.format(report.summary.totalRequiredCents / 100)} />
        <Kpi label="Total held" value={money.format(report.summary.totalHeldCents / 100)} />
      </div>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3">Unit / tenant</th>
              <th className="p-3">Status</th>
              <th className="p-3">Required</th>
              <th className="p-3">Held</th>
              <th className="p-3">Jurisdiction</th>
              <th className="p-3">Disposition deadline</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length ? (
              report.rows.map((row) => (
                <tr key={row.depositId} className="border-b">
                  <td className="p-3">
                    <strong>{row.unitLabel}</strong>
                    <br />
                    <span className="text-slate-500">{row.tenantNames.join(", ") || "No tenant"}</span>
                  </td>
                  <td className="p-3 capitalize">{row.status.replaceAll("_", " ")}</td>
                  <td className="p-3">{money.format(row.requiredCents / 100)}</td>
                  <td
                    className={`p-3 font-bold ${row.heldCents < row.requiredCents ? "text-red-700" : ""}`}
                  >
                    {money.format(row.heldCents / 100)}
                  </td>
                  <td className="p-3">{row.jurisdictionCode || "—"}</td>
                  <td className="p-3">{row.dispositionDeadline || "—"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="p-3 text-slate-500" colSpan={6}>No security deposits on file.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
function RentersInsuranceView({ report }) {
  return (
    <>
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <Kpi label="Active leases" value={report.summary.activeLeaseCount} />
        <Kpi label="Compliant" value={report.summary.compliantCount} />
        <Kpi label="Missing evidence" value={report.summary.missingCount} attention={report.summary.missingCount > 0} />
      </div>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3">Unit / tenant</th>
              <th className="p-3">Status</th>
              <th className="p-3">Evidence on file</th>
              <th className="p-3">Most recent upload</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length ? (
              report.rows.map((row) => (
                <tr key={row.leaseId} className="border-b">
                  <td className="p-3">
                    <strong>{row.unitLabel}</strong>
                    <br />
                    <span className="text-slate-500">{row.tenantNames.join(", ") || "No tenant"}</span>
                  </td>
                  <td className={`p-3 font-bold ${row.hasEvidence ? "" : "text-red-700"}`}>
                    {row.hasEvidence ? "Compliant" : "Missing"}
                  </td>
                  <td className="p-3">{row.evidenceCount}</td>
                  <td className="p-3">{row.mostRecentUploadAt ? new Date(row.mostRecentUploadAt).toLocaleDateString() : "—"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="p-3 text-slate-500" colSpan={4}>No active leases in this scope.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
function WorkOrdersView({ report }) {
  return (
    <>
      <div className="mt-6 grid gap-3 md:grid-cols-4">
        <Kpi label="Open" value={report.summary.openCount} attention={report.summary.openCount > 0} />
        <Kpi label="Closed" value={report.summary.closedCount} />
        <Kpi label="Estimated cost" value={money.format(report.summary.totalEstimatedCents / 100)} />
        <Kpi label="Actual cost" value={money.format(report.summary.totalActualCents / 100)} />
      </div>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3">Unit</th>
              <th className="p-3">Contractor</th>
              <th className="p-3">Status</th>
              <th className="p-3">Scope of work</th>
              <th className="p-3">Scheduled</th>
              <th className="p-3">Estimated</th>
              <th className="p-3">Actual</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length ? (
              report.rows.map((row) => (
                <tr key={row.workOrderId} className="border-b">
                  <td className="p-3">{row.unitLabel}</td>
                  <td className="p-3">{row.contractorName}</td>
                  <td className={`p-3 capitalize font-bold ${row.isOpen ? "text-amber-700" : ""}`}>{row.status.replaceAll("_", " ")}</td>
                  <td className="p-3">{row.scopeOfWork}</td>
                  <td className="p-3">{row.scheduledStart ? new Date(row.scheduledStart).toLocaleDateString() : "—"}</td>
                  <td className="p-3">{row.estimatedCostCents != null ? money.format(row.estimatedCostCents / 100) : "—"}</td>
                  <td className="p-3">{row.actualCostCents != null ? money.format(row.actualCostCents / 100) : "—"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="p-3 text-slate-500" colSpan={7}>No work orders in this scope.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
function VendorContactsView({ report }) {
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="p-3">Business</th>
            <th className="p-3">Contact</th>
            <th className="p-3">Trade</th>
            <th className="p-3">Status</th>
            <th className="p-3">Insurance expiration</th>
            <th className="p-3">W-9 status</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.contractorId} className="border-b">
              <td className="p-3">
                <strong>{row.businessName}</strong>
                {row.contactName ? <><br /><span className="text-slate-500">{row.contactName}</span></> : null}
              </td>
              <td className="p-3 text-slate-500">
                {row.email}
                {row.phone ? <><br />{row.phone}</> : null}
              </td>
              <td className="p-3 capitalize">{row.trade || "—"}</td>
              <td className="p-3 capitalize">{row.status}</td>
              <td className="p-3">{row.insuranceExpiration || "—"}</td>
              <td className="p-3 capitalize">{row.w9Status.replaceAll("_", " ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function VendorLedgerView({ report }) {
  return (
    <>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <Kpi label="Payments" value={report.summary.paymentCount} />
        <Kpi label="Total paid" value={money.format(report.summary.totalPaidCents / 100)} />
      </div>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3">Paid date</th>
              <th className="p-3">Contractor</th>
              <th className="p-3">Property</th>
              <th className="p-3">Amount</th>
              <th className="p-3">Method</th>
              <th className="p-3">Reference</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length ? (
              report.rows.map((row) => (
                <tr key={row.paymentId} className="border-b">
                  <td className="p-3">{row.paidAt}</td>
                  <td className="p-3">{row.businessName}</td>
                  <td className="p-3 text-slate-500">{row.propertyId}</td>
                  <td className="p-3">{money.format(row.amountCents / 100)}</td>
                  <td className="p-3 capitalize">{row.paymentMethod}</td>
                  <td className="p-3">{row.reference}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="p-3 text-slate-500" colSpan={6}>No vendor payments in this scope.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
