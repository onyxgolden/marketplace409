// FORGE Chart Builder — immutable undo/redo command history (slice 1).
// Shape: { past, present, future }. Each stack entry is
// { action, before, after } where before/after are ChartDocuments.
// Committing a new action clears the redo stack, mirroring the
// capture-editor history convention.

export const CHART_HISTORY_LIMIT = 100;

export function emptyChartHistory(initialPresent) {
  return Object.freeze({
    past: Object.freeze([]),
    present: initialPresent ?? null,
    future: Object.freeze([]),
  });
}

export function commitChartAction(history, action, newPresent) {
  if (!history || typeof history !== "object") {
    throw new Error("commitChartAction requires a chart history");
  }
  const entry = Object.freeze({
    action,
    before: history.present,
    after: newPresent,
  });
  const past =
    history.past.length >= CHART_HISTORY_LIMIT
      ? [...history.past.slice(1), entry]
      : [...history.past, entry];
  return Object.freeze({
    past: Object.freeze(past),
    present: newPresent,
    future: Object.freeze([]),
  });
}

export function canUndoChart(history) {
  return history.past.length > 0;
}

export function canRedoChart(history) {
  return history.future.length > 0;
}

// Returns { history, present }: the document to restore plus updated stacks.
export function undoChart(history) {
  if (history.past.length === 0) {
    return { history, present: history.present };
  }
  const entry = history.past[history.past.length - 1];
  const future =
    history.future.length >= CHART_HISTORY_LIMIT
      ? [entry, ...history.future.slice(0, -1)]
      : [entry, ...history.future];
  return {
    history: Object.freeze({
      past: Object.freeze(history.past.slice(0, -1)),
      present: entry.before,
      future: Object.freeze(future),
    }),
    present: entry.before,
  };
}

export function redoChart(history) {
  if (history.future.length === 0) {
    return { history, present: history.present };
  }
  const entry = history.future[0];
  const past =
    history.past.length >= CHART_HISTORY_LIMIT
      ? [...history.past.slice(1), entry]
      : [...history.past, entry];
  return {
    history: Object.freeze({
      past: Object.freeze(past),
      present: entry.after,
      future: Object.freeze(history.future.slice(1)),
    }),
    present: entry.after,
  };
}
