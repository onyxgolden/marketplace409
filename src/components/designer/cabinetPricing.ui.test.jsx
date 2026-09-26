// @vitest-environment jsdom

// Cabinet pricing UI: supplier dropdown + estimate, price list editing
// (price, item number, discontinued, CSV sheet), and the inspector line.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyDesign, placeFurniture, resizeFurniture, updateDesignSettings } from "@/domains/roomDesigner/designerDocument";
import { createBook, findItem, importPriceCsv } from "@/domains/roomDesigner/cabinetPriceBooks";
import { withSeeds } from "@/domains/roomDesigner/priceBookStorage";
import CabinetEstimateSection from "./CabinetEstimateSection";
import CabinetPriceLine from "./CabinetPriceLine";
import PriceBookEditor from "./PriceBookEditor";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// Test-only fixture list (made-up prices); real lists are private user data.
const BOOK = "test-supply";
const FIXTURE = importPriceCsv(
  { ...createBook({ supplier: "Test Supply", line: "Oak", asOf: "2024-03-19" }), id: BOOK },
  "code,name,item number,price\nW2430,W24 x 30 Wall Cabinet,T102,122.99\nB24,B24 Base Cabinet,T201,166.99\nSB36,SB36 Sink Base,T300,177.99\nW930,W9 x 30 Wall Cabinet,T100,74.99\n7UC1824,Pantry 18,T400,355.99\n7UC2424,Pantry 24,T401,413.99\n7UC3024,Pantry 30,T402,461.99\n8UC2424,Pantry 24 tall,T403,549.99\nCROWN,Crown Moulding,T900,43.99",
).book;
const books = () => withSeeds([JSON.parse(JSON.stringify(FIXTURE))]);
function kitchen(withSupplier = true) {
  let d = createEmptyDesign("Kitchen");
  d = placeFurniture(d, "cabinet-wall-24", 0, 0);
  d = resizeFurniture(d, d.furniture[0].id, 24, 12, 30); // W2430
  d = placeFurniture(d, "cabinet-sink-36", 0, 60); // SB36
  return withSupplier ? updateDesignSettings(d, { cabinetPriceBookId: BOOK }) : d;
}
const q = (sel) => container.querySelector(sel);
const byLabel = (l) => q(`[aria-label="${l}"]`);
function change(el, value, type) {
  const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, type === "checked" ? "checked" : "value").set.call(el, value);
    el.dispatchEvent(new Event(type === "checked" ? "click" : el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}

describe("CabinetEstimateSection", () => {
  it("asks for a supplier, and saves the choice with the design", () => {
    const dispatch = vi.fn();
    act(() => root.render(<CabinetEstimateSection design={kitchen(false)} dispatch={dispatch} books={books()} onSaveBook={vi.fn()} onDeleteBook={vi.fn()} />));
    expect(q('[aria-label="Priced cabinets"]')).toBeNull();
    change(byLabel("Cabinet supplier"), BOOK);
    expect(dispatch).toHaveBeenCalledWith({ type: "UPDATE_SETTINGS", settings: { cabinetPriceBookId: BOOK } });
  });

  it("prices every cabinet by code and totals it", () => {
    act(() => root.render(<CabinetEstimateSection design={kitchen()} dispatch={vi.fn()} books={books()} onSaveBook={vi.fn()} onDeleteBook={vi.fn()} />));
    const rows = [...q('[aria-label="Priced cabinets"]').querySelectorAll("tr")].map((r) => r.textContent);
    expect(rows).toEqual(["SB361 × $177.99$177.99", "W24301 × $122.99$122.99"]);
    expect(container.textContent).toContain("Prices as of 2024-03-19");
    expect(container.textContent).toContain("Total (before tax)$300.98");
  });

  it("calls out cabinets the list can't price instead of counting $0", () => {
    let d = kitchen();
    d = placeFurniture(d, "cabinet-wall-24", 0, 120); // W2436: not on the list
    act(() => root.render(<CabinetEstimateSection design={d} dispatch={vi.fn()} books={books()} onSaveBook={vi.fn()} onDeleteBook={vi.fn()} />));
    expect(q('[aria-label="Cabinets not priced"]').textContent).toContain("W2436 ×1 — not on this supplier's list");
    expect(container.textContent).toContain("Total leaves out the cabinets listed above.");
  });
});

describe("PriceBookEditor", () => {
  function open() {
    const onChange = vi.fn();
    act(() => root.render(<PriceBookEditor book={books()[0]} onChange={onChange} onClose={vi.fn()} />));
    return onChange;
  }
  const blurWith = (el, value) => {
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, value);
      el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
  };

  it("updates a price and an item number", () => {
    const onChange = open();
    blurWith(byLabel("Price for B24"), "172.50");
    expect(findItem(onChange.mock.calls.at(-1)[0], "B24").priceCents).toBe(17250);
    blurWith(byLabel("Item number for B24"), "6000001");
    expect(findItem(onChange.mock.calls.at(-1)[0], "B24").sku).toBe("6000001");
  });

  it("rejects an unreadable price with a message", () => {
    const onChange = open();
    blurWith(byLabel("Price for B24"), "abc");
    expect(onChange).not.toHaveBeenCalled();
    expect(q('[role="alert"]').textContent).toMatch(/Can't read "abc"/);
  });

  it("marks an item discontinued", () => {
    const onChange = open();
    act(() => byLabel("W930 discontinued").click());
    expect(findItem(onChange.mock.calls.at(-1)[0], "W930").discontinued).toBe(true);
  });

  it("applies a pasted price sheet", () => {
    const onChange = open();
    change(byLabel("Price sheet CSV"), "code,price\nB24,180.00\nW3930,175");
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Apply sheet").click());
    const next = onChange.mock.calls.at(-1)[0];
    expect(findItem(next, "B24").priceCents).toBe(18000);
    expect(findItem(next, "W3930").kind).toBe("cabinet");
    expect(q('[role="status"]').textContent).toBe("Updated 1, added 1.");
  });

  it("filters the list", () => {
    open();
    change(byLabel("Filter price list"), "pantry");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(4);
  });
});

describe("CabinetPriceLine", () => {
  it("shows the code and the supplier's price for this cabinet", () => {
    const d = kitchen();
    act(() => root.render(<CabinetPriceLine piece={d.furniture[0]} design={d} dispatch={vi.fn()} books={books()} />));
    expect(container.textContent).toContain("W2430");
    expect(container.textContent).toContain("W24 x 30 Wall Cabinet · #T102 · $122.99");
  });

  it("renders nothing for a non-cabinet", () => {
    const d = placeFurniture(createEmptyDesign(), "sofa-3seat", 0, 0);
    act(() => root.render(<CabinetPriceLine piece={d.furniture[0]} design={d} dispatch={vi.fn()} books={books()} />));
    expect(container.innerHTML).toBe("");
  });
});

describe("CabinetEstimateSection — new lists, sync status, saved estimates", () => {
  it("creates a new supplier list, selects it and opens the editor", () => {
    const dispatch = vi.fn();
    const onSaveBook = vi.fn();
    act(() => root.render(<CabinetEstimateSection design={kitchen(false)} dispatch={dispatch} books={books()} onSaveBook={onSaveBook} onDeleteBook={vi.fn()} />));
    change(byLabel("Cabinet supplier"), "__new__");
    change(byLabel("Supplier name"), "Acme Supply");
    change(byLabel("Product line"), "Oak");
    act(() => q('form[aria-label="New supplier price list"]').dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const created = onSaveBook.mock.calls[0][0];
    expect(created).toMatchObject({ supplier: "Acme Supply", line: "Oak", items: [] });
    expect(dispatch).toHaveBeenCalledWith({ type: "UPDATE_SETTINGS", settings: { cabinetPriceBookId: created.id } });
  });

  it("says when price lists are only saved on this device", () => {
    act(() => root.render(<CabinetEstimateSection design={kitchen()} dispatch={vi.fn()} books={books()} status="local" onSaveBook={vi.fn()} onDeleteBook={vi.fn()} />));
    expect(container.textContent).toContain("Saved on this device only");
  });

  it("saves a snapshot estimate and lists saved ones", () => {
    const dispatch = vi.fn();
    const d = { ...kitchen(), cabinetEstimates: [{ id: "e1", savedAt: "2025-02-01T12:00:00.000Z", supplier: "Test Supply", line: "Oak", asOf: "2024-03-19", lines: [], accessories: [], issues: [], cabinetsCents: 0, accessoriesCents: 0, totalCents: 30098 }] };
    act(() => root.render(<CabinetEstimateSection design={d} dispatch={dispatch} books={books()} onSaveBook={vi.fn()} onDeleteBook={vi.fn()} />));
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent.startsWith("Save estimate")).click());
    expect(dispatch.mock.calls.at(-1)[0]).toMatchObject({ type: "SAVE_CABINET_ESTIMATE", snapshot: { supplier: "Test Supply", totalCents: 30098 } });
    expect(q('[aria-label="Saved estimates"]').textContent).toContain("$300.98");
    act(() => byLabel("Delete saved estimate").click());
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Delete?").click());
    expect(dispatch).toHaveBeenLastCalledWith({ type: "DELETE_CABINET_ESTIMATE", snapshotId: "e1" });
  });
});
