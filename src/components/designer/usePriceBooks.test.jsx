// @vitest-environment jsdom

// usePriceBooks — account is the source of truth; localStorage is a cache;
// local-only edits are carried over once; failed writes retry and say so.

import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBook, updateItem } from "@/domains/roomDesigner/cabinetPriceBooks";
import { priceBookStorageKey } from "@/domains/roomDesigner/priceBookStorage";
import usePriceBooks from "./usePriceBooks";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
// Latest hook result, captured after each render (not during it).
const probe = { current: null };
function Probe({ fetchImpl }) {
  const result = usePriceBooks("u1", { fetchImpl });
  useEffect(() => {
    probe.current = result;
  });
  return null;
}
beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

const ok = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const acme = () => ({ ...createBook({ supplier: "Acme", line: "Oak" }), id: "acme" });

describe("usePriceBooks", () => {
  it("loads the account's lists (plus the sample) and reports synced", async () => {
    const fetchImpl = vi.fn(() => ok({ books: [acme()] }));
    act(() => root.render(<Probe fetchImpl={fetchImpl} />));
    await settle();
    expect(probe.current.books.map((b) => b.id)).toEqual(["acme", "sample-stock-cabinets"]);
    expect(probe.current.status).toBe("synced");
  });

  it("uploads a list that exists only in this browser, once", async () => {
    window.localStorage.setItem(priceBookStorageKey("u1"), JSON.stringify({ version: 1, books: [acme()] }));
    const fetchImpl = vi.fn((url, opts) => (opts?.method === "PUT" ? ok({ success: true }) : ok({ books: [] })));
    act(() => root.render(<Probe fetchImpl={fetchImpl} />));
    await settle();
    const puts = fetchImpl.mock.calls.filter(([, o]) => o?.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(JSON.parse(puts[0][1].body).book.id).toBe("acme");
    expect(probe.current.status).toBe("synced");
  });

  it("keeps working locally when the account can't be reached, then retries on the next change", async () => {
    let online = false;
    const fetchImpl = vi.fn((url, opts) => {
      if (!online) return Promise.reject(new Error("offline"));
      return opts?.method === "PUT" ? ok({ success: true }) : ok({ books: [] });
    });
    act(() => root.render(<Probe fetchImpl={fetchImpl} />));
    await settle();
    expect(probe.current.status).toBe("local");
    await act(async () => { await probe.current.saveBook(acme()); });
    expect(probe.current.status).toBe("local");
    expect(JSON.parse(window.localStorage.getItem(priceBookStorageKey("u1"))).books.some((b) => b.id === "acme")).toBe(true);
    online = true;
    await act(async () => { await probe.current.saveBook(updateItem({ ...acme(), items: [{ code: "B24", name: "B24", sku: "", priceCents: 100, kind: "cabinet" }] }, "B24", { priceCents: 200 })); });
    expect(probe.current.status).toBe("synced");
  });

  it("deletes a list on the account", async () => {
    const fetchImpl = vi.fn((url, opts) => (opts?.method === "DELETE" ? ok({ success: true }) : ok({ books: [acme()] })));
    act(() => root.render(<Probe fetchImpl={fetchImpl} />));
    await settle();
    await act(async () => { await probe.current.deleteBook("acme"); });
    expect(probe.current.books.map((b) => b.id)).toEqual(["sample-stock-cabinets"]);
    expect(fetchImpl.mock.calls.some(([u, o]) => o?.method === "DELETE" && u.endsWith("?id=acme"))).toBe(true);
  });
});
