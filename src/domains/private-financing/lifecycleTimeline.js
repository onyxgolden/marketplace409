// buildFinancingLifecycleSteps: pure mapping of a private-financing account's real
// lifecycle into StatusTimeline steps. The only statuses this schema records are the
// account lifecycle states (active, paid_off, written_off, cancelled) plus the opened
// date -- there are no applied/underwriting/approved application stages anywhere in
// the data, so this timeline never invents them. It renders the stages that exist:
// Originated -> Servicing -> terminal state.
const TERMINALS = {
  paid_off: { label: "Paid off", state: "complete" },
  written_off: { label: "Written off", state: "failed" },
  cancelled: { label: "Cancelled", state: "failed" },
};

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
 * @param {{ status?: string, openedDate?: string }} input
 * @returns {Array<{ label: string, state: "complete"|"current"|"upcoming"|"failed", detail?: string }>}
 */
export function buildFinancingLifecycleSteps({ status = "", openedDate = "" } = {}) {
  const opened = formatDay(openedDate);
  const terminal = TERMINALS[status];
  if (terminal) {
    return [
      { label: "Originated", state: "complete", ...(opened ? { detail: opened } : {}) },
      { label: "Servicing", state: "complete" },
      { label: terminal.label, state: terminal.state },
    ];
  }
  if (status && status !== "active") {
    // An unrecognized status is shown raw and current -- never force-fit into the chain.
    return [{ label: `Status: ${String(status).replaceAll("_", " ")}`, state: "current", detail: "This status is not part of the known account lifecycle." }];
  }
  return [
    { label: "Originated", state: "complete", ...(opened ? { detail: opened } : {}) },
    { label: "Servicing", state: "current", detail: "Payments are being collected against this account." },
  ];
}
