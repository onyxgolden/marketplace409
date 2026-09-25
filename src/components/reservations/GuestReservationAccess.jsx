"use client";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import {
  ForgeErrorState,
  ForgeLoadingState,
} from "@/components/forge/ForgeStates";
import ReservationTestPayment from "./ReservationTestPayment";
import ReservationFinanceDetails from "./ReservationFinanceDetails";

const money = (cents, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(cents || 0) / 100);
const label = value => String(value || "").replaceAll("_", " ");

// Fetches the guest's reservation access details (arrival instructions plus
// financial status) for one private link.
async function fetchReservationAccess(slug, token) {
  const response = await fetch(`/api/book/${encodeURIComponent(slug)}/access/${encodeURIComponent(token)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load reservation access.");
  return body.access;
}

export default function GuestReservationAccess({ slug, token }) {
  // Access details: stale-while-revalidate. A guest revisiting their private
  // link sees the last saved details instantly; the booking flow below
  // (ReservationTestPayment) is untouched by this change.
  const { data: access, error: loadError, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    `reservation:access:${slug}:${token}`,
    () => fetchReservationAccess(slug, token),
    { ttlMs: 60_000 },
  );
  if (isLoading) return <main className="mx-auto max-w-2xl p-6"><ForgeLoadingState label="Loading reservation access…" /></main>;
  if (!access && loadError) return <main className="mx-auto max-w-2xl p-6"><ForgeErrorState title={loadError} onRetry={refresh} /></main>;
  const financial = access.financial;
  return <main className="mx-auto max-w-2xl p-6"><section className="rounded-3xl border bg-white p-7 shadow-sm dark:border-slate-800 dark:bg-slate-900"><p className="text-xs font-black uppercase tracking-widest text-sky-700">Guest access</p><h1 className="mt-2 text-3xl font-black">{access.publicName}</h1><p className="mt-2">{access.checkIn} through {access.checkOut}</p>{isRefreshing ? <p className="mt-2 text-xs font-bold text-slate-400">Updating…</p> : null}{loadError ? <p role="status" className="mt-2 text-xs font-bold text-slate-400">Could not refresh — showing the last saved details.</p> : null}{access.available ? <div className="mt-5 rounded-xl bg-emerald-50 p-4 text-emerald-950"><h2 className="font-black">Arrival and access instructions</h2><p className="mt-2 whitespace-pre-wrap">{access.arrivalInstructions || "Contact the property for arrival assistance."}</p></div> : <p className="mt-5 rounded-xl bg-amber-50 p-4 font-bold text-amber-950">Access details will be available {new Date(access.availableAt).toLocaleString()}.</p>}{financial && <section aria-label="Reservation financial status" className="mt-5 rounded-xl border p-4"><h2 className="font-black">Reservation financial status</h2><dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><dt>Booking balance</dt><dd className="text-right font-bold">{money(financial.bookingBalanceCents, financial.currencyCode)}</dd><dt>Security deposit required</dt><dd className="text-right font-bold">{money(financial.securityDepositCents, financial.currencyCode)}</dd><dt>Amount currently due</dt><dd className="text-right font-bold">{money(financial.bookingAmountDueCents, financial.currencyCode)}</dd><dt>Payment status</dt><dd className="text-right font-bold capitalize">{label(financial.bookingPaymentStatus)}</dd><dt>Deposit status</dt><dd className="text-right font-bold capitalize">{label(financial.securityDepositStatus)}</dd><dt>Settlement</dt><dd className="text-right font-bold capitalize">{label(financial.settlementStatus)}</dd></dl><ReservationFinanceDetails financial={financial} /><p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-950">{financial.bookingAppliedCents > 0 ? "Stripe has confirmed payment. Settlement and payout remain separate." : "No payment has been collected."}</p>{financial.bookingAmountDueCents > 0 && <ReservationTestPayment slug={slug} token={token} amountDueCents={financial.bookingAmountDueCents} currencyCode={financial.currencyCode} />}</section>}<p className="mt-4 text-sm text-slate-600 dark:text-slate-300">Keep this private link secure. It grants access to arrival and reservation information.</p></section></main>;
}
