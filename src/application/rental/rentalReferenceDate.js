// One authoritative reference date for the Rental Manager Summary: the
// owner's local calendar date in America/Chicago.
//
// `new Date().toISOString()` is UTC, which is already the next day between
// 6:00 PM and midnight CST (7:00 PM and midnight CDT). A UTC reference date
// therefore lets month-to-date / year-to-date windows include a future local
// day and switch reporting periods hours too early at month/year boundaries.
// The Summary build (client and server) must derive its single `today` from
// here so server and browser cannot cross a boundary mid-render.
//
// `en-CA` formats as YYYY-MM-DD. Pass an explicit Date in tests to pin
// boundary conversions; the default is the current instant.
export const RENTAL_TIME_ZONE = "America/Chicago";

export function rentalReferenceDate(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: RENTAL_TIME_ZONE });
}
