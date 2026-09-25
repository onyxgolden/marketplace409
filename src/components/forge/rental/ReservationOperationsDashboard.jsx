"use client";
import { useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";

const money = cents => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(cents || 0) / 100);
const percent = value => new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(Number(value || 0));
const typeLabel = value => value === "rv_site" ? "RV spaces" : value === "cabin" ? "Cabins" : String(value || "Other").replaceAll("_", " ");

async function fetchReservationDashboard(days) {
  const response = await fetch(`/api/rental/reservations/dashboard?days=${days}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Unable to load dashboard.");
  return { dashboard: payload.dashboard };
}

export default function ReservationOperationsDashboard() {
  const [days, setDays] = useState(90);
  // Reservation dashboard: stale-while-revalidate, keyed per period. Switching periods
  // keeps the last loaded period on screen while the new one fetches — never a blank.
  const { data, error, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    `rental:reservations-dashboard:${days}`,
    () => fetchReservationDashboard(days),
    { ttlMs: 60_000 },
  );
  const dashboard = data?.dashboard ?? null;
  // Keep the last loaded period on screen while a different period fetches. This is
  // React's documented "adjust state during render" pattern -- not an effect -- so a
  // period switch never blanks the dashboard back to a skeleton.
  const [prevDashboard, setPrevDashboard] = useState(null);
  if (dashboard && dashboard !== prevDashboard) {
    setPrevDashboard(dashboard);
  }
  const visible = dashboard ?? prevDashboard;
  const loadingNew = isLoading && !visible;
  return <section aria-label="RV and cabin operations dashboard" className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[.18em] text-sky-700 dark:text-sky-400">RV & cabin operations</p><h2 className="text-2xl font-black">Reservation dashboard</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Read-only booking and inventory truth. The selected period starts today and includes complete calendar days.</p></div><label className="text-sm font-bold">Period<select value={days} onChange={event => setDays(Number(event.target.value))} className="ml-2 rounded-lg border bg-white p-2 dark:bg-slate-900"><option value="30">Next 30 days</option><option value="90">Next 90 days</option><option value="365">Next 365 days</option></select></label></header>
    {loadingNew ? <ForgeLoadingState label="Loading reservation operations…" /> : null}
    {!loadingNew && error && !visible ? <ForgeErrorState title="Unable to load the reservation dashboard." detail={error} onRetry={refresh} /> : null}
    {visible ? <>
      {(isRefreshing || (isLoading && visible) || error) ? <p role="status" className="text-xs font-bold text-slate-400 dark:text-slate-500">{error ? "Could not refresh — showing the last saved dashboard." : "Updating…"}</p> : null}
      <Dashboard dashboard={visible} />
    </> : null}
  </section>;
}

function Dashboard({ dashboard }) {
  const s = dashboard.summary;
  if (s.totalActiveInventory === 0) return <div className="rounded-2xl border bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><h3 className="font-black">No active RV or cabin inventory</h3><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Activate reservable inventory to begin measuring availability, occupancy, and expected revenue.</p></div>;
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Active inventory" value={s.totalActiveInventory} /><Metric label="Available today" value={s.availableInventory} detail={`${s.occupiedInventory} occupied · ${s.blockedInventory} blocked`} /><Metric label="Period occupancy" value={percent(s.occupancyRate)} detail={`${s.occupiedNights} of ${s.capacityNights} unit-nights`} /><Metric label="Expected revenue" value={money(s.expectedRevenueCents)} detail="Stays arriving in selected period" /><Metric label="Collected revenue" value="Not linked" detail="Reservation payment linkage begins in RV-E" /><Metric label="Outstanding" value="Not linked" detail="Not inferred from expected revenue" /><Metric label="Arrivals — 14 days" value={s.upcomingArrivals} /><Metric label="Departures — 14 days" value={s.upcomingDepartures} /></div>
    <div className="grid gap-4 xl:grid-cols-2"><Availability summary={s} /><Trend rows={dashboard.occupancyTrend} /><RevenueSplit rows={dashboard.revenueByType} /><div className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><h3 className="font-black">Expected versus collected revenue</h3><p className="mt-3 text-sm"><b>Expected:</b> {money(s.expectedRevenueCents)}</p><p className="text-sm"><b>Collected:</b> unavailable until a reservation-to-payment contract exists.</p><p className="mt-3 text-xs text-slate-500">This dashboard intentionally does not treat a confirmed booking or quoted balance as settled funds.</p></div></div>
  </div>;
}
function Metric({ label, value, detail }) { return <div className="rounded-2xl border bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-2xl font-black">{value}</p>{detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}</div>; }
function Availability({ summary }) { const rows = [{ label: "Occupied", value: summary.occupiedInventory, color: "bg-sky-600" }, { label: "Available", value: summary.availableInventory, color: "bg-emerald-600" }, { label: "Blocked", value: summary.blockedInventory, color: "bg-amber-500" }]; return <ChartCard title="Occupied versus available today"><div className="mt-4 space-y-3">{rows.map(row => <Bar key={row.label} {...row} max={summary.totalActiveInventory} />)}</div><AccessibleTable rows={rows} valueLabel="Inventory" /></ChartCard>; }
function Trend({ rows }) { return <ChartCard title="Occupancy trend"><div className="mt-4 space-y-3">{rows.map(row => <Bar key={row.month} label={row.month} value={Math.round(row.occupancyRate * 1000) / 10} max={100} color="bg-violet-600" suffix="%" />)}</div><AccessibleTable rows={rows.map(row => ({ label: row.month, value: percent(row.occupancyRate) }))} valueLabel="Occupancy" /></ChartCard>; }
function RevenueSplit({ rows }) { const max = Math.max(1, ...rows.map(row => row.amountCents)); return <ChartCard title="Expected revenue by inventory type">{rows.every(row => row.amountCents === 0) ? <p className="mt-3 text-sm text-slate-500">No expected revenue in this period.</p> : <div className="mt-4 space-y-3">{rows.map(row => <Bar key={row.type} label={typeLabel(row.type)} value={row.amountCents} display={money(row.amountCents)} max={max} color="bg-sky-600" />)}</div>}<AccessibleTable rows={rows.map(row => ({ label: typeLabel(row.type), value: money(row.amountCents) }))} valueLabel="Expected revenue" /></ChartCard>; }
function ChartCard({ title, children }) { return <section className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><h3 className="font-black">{title}</h3>{children}</section>; }
function Bar({ label: barLabel, value, display, max, color, suffix = "" }) { return <div><div className="flex justify-between text-sm"><span>{barLabel}</span><b>{display ?? `${value}${suffix}`}</b></div><div className="mt-1 h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className={`h-full ${color}`} style={{ width: `${Math.min(100, max ? Number(value) / max * 100 : 0)}%` }} /></div></div>; }
function AccessibleTable({ rows, valueLabel }) { return <table className="sr-only"><caption>Accessible chart data</caption><thead><tr><th>Category</th><th>{valueLabel}</th></tr></thead><tbody>{rows.map(row => <tr key={row.label}><th>{row.label}</th><td>{row.value}</td></tr>)}</tbody></table>; }
