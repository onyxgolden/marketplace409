// Deterministic rendering for server-provided instants inside components
// that participate in SSR/hydration (React #418).
//
// `Date.prototype.toLocaleString()` formats in the *host* time zone, so a
// server rendering in UTC and a browser hydrating in America/Chicago can
// produce different text for the same timestamp — a hydration mismatch.
// This formatter pins ONE explicit time zone (America/Chicago, the owner's
// zone and the app's convention for user-facing dates), so the server and
// every client render byte-identical text regardless of the host time
// zone. The shape matches en-US `toLocaleString()` output (M/D/YYYY,
// h:mm:ss AM/PM), so existing displays do not change shape.
//
// This is the shared formatter for server-rendered initial dates: the
// broader follow-up (deterministic rendering for all server-rendered
// initial dates, e.g. Overview/Activity timestamps) should reuse it
// rather than adding another pinned formatter.
export const SERVER_INSTANT_TIME_ZONE = "America/Chicago";

const SERVER_INSTANT_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: SERVER_INSTANT_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

export function formatServerInstant(value) {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return SERVER_INSTANT_FORMATTER.format(date);
}
