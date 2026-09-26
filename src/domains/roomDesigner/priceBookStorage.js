// Local, per-user persistence for supplier cabinet price books.
//
// Same pattern as the custom-shape library (customShapeStorage.js): a
// versioned localStorage key scoped to the signed-in user, a defensive read
// that never throws, and a write that reports failure instead of throwing.
//
// The user's copy of a book (with their price / item-number / discontinued
// edits) always wins over the seed. A seed book the user doesn't have yet
// is added on load, so new supplier lists ship without wiping anyone's
// edits. "Reset to printed list" is resetBookToSeed.

import { PRICE_BOOK_VERSION, SEED_PRICE_BOOKS, normalizeBook } from "./cabinetPriceBooks";

export const PRICE_BOOK_STORAGE_KEY = "forge-designer.price-books.v1";

export function priceBookStorageKey(userId) {
  return typeof userId === "string" && userId ? `${PRICE_BOOK_STORAGE_KEY}.user.${userId}` : PRICE_BOOK_STORAGE_KEY;
}

const seedCopy = (seed) => normalizeBook(JSON.parse(JSON.stringify(seed)));

/** Books plus any seed book they don't already include (seeds last). */
export function withSeeds(books) {
  const ids = new Set(books.map((b) => b.id));
  return [...books, ...SEED_PRICE_BOOKS.filter((s) => !ids.has(s.id)).map(seedCopy)];
}

/** True when a book is exactly its untouched seed (nothing worth uploading). */
export function isUneditedSeed(book) {
  const seed = SEED_PRICE_BOOKS.find((s) => s.id === book?.id);
  return !!seed && JSON.stringify(seedCopy(seed)) === JSON.stringify(normalizeBook(book));
}

/** Parse a stored payload into [books]; seeds fill in anything missing. Never throws. */
export function parsePriceBooks(raw) {
  let stored = [];
  try {
    const parsed = typeof raw === "string" && raw ? JSON.parse(raw) : null;
    if (parsed && parsed.version === PRICE_BOOK_VERSION && Array.isArray(parsed.books)) {
      stored = parsed.books.map(normalizeBook).filter(Boolean);
    }
  } catch {
    stored = [];
  }
  const ids = new Set(stored.map((b) => b.id));
  return [...stored, ...SEED_PRICE_BOOKS.filter((s) => !ids.has(s.id)).map(seedCopy)];
}

export function loadPriceBooks(storage = defaultStorage(), userId = null) {
  if (!storage) return parsePriceBooks(null);
  try {
    return parsePriceBooks(storage.getItem(priceBookStorageKey(userId)));
  } catch {
    return parsePriceBooks(null);
  }
}

/** Returns true on success, false when storage refused (edits still apply in memory). */
export function savePriceBooks(books, storage = defaultStorage(), userId = null) {
  if (!storage) return false;
  try {
    storage.setItem(priceBookStorageKey(userId), JSON.stringify({ version: PRICE_BOOK_VERSION, books }));
    return true;
  } catch {
    return false;
  }
}

/** The printed seed for a book id, as a fresh editable copy; null when there is none. */
export function resetBookToSeed(bookId) {
  const seed = SEED_PRICE_BOOKS.find((s) => s.id === bookId);
  return seed ? seedCopy(seed) : null;
}

function defaultStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
