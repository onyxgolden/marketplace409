// FORGE Brain conversation harness — plain-words rendering (A8).
//
// Memory-sourced answers cite what is remembered in plain terms: names and
// dates, never raw IDs. The renderer redacts UUID-shaped tokens and
// system-style ids (brain-*, owner-*, session-*) even if an owner pasted one
// into a memory, so a rendered answer can never leak a raw identifier.

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SYSTEM_ID_PATTERN = "\\b(?:brain|owner|session)_[A-Za-z0-9_-]+";

export function redactIds(text) {
  return String(text ?? "")
    .replace(new RegExp(UUID_PATTERN, "gi"), "[reference]")
    .replace(new RegExp(SYSTEM_ID_PATTERN, "g"), "[reference]");
}

export function containsRawId(text) {
  const value = String(text ?? "");
  return (
    new RegExp(UUID_PATTERN, "i").test(value) ||
    new RegExp(SYSTEM_ID_PATTERN).test(value)
  );
}

const plainDate = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

export function formatPlainDate(value) {
  if (!value) return "an unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "an unknown date";
  return plainDate.format(date);
}

function saliencePhrase(salience) {
  if (salience === "owner_stated") return "You told the Brain";
  if (salience === "verified") return "The Brain confirmed";
  return "The Brain noted, not yet confirmed";
}

export function renderMemoryPlainWords(entry) {
  const content = redactIds(entry?.content ?? "").trim();
  const when = formatPlainDate(entry?.provenanceAt ?? entry?.createdAt);
  return `${saliencePhrase(entry?.salience)}: ${content}. Noted on ${when}.`;
}

export function renderWorkingSetPlainWords(entries) {
  return (entries ?? []).map(renderMemoryPlainWords).join(" ");
}
