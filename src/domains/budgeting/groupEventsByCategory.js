// Groups a flat list of expense events (each carrying normalizedCategory) into a Map keyed by that
// category, so a caller can run computeCategorySuggestion once per category in a single pass.
export function groupEventsByCategory(events) {
  const grouped = new Map();
  for (const event of events) {
    const category = event.normalizedCategory;
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category).push(event);
  }
  return grouped;
}
