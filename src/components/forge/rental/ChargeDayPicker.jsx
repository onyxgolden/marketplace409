"use client";
import { useEffect, useState } from "react";

// Charge day is a recurring day-of-month (1-28, every month has the day),
// not a one-time calendar date.
export function ordinalDayOfMonth(day) {
  const n = Number(day);
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (suffix[(v - 20) % 10] || suffix[v] || suffix[0]);
}

// Parses the day-of-month out of an ISO "YYYY-MM-DD" date. Returns null for
// anything else so callers never invent a day from a malformed value.
export function dayOfMonth(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || "");
  return match ? Number(match[3]) : null;
}

// The backend caps charge_day at 1-28 in both the rental and private-financing
// paths, so the picker only offers days 1-28. The calendar renders the current
// month for familiarity, but no month navigation is offered: the day-of-month
// repeats every month, so any month picks the same recurring day.
const MAX_CHARGE_DAY = 28;
const WEEKDAY_HEADERS = ["S", "M", "T", "W", "T", "F", "S"];

function isSelectableDay(day) {
  return day >= 1 && day <= MAX_CHARGE_DAY;
}

/**
 * Props:
 * - value: current charge day (number).
 * - onChange(day): called with the picked day (1-28).
 * - suggestedDay: optional day-of-month (1-28) highlighted as the borrower's /
 *   tenant's due day. Pass null when the due day is not known; the picker then
 *   shows no highlight.
 * - inputName: name of the hidden input so the surrounding form submits the
 *   value exactly as the old number field did (no backend or API changes).
 */
export default function ChargeDayPicker({ value, onChange, suggestedDay = null, inputName = "chargeDay" }) {
  const [open, setOpen] = useState(false);
  const selected = Number(value) || 1;
  const suggestion = Number(suggestedDay) >= 1 && Number(suggestedDay) <= MAX_CHARGE_DAY
    ? Number(suggestedDay) : null;

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) { if (event.key === "Escape") setOpen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = new Date(year, month, 1).getDay();
  const cells = [];
  for (let i = 0; i < leadingBlanks; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);

  function pick(day) {
    onChange(day);
    setOpen(false);
  }

  return (
    <span className="relative block">
      <input type="hidden" name={inputName} value={selected} />
      <button type="button" onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog" aria-expanded={open}
        className="mt-1 flex w-full items-center justify-between rounded-xl border bg-white p-3 font-normal">
        <span>the {ordinalDayOfMonth(selected)} of each month</span>
        <span aria-hidden="true" className="text-slate-500">▾</span>
      </button>
      {open ? <>
        <button type="button" aria-label="Close calendar" onClick={() => setOpen(false)}
          className="fixed inset-0 z-10 cursor-default bg-transparent" />
        <div role="dialog" aria-label="Choose the charge day of the month"
          className="absolute z-20 mt-1 w-64 rounded-xl border bg-white p-3 shadow-lg">
          <p className="text-center text-sm font-bold">{monthLabel}</p>
          <div className="mt-2 grid grid-cols-7 gap-1 text-center text-xs">
            {WEEKDAY_HEADERS.map((header, index) => (
              <span key={`${header}-${index}`} className="font-bold text-slate-500">{header}</span>
            ))}
            {cells.map((day, index) => {
              if (day === null) return <span key={`blank-${index}`} />;
              if (!isSelectableDay(day)) {
                return (
                  <span key={day} aria-disabled="true"
                    title="Not available: the charge day must exist in every month"
                    className="cursor-not-allowed p-1.5 text-slate-300">{day}</span>
                );
              }
              const isSelected = day === selected;
              const isSuggested = day === suggestion;
              return (
                <button key={day} type="button" onClick={() => pick(day)}
                  aria-label={`Charge on the ${ordinalDayOfMonth(day)} of each month`}
                  aria-pressed={isSelected}
                  data-selected={isSelected || undefined}
                  data-due-day={isSuggested || undefined}
                  className={`rounded-full p-1.5 ${isSelected
                    ? "bg-slate-950 font-bold text-white"
                    : isSuggested
                      ? "font-bold ring-2 ring-amber-500"
                      : "hover:bg-slate-100"}`}>{day}</button>
              );
            })}
          </div>
          {suggestion ? (
            <p className="mt-2 text-xs text-slate-600">
              <span className="mr-1 inline-block h-2 w-2 rounded-full ring-2 ring-amber-500" aria-hidden="true" />
              Your due date is the {ordinalDayOfMonth(suggestion)} — tap it to match.
            </p>
          ) : null}
          <p className="mt-1 text-xs text-slate-500">
            Days 29–31 can&apos;t be charge days: they don&apos;t exist in every month.
          </p>
        </div>
      </> : null}
    </span>
  );
}
