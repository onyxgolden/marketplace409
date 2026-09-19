"use client";
import { useMemo, useState } from "react";

// ReservationMonthCalendar: a calendar-first picking surface for reservations. It renders
// the reservations the parent already fetched (no new endpoint) as shaded booked nights,
// and lets the user pick a check-in / check-out range date-first instead of typing ISO
// dates into a form. It never claims an unshaded date is available: only the days with
// a real reservation are marked; the booking preview still validates availability.
const DAY_MS = 86_400_000;
const ACTIVE_STATUSES = new Set(["held", "confirmed", "checked_in"]);

function isoDay(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
function parseISO(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  return new Date(`${value}T00:00:00.000Z`);
}
function monthLabel(year, month) {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
function fullLabel(iso) {
  const date = parseISO(iso);
  return date ? date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : iso;
}

/**
 * Props:
 * - reservations: already-fetched reservation rows ({ id, unit_id, check_in_date, check_out_date, status })
 * - unitId: only shade bookings for this space; "" shades every space
 * - checkIn, checkOut: the current form selection (source of truth stays in the parent form)
 * - onSelect(checkIn, checkOut): called when the user picks dates on the calendar
 */
export default function ReservationMonthCalendar({ reservations = [], unitId = "", checkIn = "", checkOut = "", onSelect }) {
  const [cursor, setCursor] = useState(() => {
    const base = parseISO(checkIn) || new Date();
    return { year: base.getUTCFullYear(), month: base.getUTCMonth() };
  });

  const bookedByDate = useMemo(() => {
    const map = new Map();
    for (const reservation of reservations || []) {
      if (unitId && reservation.unit_id !== unitId) continue;
      if (!ACTIVE_STATUSES.has(reservation.status)) continue;
      const start = parseISO(reservation.check_in_date), end = parseISO(reservation.check_out_date);
      if (!start || !end || end <= start) continue;
      for (let cursorDate = start; cursorDate < end; cursorDate = new Date(cursorDate.getTime() + DAY_MS)) {
        const iso = isoDay(cursorDate);
        if (!map.has(iso)) map.set(iso, []);
        map.get(iso).push(reservation);
      }
    }
    return map;
  }, [reservations, unitId]);

  const days = useMemo(() => {
    const first = new Date(Date.UTC(cursor.year, cursor.month, 1));
    const leading = first.getUTCDay();
    const cells = [];
    for (let i = 0; i < 42; i += 1) {
      const date = new Date(first.getTime() + (i - leading) * DAY_MS);
      cells.push({ iso: isoDay(date), inMonth: date.getUTCMonth() === cursor.month });
    }
    return cells;
  }, [cursor]);

  const todayISO = isoDay(new Date());
  // The parent form owns the selection; the calendar only writes through onSelect.
  const inRange = (iso) => checkIn && checkOut && iso > checkIn && iso <= checkOut;
  const isStart = (iso) => iso === checkIn && Boolean(checkIn);
  const isEnd = (iso) => iso === checkOut && Boolean(checkOut) && checkOut !== checkIn;

  function pick(iso) {
    if (iso < todayISO) return;
    if (!checkIn || (checkIn && checkOut)) { onSelect(iso, ""); return; }
    if (iso === checkIn) { onSelect("", ""); return; }
    if (iso > checkIn) { onSelect(checkIn, iso); return; }
    onSelect(iso, "");
  }

  return (
    <section aria-label="Reservation calendar" className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-black">Pick dates on the calendar</h3>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Shaded dates already have a reservation for this space. The preview still checks exact availability and stay rules.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Previous month" onClick={() => setCursor(({ year, month }) => month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 })} className="flex min-h-[2.75rem] min-w-[2.75rem] items-center justify-center rounded-lg border font-black dark:border-slate-600">‹</button>
          <span aria-live="polite" className="min-w-[9rem] text-center font-black">{monthLabel(cursor.year, cursor.month)}</span>
          <button type="button" aria-label="Next month" onClick={() => setCursor(({ year, month }) => month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 })} className="flex min-h-[2.75rem] min-w-[2.75rem] items-center justify-center rounded-lg border font-black dark:border-slate-600">›</button>
        </div>
      </div>
      <div role="grid" aria-label={monthLabel(cursor.year, cursor.month)} className="mt-4 grid grid-cols-7 gap-1">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(name => <span key={name} role="columnheader" className="py-1 text-center text-xs font-black uppercase text-slate-500">{name}</span>)}
        {days.map(({ iso, inMonth }) => {
          const booked = bookedByDate.get(iso);
          const past = iso < todayISO;
          const selected = isStart(iso) || isEnd(iso) || inRange(iso);
          const label = `${fullLabel(iso)}${booked ? ` — reserved (${booked.length})` : ""}${past ? " — past" : ""}`;
          return (
            <button
              key={iso}
              type="button"
              role="gridcell"
              aria-label={label}
              aria-selected={selected}
              disabled={past || !inMonth}
              onClick={() => pick(iso)}
              className={`flex min-h-[2.75rem] flex-col items-center justify-center rounded-lg border text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 ${
                selected ? "border-sky-600 bg-sky-700 text-white" : booked ? "border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200" : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950"
              } ${!inMonth ? "opacity-0" : past ? "opacity-40" : "hover:border-sky-500"}`}
            >
              <span>{Number(iso.slice(8, 10))}</span>
              {booked && inMonth ? <span aria-hidden="true" className="mt-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" /> : null}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs font-bold text-slate-600 dark:text-slate-300">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-amber-200 dark:bg-amber-900/60" />Reserved dates</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-sky-700" />Your picked range</span>
        {(checkIn || checkOut) && <button type="button" onClick={() => onSelect("", "")} className="font-black text-sky-700 underline dark:text-sky-400">Clear picked dates</button>}
      </div>
      {checkIn && !checkOut ? <p role="status" className="mt-3 text-sm font-bold text-sky-800 dark:text-sky-300">Check-in {fullLabel(checkIn)} — now pick a check-out date.</p> : null}
    </section>
  );
}
