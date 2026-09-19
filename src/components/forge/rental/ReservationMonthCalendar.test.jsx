// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReservationMonthCalendar from "./ReservationMonthCalendar.jsx";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}
function unmount({ container, root }) {
  act(() => { root.unmount(); });
  container.remove();
}

const DAY_MS = 86_400_000;
function iso(offset) {
  const date = new Date(Date.now() + offset * DAY_MS);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
function fullDayLabel(isoDate) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function findDay(container, isoDate) {
  return [...container.querySelectorAll("button[role='gridcell']")].find(button => (button.getAttribute("aria-label") || "").startsWith(fullDayLabel(isoDate)));
}
function goToNextMonth(container) {
  act(() => { container.querySelector('button[aria-label="Next month"]').click(); });
}

const RESERVATIONS = [
  { id: "r1", unit_id: "u1", check_in_date: iso(5), check_out_date: iso(8), status: "confirmed" },
  { id: "r2", unit_id: "u2", check_in_date: iso(6), check_out_date: iso(7), status: "confirmed" },
  { id: "r3", unit_id: "u1", check_in_date: iso(9), check_out_date: iso(10), status: "cancelled" },
];

describe("ReservationMonthCalendar", () => {
  let mounted;
  afterEach(() => { if (mounted) { unmount(mounted); mounted = null; } });

  it("shades booked nights for the selected unit only, and never shades cancelled stays", () => {
    mounted = mount(<ReservationMonthCalendar reservations={RESERVATIONS} unitId="u1" onSelect={() => {}} />);
    const reserved = [...mounted.container.querySelectorAll("button[role='gridcell']")].filter(button => (button.getAttribute("aria-label") || "").includes("reserved"));
    expect(reserved.length).toBeGreaterThan(0);
    // r1 occupies nights 5, 6, 7 for u1; r2 is u2's night; r3 was cancelled.
    expect(findDay(mounted.container, iso(5)).getAttribute("aria-label")).toContain("reserved");
    expect(findDay(mounted.container, iso(6)).getAttribute("aria-label")).toContain("reserved");
    expect(findDay(mounted.container, iso(9)).getAttribute("aria-label")).not.toContain("reserved");
  });

  it("picks a check-in then a check-out through onSelect, date-first", () => {
    const onSelect = vi.fn();
    mounted = mount(<ReservationMonthCalendar reservations={[]} unitId="" checkIn="" checkOut="" onSelect={onSelect} />);
    // Navigate to next month so both picked dates are guaranteed in-month cells.
    goToNextMonth(mounted.container);
    const now = new Date();
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const start = iso(daysInMonth - now.getUTCDate() + 5), end = iso(daysInMonth - now.getUTCDate() + 8);
    const startButton = findDay(mounted.container, start);
    expect(startButton).toBeTruthy();
    act(() => { startButton.click(); });
    expect(onSelect).toHaveBeenCalledWith(start, "");
    // Parent would re-render with checkIn set; simulate it. The calendar initializes
    // its visible month from checkIn, so no navigation is needed this time.
    unmount(mounted);
    mounted = mount(<ReservationMonthCalendar reservations={[]} unitId="" checkIn={start} checkOut="" onSelect={onSelect} />);
    const endButton = findDay(mounted.container, end);
    expect(endButton).toBeTruthy();
    act(() => { endButton.click(); });
    expect(onSelect).toHaveBeenCalledWith(start, end);
  });

  it("disables past days so they cannot be picked", () => {
    mounted = mount(<ReservationMonthCalendar reservations={[]} unitId="" onSelect={() => {}} />);
    const past = [...mounted.container.querySelectorAll("button[role='gridcell'][disabled]")];
    expect(past.length).toBeGreaterThan(0);
  });
});
