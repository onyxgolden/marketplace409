"use client";
import { useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import {
  ForgeErrorState,
  ForgeLoadingState,
} from "@/components/forge/ForgeStates";

const initial = { guestName: "", guestEmail: "", guestPhone: "", checkIn: "", checkOut: "", guestCount: "1" };
const money = (cents, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(cents || 0) / 100);
const label = value => String(value || "").replaceAll("_", " ");
const field = "mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-slate-950 dark:border-slate-700 dark:bg-slate-950 dark:text-white";

// Fetches one stay's public listing (price, capacity, policies) for the
// booking form. Preview/confirm below go through the booking flow's own
// submit handler -- untouched by this change.
async function fetchStayListing(slug) {
  const response = await fetch(`/api/book/${encodeURIComponent(slug)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load this stay.");
  return body.listing;
}

export default function PublicReservationBooking({ slug }) {
  const { data: listing, error: loadError, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    `reservation:listing:${slug}`,
    () => fetchStayListing(slug),
    { ttlMs: 60_000 },
  );
  const [form, setForm] = useState(initial), [preview, setPreview] = useState(null), [token, setToken] = useState("");
  const [acknowledged, setAcknowledged] = useState(false), [typed, setTyped] = useState(""), [confirmation, setConfirmation] = useState(null);
  const [busy, setBusy] = useState(false), [submitError, setSubmitError] = useState("");
  const change = (name, value) => { setForm(current => ({ ...current, [name]: value })); setPreview(null); setToken(""); setAcknowledged(false); setTyped(""); };
  async function submit(operation) {
    setBusy(true);
    setSubmitError("");
    try { const response = await fetch(`/api/book/${encodeURIComponent(slug)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, ...form, guestCount: Number(form.guestCount), previewToken: token, acknowledged, confirmationText: typed }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); if (operation === "preview") { setPreview(body.preview); setToken(body.previewToken); } else setConfirmation(body.confirmation); }
    catch (error) { setSubmitError(error.message); }
    finally { setBusy(false); }
  }
  if (isLoading) return <main className="mx-auto max-w-3xl p-6"><ForgeLoadingState label="Loading stay…" /></main>;
  if (!listing && loadError) return <main className="mx-auto max-w-3xl p-6"><ForgeErrorState title={loadError} onRetry={refresh} /></main>;
  if (confirmation) return <main className="mx-auto max-w-3xl p-6"><section className="rounded-3xl border bg-white p-7 shadow-sm dark:border-slate-800 dark:bg-slate-900"><p className="text-xs font-black uppercase tracking-widest text-emerald-700">Reservation confirmed</p><h1 className="mt-2 text-3xl font-black">{confirmation.publicName}</h1><p className="mt-3">Confirmation <b>{confirmation.id}</b></p><p>{confirmation.checkIn} through {confirmation.checkOut}</p><p className="mt-3 text-xl font-black">Total due: {money(confirmation.totalDueCents, confirmation.currencyCode)}</p><p className="mt-2 rounded-xl bg-amber-50 p-3 font-bold text-amber-950">No payment was collected during this booking.</p><p className="mt-3">Your agreement acknowledgement was recorded. Access details remain hidden until <b>{new Date(confirmation.accessAvailableAt).toLocaleString()}</b>.</p><a className="mt-3 inline-block font-black text-sky-700 underline" href={`/book/${encodeURIComponent(slug)}/access/${encodeURIComponent(confirmation.accessToken)}`}>View arrival and access details</a><p className="mt-3 text-sm text-slate-600 dark:text-slate-300">A confirmation email has been queued for delivery.</p></section></main>;
  const q = preview?.quote;
  return <main className="mx-auto max-w-3xl p-6 text-slate-950 dark:text-slate-100"><header><p className="text-xs font-black uppercase tracking-widest text-sky-700 dark:text-sky-400">409 Marketplace stays</p><h1 className="mt-2 text-3xl font-black">{listing.publicName}</h1><p className="mt-2 text-slate-600 dark:text-slate-300">{listing.publicDescription || "Book this RV or cabin stay directly."}</p><p className="mt-2 text-sm capitalize">{label(listing.inventoryType)} · Up to {listing.maximumGuests} guests · {listing.minimumNights} night minimum</p>{isRefreshing ? <p className="mt-2 text-xs font-bold text-slate-400">Updating…</p> : null}{loadError ? <p role="status" className="mt-2 text-xs font-bold text-slate-400">Could not refresh — showing the last saved listing.</p> : null}</header>
    {submitError && <p role="alert" className="mt-5 rounded-xl border border-rose-300 bg-rose-50 p-3 font-bold text-rose-900">{submitError}</p>}
    <form onSubmit={event => { event.preventDefault(); submit("preview"); }} className="mt-6 space-y-4 rounded-3xl border bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="grid gap-4 sm:grid-cols-2"><Field name="Check-in"><input required type="date" value={form.checkIn} onChange={event => change("checkIn", event.target.value)} className={field} /></Field><Field name="Check-out"><input required type="date" value={form.checkOut} onChange={event => change("checkOut", event.target.value)} className={field} /></Field></div>
      <Field name="Guests"><input required type="number" min="1" max={listing.maximumGuests} value={form.guestCount} onChange={event => change("guestCount", event.target.value)} className={field} /></Field>
      <Field name="Name"><input required autoComplete="name" value={form.guestName} onChange={event => change("guestName", event.target.value)} className={field} /></Field>
      <Field name="Email"><input required type="email" autoComplete="email" value={form.guestEmail} onChange={event => change("guestEmail", event.target.value)} className={field} /></Field>
      <Field name="Phone (optional)"><input type="tel" autoComplete="tel" value={form.guestPhone} onChange={event => change("guestPhone", event.target.value)} className={field} /></Field>
      <button disabled={busy} className="w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950">Preview availability and exact price</button>
      {preview && <section aria-label="Booking preview" className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-slate-950"><h2 className="text-xl font-black">Review before booking</h2><dl className="grid grid-cols-2 gap-2 text-sm"><Amount name="Lodging" value={q.lodgingAmountCents} /><Amount name="Cleaning" value={q.cleaningFeeCents} /><Amount name="Tax" value={q.lodgingTaxCents} /><Amount name="Security deposit" value={q.securityDepositCents} /><Amount name="Total due" value={q.totalDueCents} /></dl><p className="font-bold">No payment will be collected now.</p><div><h3 className="font-black">Cancellation terms</h3><p className="text-sm">{preview.listing.cancellationPolicy}</p></div><div><h3 className="font-black">Guest agreement</h3><p className="whitespace-pre-wrap text-sm">{preview.listing.guestAgreement}</p></div><label className="flex gap-2 text-sm font-bold"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I reviewed and agree to the stay details, exact price, cancellation terms, and guest agreement.</label><Field name="Type BOOK to confirm"><input value={typed} onChange={event => setTyped(event.target.value)} className={field} /></Field><button type="button" disabled={busy || !acknowledged || typed !== "BOOK"} onClick={() => submit("confirm")} className="w-full rounded-xl bg-emerald-700 px-5 py-3 font-black text-white disabled:opacity-50">Confirm reservation</button></section>}
    </form></main>;
}
function Field({ name, children }) { return <label className="block text-sm font-bold">{name}{children}</label>; }
function Amount({ name, value }) { return <div><dt>{name}</dt><dd className="font-black">{money(value)}</dd></div>; }
