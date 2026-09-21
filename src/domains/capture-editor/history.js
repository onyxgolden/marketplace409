// FORGE Capture editor — immutable undo/redo history.
// Session-only UI state: never serialized, never exported. Follows the shape of
// the scheduling board's history helpers (pure stack operations, frozen).

import { UNDO_DEPTH } from "./limits.js";

export const HISTORY_LIMIT = UNDO_DEPTH;

export function emptyHistory() {
  return Object.freeze({ past: Object.freeze([]), future: Object.freeze([]) });
}

// Records `previousDocument` (the state a discrete edit just replaced) and
// clears redo — any new edit invalidates whatever redo history existed.
export function commitHistory(history, previousDocument) {
  const past =
    history.past.length >= HISTORY_LIMIT
      ? [...history.past.slice(1), previousDocument]
      : [...history.past, previousDocument];
  return Object.freeze({ past: Object.freeze(past), future: Object.freeze([]) });
}

export function canUndo(history) {
  return history.past.length > 0;
}

export function canRedo(history) {
  return history.future.length > 0;
}

// Returns { history, document }: the document to restore (or currentDocument
// unchanged when there is nothing to undo) and the updated stacks.
export function undoHistory(history, currentDocument) {
  if (history.past.length === 0) return { history, document: currentDocument };
  const document = history.past[history.past.length - 1];
  const future =
    history.future.length >= HISTORY_LIMIT
      ? [currentDocument, ...history.future.slice(0, -1)]
      : [currentDocument, ...history.future];
  return {
    history: Object.freeze({
      past: Object.freeze(history.past.slice(0, -1)),
      future: Object.freeze(future),
    }),
    document,
  };
}

export function redoHistory(history, currentDocument) {
  if (history.future.length === 0) return { history, document: currentDocument };
  const document = history.future[0];
  const past =
    history.past.length >= HISTORY_LIMIT
      ? [...history.past.slice(1), currentDocument]
      : [...history.past, currentDocument];
  return {
    history: Object.freeze({
      past: Object.freeze(past),
      future: Object.freeze(history.future.slice(1)),
    }),
    document,
  };
}
