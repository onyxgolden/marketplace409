"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isUneditedSeed,
  loadPriceBooks,
  parsePriceBooks,
  savePriceBooks,
  withSeeds,
} from "@/domains/roomDesigner/priceBookStorage";

const API = "/api/forge/designer/price-books";

/**
 * The signed-in user's supplier price books.
 *
 * Source of truth is the account (designer_price_books via the API), so a
 * price list follows the user across phone, laptop and desktop and survives
 * cleared browser data. localStorage is only a cache: it paints instantly on
 * load and keeps edits usable offline. On load, any book that exists only in
 * this browser (edited before sync existed, or while offline) is uploaded
 * once. A write that fails stays "pending" and is retried with the next
 * change, and the status says so — nothing is silently lost.
 *
 * status: "loading" | "synced" | "saving" | "local" (server unreachable —
 * edits are on this device only for now)
 */
export default function usePriceBooks(userId, { fetchImpl } = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  const fetchRef = useRef(doFetch);
  fetchRef.current = doFetch;
  const [books, setBooks] = useState(() => parsePriceBooks(null));
  const [status, setStatus] = useState("loading");
  const booksRef = useRef(books);
  const pending = useRef(new Map()); // id -> "put" | "delete"

  const commitLocal = useCallback(
    (next) => {
      booksRef.current = next;
      setBooks(next);
      savePriceBooks(next, undefined, userId);
    },
    [userId],
  );

  const flush = useCallback(async () => {
    if (pending.current.size === 0) return true;
    setStatus("saving");
    for (const [id, op] of [...pending.current]) {
      try {
        const res =
          op === "delete"
            ? await fetchRef.current(`${API}?id=${encodeURIComponent(id)}`, { method: "DELETE" })
            : await fetchRef.current(API, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ book: booksRef.current.find((b) => b.id === id) }),
              });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        pending.current.delete(id);
      } catch {
        setStatus("local");
        return false;
      }
    }
    setStatus("synced");
    return true;
  }, []);

  // Restore: cache first (instant), then the account.
  useEffect(() => {
    let cancelled = false;
    const local = loadPriceBooks(undefined, userId);
    booksRef.current = local;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore of a value from an external store (localStorage) on mount.
    setBooks(local);
    (async () => {
      try {
        const res = await fetchRef.current(API);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { books: server = [] } = await res.json();
        if (cancelled) return;
        const serverIds = new Set(server.map((b) => b.id));
        const localOnly = local.filter((b) => !serverIds.has(b.id) && !isUneditedSeed(b));
        for (const b of localOnly) pending.current.set(b.id, "put");
        const merged = withSeeds([...server, ...localOnly]);
        booksRef.current = merged;
        setBooks(merged);
        savePriceBooks(merged, undefined, userId);
        if (localOnly.length) await flush();
        else setStatus("synced");
      } catch {
        if (!cancelled) setStatus("local");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, flush]);

  /** Create or replace one book (edits, CSV sheets, resets, new lists). */
  const saveBook = useCallback(
    (book) => {
      const exists = booksRef.current.some((b) => b.id === book.id);
      commitLocal(exists ? booksRef.current.map((b) => (b.id === book.id ? book : b)) : [...booksRef.current, book]);
      pending.current.set(book.id, "put");
      return flush();
    },
    [commitLocal, flush],
  );

  /** Remove a book (seed books come back as untouched samples). */
  const deleteBook = useCallback(
    (id) => {
      commitLocal(withSeeds(booksRef.current.filter((b) => b.id !== id)));
      pending.current.set(id, "delete");
      return flush();
    },
    [commitLocal, flush],
  );

  return { books, status, saveBook, deleteBook };
}
