"use client";
import { useCallback, useEffect, useState } from "react";
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const REPORTS = [
  { key: "", label: "Rent roll" },
  { key: "delinquent-tenants", label: "Delinquent tenants" },
  { key: "lease-expiration", label: "Lease expiration" },
  { key: "vacant-units", label: "Vacant units" },
  { key: "tenant-contacts", label: "Tenant contact list" },
  { key: "upcoming-charges", label: "Upcoming charges due" },
  { key: "account-ledger", label: "Account ledger" },
];
const POINT_IN_TIME_REPORTS = new Set(["", "delinquent-tenants", "vacant-units"]);
const RANGE_REPORTS = new Set(["lease-expiration", "upcoming-charges", "account-ledger"]);
function buildReportParams(key, filters, extra = {}) {
  const params = new URLSearchParams();
  if (key) params.set("report", key);
  if (filters.propertyId) params.set("propertyId", filters.propertyId);
  if (POINT_IN_TIME_REPORTS.has(key) && filters.asOfDate) params.set("asOfDate", filters.asOfDate);
  if (RANGE_REPORTS.has(key)) {
    if (filters.startDate) params.set("startDate", filters.startDate);
    if (filters.endDate) params.set("endDate", filters.endDate);
  }
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return params;
}
export default function RentalReportsPanel() {
  const [reportKey, setReportKey] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [asOfDate, setAsOfDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [availableProperties, setAvailableProperties] = useState([]);
  const [loaded, setLoaded] = useState(null);
  const [error, setError] = useState("");
  const filters = { propertyId, asOfDate, startDate, endDate };
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
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, reportKey, propertyId, asOfDate, startDate, endDate]);
  // Only trust `loaded` when it was fetched for the currently-selected tab —
  // otherwise a render can land between a tab switch and its effect running,
  // pairing the new reportKey with a report shaped for the previous tab.
  const report = loaded && loaded.key === reportKey ? loaded.report : null;
  const csvHref = `/api/rental/reports?${buildReportParams(reportKey, filters, { format: "csv" }).toString()}`;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-bold uppercase tracking-widest text-amber-700 print:hidden">
        Rental reporting
      </p>
      <h2 className="mt-2 text-2xl font-black print:hidden">Rent roll and tenant ledger</h2>
      <p className="mt-2 text-slate-600 print:hidden">
        See scheduled rent, collected payments, open balances, and delinquency
        as of today.
      </p>
      <div className="hidden print:block">
        <h2 className="text-2xl font-black">
          {REPORTS.find((item) => item.key === reportKey)?.label}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Generated {new Date().toLocaleString()}
          {propertyId ? ` — ${propertyLabel(propertyId)}` : ""}
          {asOfDate ? ` — as of ${asOfDate}` : ""}
          {startDate || endDate ? ` — ${startDate || "…"} to ${endDate || "…"}` : ""}
        </p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 print:hidden">
        {REPORTS.map((item) => (
          <button
            key={item.key || "rent-roll"}
            type="button"
            onClick={() => {
              setReportKey(item.key);
              setPropertyId("");
              setAsOfDate("");
              setStartDate("");
              setEndDate("");
            }}
            className={`rounded-lg px-4 py-2 text-sm font-bold ${
              reportKey === item.key
                ? "bg-slate-950 text-white"
                : "border border-slate-300 text-slate-700 hover:border-slate-400"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="print:hidden">
        <FilterBar
          reportKey={reportKey}
          propertyId={propertyId}
          onPropertyChange={setPropertyId}
          availableProperties={availableProperties}
          asOfDate={asOfDate}
          onAsOfDateChange={setAsOfDate}
          startDate={startDate}
          onStartDateChange={setStartDate}
          endDate={endDate}
          onEndDateChange={setEndDate}
        />
      </div>
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
          {reportKey === "" && <RentRollView report={report} />}
          {reportKey === "delinquent-tenants" && <DelinquentTenantsView report={report} />}
          {reportKey === "lease-expiration" && <LeaseExpirationView report={report} />}
          {reportKey === "vacant-units" && <VacantUnitsView report={report} />}
          {reportKey === "tenant-contacts" && <TenantContactsView report={report} />}
          {reportKey === "upcoming-charges" && <UpcomingChargesView report={report} />}
          {reportKey === "account-ledger" && <AccountLedgerView report={report} />}
        </>
      )}
    </section>
  );
}
function propertyLabel(id) {
  return id === "unassigned" ? "Unassigned / general" : id;
}
function FilterBar({
  reportKey,
  propertyId,
  onPropertyChange,
  availableProperties,
  asOfDate,
  onAsOfDateChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
}) {
  return (
    <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl bg-slate-50 p-3">
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
      {POINT_IN_TIME_REPORTS.has(reportKey) && (
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
      {RANGE_REPORTS.has(reportKey) && (
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
