"use client";
import { useEffect, useMemo, useState } from "react";
import ReservationFinanceDetails from "@/components/reservations/ReservationFinanceDetails";

const money = cents => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
const INITIAL = { unitId: "", guestName: "", guestEmail: "", guestPhone: "", checkIn: "", checkOut: "", guestCount: "1", ownerNotes: "" };
const label = value => String(value || "").replaceAll("_", " ");
const inputClass = "mt-1 w-full rounded-lg border p-2 text-slate-950 dark:bg-slate-950 dark:text-slate-100";

export default function ReservationsPanel() {
  const [inventory, setInventory] = useState([]), [reservations, setReservations] = useState([]), [events, setEvents] = useState([]);
  const [selectedId, setSelectedId] = useState(""), [editing, setEditing] = useState(false), [form, setForm] = useState(INITIAL);
  const [preview, setPreview] = useState(null), [token, setToken] = useState(""), [ack, setAck] = useState(false), [typed, setTyped] = useState("");
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const selected = reservations.find(item => item.id === selectedId) || null;
  const history = useMemo(() => events.filter(event => event.reservation_id === selectedId), [events, selectedId]);

  async function load() {
    try {
      const [i, r] = await Promise.all([fetch("/api/rental/reservations/inventory"), fetch("/api/rental/reservations")]);
      const ip = await i.json(), rp = await r.json();
      if (!i.ok || !r.ok) throw new Error(ip.error || rp.error || "Unable to load reservations.");
      setInventory((ip.inventory || []).filter(item => ["draft", "active"].includes(item.booking_status)));
      setReservations(rp.reservations || []); setEvents(rp.events || []);
    } catch (error) { setMessage(error.message); }
  }
  useEffect(() => { queueMicrotask(load); }, []);
  function clearPreview() { setPreview(null); setToken(""); setAck(false); setTyped(""); }
  function change(name, value) { setForm(current => ({ ...current, [name]: value })); clearPreview(); }
  function createMode() { setEditing(false); setForm(INITIAL); clearPreview(); }
  function editMode() {
    if (!selected) return;
    setEditing(true); clearPreview();
    setForm({ unitId: selected.unit_id, guestName: selected.reservation_guests?.display_name || "", guestEmail: selected.reservation_guests?.email || "", guestPhone: selected.reservation_guests?.phone || "", checkIn: selected.check_in_date, checkOut: selected.check_out_date, guestCount: String(selected.guest_count), ownerNotes: selected.owner_notes || "" });
  }
  async function submit(operation) {
    setBusy(true); setMessage("");
    try {
      const modifying = operation.includes("modification");
      const body = { operation, ...form, guestCount: Number(form.guestCount), ...(modifying ? { reservationId: selectedId } : {}) };
      if (operation.startsWith("confirm")) Object.assign(body, { previewToken: token, acknowledged: ack, confirmationText: typed });
      const response = await fetch("/api/rental/reservations", { method: modifying ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Unable to process reservation.");
      if (operation.startsWith("preview")) { setPreview(payload.preview); setToken(payload.previewToken); }
      else { setMessage(editing ? "Reservation updated." : "Reservation confirmed."); createMode(); await load(); }
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  async function transition(operation) {
    if (!window.confirm(`Confirm ${label(operation)} for this reservation?`)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/rental/reservations", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, reservationId: selectedId }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Unable to update reservation.");
      setMessage(`Reservation ${label(operation)} complete.`); await load();
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }

  const confirmWord = editing ? "MODIFY" : "BOOK";
  const financial = selected?.reservation_financial_contracts;
  return <section aria-label="Reservations" className="space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[.18em] text-sky-700 dark:text-sky-400">Reservations</p><h2 className="text-2xl font-black">Reservation calendar & bookings</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Create and manage stays with immutable lifecycle history. No payment is charged here.</p></div>
    {message && <p role="status" className="rounded-xl border border-sky-200 bg-sky-50 p-3 font-bold text-sky-900">{message}</p>}
    <div className="grid gap-4 xl:grid-cols-2"><div className="space-y-4 rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="font-black">Reservations</h3>
      {reservations.length === 0 ? <p className="text-sm text-slate-600 dark:text-slate-300">No reservations yet.</p> : <ul className="space-y-3">{reservations.map(item => <li key={item.id}><button type="button" aria-pressed={selectedId === item.id} onClick={() => setSelectedId(item.id)} className="w-full rounded-xl border p-3 text-left aria-pressed:border-sky-500 aria-pressed:ring-2 aria-pressed:ring-sky-200 dark:border-slate-700"><b>{item.reservation_inventory_settings?.public_name || item.unit_id}</b><span className="block text-sm">{item.reservation_guests?.display_name} · {item.check_in_date} to {item.check_out_date}</span><span className="block text-sm font-bold">{money(item.total_due_cents)} · {label(item.status)}</span></button></li>)}</ul>}
      {selected && <article aria-label="Reservation detail" className="space-y-3 border-t pt-4 dark:border-slate-700"><h4 className="font-black">Reservation detail</h4><p className="text-sm">{selected.reservation_guests?.display_name} · {selected.reservation_guests?.email}<br />{selected.check_in_date} → {selected.check_out_date} · {selected.guest_count} guests</p><p className="font-bold">{money(selected.total_due_cents)} · {label(selected.status)}</p>{financial && <section aria-label="Reservation financial status" className="rounded-xl border p-3 text-sm"><h5 className="font-black">Financial status</h5><dl className="mt-2 grid grid-cols-2 gap-1"><dt>Booking balance</dt><dd className="text-right font-bold">{money(financial.booking_balance_cents)}</dd><dt>Refundable deposit</dt><dd className="text-right font-bold">{money(financial.security_deposit_cents)}</dd><dt>Payment</dt><dd className="text-right font-bold">{label(selected.financial?.bookingPaymentStatus || "unpaid")}</dd><dt>Settlement</dt><dd className="text-right font-bold">{label(selected.financial?.settlementStatus || "not_applicable")}</dd></dl><ReservationFinanceDetails financial={selected.financial} /><p className="mt-2 text-xs font-bold text-amber-700 dark:text-amber-300">{selected.financial?.bookingAppliedCents > 0 ? "Stripe has confirmed payment. Paid, available, and paid out remain separate states." : "No payment has been collected. Paid, available, and paid out remain separate states."}</p></section>}<div className="flex flex-wrap gap-2">{selected.status === "confirmed" && <><button type="button" onClick={editMode} className="rounded-lg border px-3 py-2 font-bold">Modify</button><button type="button" onClick={() => transition("check_in")} className="rounded-lg bg-emerald-700 px-3 py-2 font-bold text-white">Check in</button><button type="button" onClick={() => transition("cancel")} className="rounded-lg bg-rose-700 px-3 py-2 font-bold text-white">Cancel</button></>}{selected.status === "checked_in" && <button type="button" onClick={() => transition("check_out")} className="rounded-lg bg-sky-700 px-3 py-2 font-bold text-white">Check out</button>}</div><h5 className="text-sm font-black">Immutable history</h5>{history.length === 0 ? <p className="text-sm text-slate-500">No events recorded.</p> : <ol className="space-y-1">{history.map(event => <li key={event.id} className="text-sm capitalize"><b>{label(event.event_type)}</b> · {new Date(event.occurred_at).toLocaleString()}</li>)}</ol>}</article>}
    </div>
    <form onSubmit={event => { event.preventDefault(); submit(editing ? "preview_modification" : "preview"); }} className="space-y-3 rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex justify-between"><h3 className="font-black">{editing ? "Modify reservation" : "Create direct reservation"}</h3>{editing && <button type="button" onClick={createMode} className="text-sm font-bold text-sky-700">Cancel edit</button>}</div>
      <Field label="Space"><select required disabled={editing} value={form.unitId} onChange={event => change("unitId", event.target.value)} className={inputClass}><option value="">Select a space</option>{inventory.map(item => <option key={item.unit_id} value={item.unit_id}>{item.public_name}</option>)}</select></Field>
      {!editing && <><Field label="Guest name"><input required value={form.guestName} onChange={event => change("guestName", event.target.value)} className={inputClass} /></Field><Field label="Guest email"><input type="email" required value={form.guestEmail} onChange={event => change("guestEmail", event.target.value)} className={inputClass} /></Field></>}
      <div className="grid grid-cols-2 gap-3"><Field label="Check-in"><input type="date" required disabled={editing} value={form.checkIn} onChange={event => change("checkIn", event.target.value)} className={inputClass} /></Field><Field label="Check-out"><input type="date" required disabled={editing} value={form.checkOut} onChange={event => change("checkOut", event.target.value)} className={inputClass} /></Field></div>
      {editing && <p className="text-xs font-bold text-slate-600 dark:text-slate-400">Dates and space are locked once a reservation is confirmed — pricing is fixed at confirmation. Guest count and notes can still be updated.</p>}
      <Field label="Guests"><input type="number" min="1" required value={form.guestCount} onChange={event => change("guestCount", event.target.value)} className={inputClass} /></Field><Field label="Internal notes"><textarea value={form.ownerNotes} onChange={event => change("ownerNotes", event.target.value)} className={inputClass} /></Field>
      <button disabled={busy} className="w-full rounded-lg bg-slate-950 px-4 py-2 font-black text-white disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950">Preview {editing ? "changes" : "reservation"}</button>
      {preview && <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-slate-950"><h4 className="font-black">Review {editing ? "changes" : preview.inventoryName}</h4><p className="text-sm"><b>{preview.quote.nights} nights · {money(preview.quote.totalDueCents)} total due</b><br />Lodging {money(preview.quote.lodgingAmountCents)} · Cleaning {money(preview.quote.cleaningFeeCents)} · Tax {money(preview.quote.lodgingTaxCents)} · Deposit {money(preview.quote.securityDepositCents)}</p><label className="flex gap-2 text-sm font-bold"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} />I reviewed the dates, guest count, and price.</label><Field label={`Type ${confirmWord} to confirm`}><input value={typed} onChange={event => setTyped(event.target.value)} className={inputClass} /></Field><button type="button" disabled={busy || !ack || typed !== confirmWord} onClick={() => submit(editing ? "confirm_modification" : "confirm")} className="w-full rounded-lg bg-emerald-700 px-4 py-2 font-black text-white disabled:opacity-50">Confirm {editing ? "changes" : "reservation"}</button></div>}
    </form></div>
  </section>;
}

function Field({ label: fieldLabel, children }) { return <label className="block text-sm font-bold">{fieldLabel}{children}</label>; }
