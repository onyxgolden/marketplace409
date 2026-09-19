// buildReservationLifecycleSteps: pure mapping of a reservation's real lifecycle into
// StatusTimeline steps. Stages come only from the immutable reservation_events history
// (created, confirmed, checked_in, checked_out, cancelled, expired) and the reservation's
// current status -- never invented. A cancelled/expired reservation ends the chain with a
// "failed" terminal step instead of pretending the remaining stages happened.
const STAGES = [
  { key: "created", label: "Requested" },
  { key: "confirmed", label: "Confirmed" },
  { key: "checked_in", label: "Checked in" },
  { key: "checked_out", label: "Checked out" },
];
const TERMINALS = { cancelled: "Cancelled", expired: "Expired" };

// The furthest stage the status alone implies, even when no events were recorded.
const STATUS_REACH = { held: 0, confirmed: 1, checked_in: 2, checked_out: 3 };

function formatDay(iso) {
  // Date-only values ("2026-01-15") keep their calendar date: Date.parse treats
  // them as UTC midnight, which renders as the previous day in US timezones.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  return new Date(time).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * @param {{ status?: string, events?: Array<{ event_type?: string, occurred_at?: string }> }} input
 * @returns {Array<{ label: string, state: "complete"|"current"|"upcoming"|"failed", detail?: string }>}
 */
export function buildReservationLifecycleSteps({ status = "", events = [] } = {}) {
  const terminal = TERMINALS[status];
  const eventDates = {};
  for (const event of Array.isArray(events) ? events : []) {
    const key = event?.event_type;
    if (STAGES.some(stage => stage.key === key) && event?.occurred_at && !eventDates[key]) {
      eventDates[key] = event.occurred_at;
    }
  }
  const reach = Math.max(
    ...STAGES.map((stage, index) => (eventDates[stage.key] ? index : -1)),
    STATUS_REACH[status] ?? -1,
  );
  if (reach < 0 && !terminal) {
    return [{ label: status ? `Status: ${String(status).replaceAll("_", " ")}` : "Status unknown", state: "current", detail: "No lifecycle stages were recorded for this reservation." }];
  }
  const finished = status === "checked_out" || Boolean(terminal);
  // A terminal status with no recorded events is honest about the gap: only the
  // terminal step is shown, with no invented earlier stages.
  const steps = [];
  if (!(terminal && reach < 0)) {
    for (const [index, stage] of STAGES.filter((_, index) => index <= Math.max(reach, 0)).entries()) {
      const state = finished ? "complete" : index === reach ? "current" : "complete";
      const day = eventDates[stage.key];
      steps.push({ label: stage.label, state, ...(day ? { detail: formatDay(day) } : {}) });
    }
  }
  if (terminal) {
    const day = (Array.isArray(events) ? events : []).find(event => event?.event_type === status)?.occurred_at;
    steps.push({ label: terminal, state: "failed", ...(day ? { detail: formatDay(day) } : {}) });
  } else if (status !== "checked_out") {
    // Forward stages we know have not happened yet stay honest "upcoming" steps.
    for (let index = steps.length; index < STAGES.length; index += 1) {
      steps.push({ label: STAGES[index].label, state: "upcoming" });
    }
  }
  return steps;
}
