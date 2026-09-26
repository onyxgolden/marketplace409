// cabinetPriceBooks.test.js — supplier price lists, cabinet codes, and the kitchen estimate.

import { describe, expect, it } from "vitest";
import { createEmptyDesign, placeFurniture, resizeFurniture } from "./designerDocument";
import { listCatalog } from "./furnitureCatalog";
import { SIZE_FAMILIES } from "./furnitureSizing";
import { cabinetCode, codedCatalogIds } from "./cabinetCodes";
import {
  SEED_PRICE_BOOKS,
  addItem,
  addSavedEstimate,
  createBook,
  removeSavedEstimate,
  snapshotEstimate,
  cabinetEstimate,
  cabinetEstimateCsv,
  exportPriceCsv,
  findItem,
  importPriceCsv,
  normalizeBook,
  parsePriceToCents,
  priceCabinet,
  removeItem,
  setAsOf,
  updateItem,
} from "./cabinetPriceBooks";
import { isUneditedSeed, loadPriceBooks, parsePriceBooks, resetBookToSeed, savePriceBooks, withSeeds } from "./priceBookStorage";

// Test-only fixture: a made-up supplier list (prices are test data, not
// real pricing). Real supplier lists are private per-user data.
const FIXTURE_CSV = [
  "code,name,item number,price",
  "W930,W9 x 30 Wall Cabinet,T100,74.99",
  "W2130,W21 x 30 Wall Cabinet,T101,115.99",
  "W2430,W24 x 30 Wall Cabinet,T102,122.99",
  "B21,B21 Base Cabinet,T200,160.99",
  "B24,B24 Base Cabinet,T201,166.99",
  "B27,B27 Base Cabinet,T202,180.99",
  "SB36,SB36 Sink Base,T300,177.99",
  "LS36,LS36 Lazy Susan,T301,339.99",
  "CROWN,Crown Moulding,T900,43.99",
  "TOEKICK,Toe Kick,T901,13.99",
].join("\n");
const book = () => importPriceCsv({ ...createBook({ supplier: "Test Supply", line: "Oak", asOf: "2024-03-19" }, () => 0.5), id: "test-supply" }, FIXTURE_CSV).book;
const place = (d, id, w, depth, h) => {
  let next = placeFurniture(d, id, 0, 0);
  if (w) next = resizeFurniture(next, next.furniture.at(-1).id, w, depth, h);
  return next;
};

describe("cabinet codes (supplier naming convention)", () => {
  const code = (id, w, d, h) => cabinetCode(place(createEmptyDesign(), id, w, d, h).furniture[0]);

  it("follows the piece's actual size", () => {
    expect(code("cabinet-wall-24")).toBe("W2436");
    expect(code("cabinet-wall-24", 24, 12, 30)).toBe("W2430");
    expect(code("cabinet-wall-24", 36, 24, 24)).toBe("W362424");
    expect(code("cabinet-base-24", 21, 24, 35)).toBe("B21");
    expect(code("cabinet-sink-36", 60, 24, 34)).toBe("CSB60");
    expect(code("cabinet-pantry-24", 18, 24, 84)).toBe("7UC1824");
    expect(code("cabinet-pantry-24", 24, 24, 96)).toBe("8UC2424");
    expect(code("cabinet-base-blind-rh", 39, 24, 34)).toBe("BBC39RH");
    expect(code("sofa-3seat")).toBeNull();
  });

  it("gives every cabinet type a code", () => {
    const cabinets = listCatalog().filter((e) => e.category === "cabinets").map((e) => e.id).sort();
    expect([...codedCatalogIds()].sort()).toEqual(cabinets);
  });

  it("can reach every cabinet code in the sample list using standard sizes", () => {
    const reachable = new Set();
    for (const e of listCatalog().filter((x) => x.category === "cabinets")) {
      const fam = SIZE_FAMILIES[e.sizeFamily];
      for (const w of fam.widths) for (const d of fam.depths) for (const h of fam.heights) {
        reachable.add(cabinetCode({ catalogId: e.id, widthIn: w, depthIn: d, heightIn: h }));
      }
    }
    const missing = SEED_PRICE_BOOKS[0].items.filter((i) => i.kind === "cabinet" && !reachable.has(i.code)).map((i) => i.code);
    expect(missing).toEqual([]);
  });
});

describe("sample price list shipped in code", () => {
  it("has standard codes but no prices, item numbers or supplier names — pricing is private user data", () => {
    const [sample] = SEED_PRICE_BOOKS;
    expect(sample.id).toBe("sample-stock-cabinets");
    expect(sample.items.length).toBeGreaterThan(60);
    for (const i of sample.items) {
      expect(i.priceCents, i.code).toBeNull();
      expect(i.sku, i.code).toBe("");
    }
    expect(findItem(sample, "W2430")).toMatchObject({ kind: "cabinet", name: 'Wall cabinet 24" x 30"' });
  });

  it("prices nothing until the user enters prices", () => {
    const d = place(createEmptyDesign(), "cabinet-base-24");
    const sample = normalizeBook(JSON.parse(JSON.stringify(SEED_PRICE_BOOKS[0])));
    expect(priceCabinet(sample, d.furniture[0]).status).toBe("no-price");
  });
});

describe("new supplier lists", () => {
  it("creates an empty named list and fills it from a pasted sheet", () => {
    const b = createBook({ supplier: " Acme  Cabinets ", line: "Oak", asOf: "2025-01-31" }, () => 0.123456);
    expect(b).toMatchObject({ supplier: "Acme Cabinets", line: "Oak", asOf: "2025-01-31", items: [] });
    expect(b.id).toMatch(/^acme-cabinets-oak-/);
    expect(() => createBook({ supplier: "" })).toThrow(/name/);
    expect(importPriceCsv(b, FIXTURE_CSV).book.items).toHaveLength(10);
  });
});

describe("editing prices, item numbers, discontinued", () => {
  it("updates a price and an item number without losing the match", () => {
    let b = updateItem(book(), "W2430", { priceCents: 12999, sku: "6001234" });
    const d = place(createEmptyDesign(), "cabinet-wall-24", 24, 12, 30);
    expect(priceCabinet(b, d.furniture[0])).toMatchObject({ status: "priced", item: { sku: "6001234", priceCents: 12999 } });
    b = updateItem(b, "W2430", { discontinued: true });
    expect(priceCabinet(b, d.furniture[0]).status).toBe("discontinued");
    b = updateItem(b, "W2430", { discontinued: false });
    expect(priceCabinet(b, d.furniture[0]).status).toBe("priced");
  });

  it("adds, removes, dates, and validates", () => {
    let b = addItem(book(), { code: "w3930", name: "W39 x 30 Wall Cabinet", sku: "7", priceCents: 17000 });
    expect(findItem(b, "W3930")).toBeTruthy();
    expect(() => addItem(b, { code: "W3930" })).toThrow(/already/);
    b = removeItem(b, "W3930");
    expect(findItem(b, "W3930")).toBeNull();
    expect(setAsOf(b, "2025-02-01").asOf).toBe("2025-02-01");
    expect(() => setAsOf(b, "Feb 1")).toThrow();
    expect(() => updateItem(b, "B24", { priceCents: -5 })).toThrow(/Price/);
    expect(parsePriceToCents("$1,234.5")).toBe(123450);
    expect(parsePriceToCents("abc")).toBeNull();
  });

  it("applies a new price sheet from CSV: updates, adds, discontinues, reports bad rows", () => {
    const csv = [
      "Code,Item Number,Price,Discontinued",
      "B24,T201,$172.99,",
      "W930,,,yes",
      "W3930,T999,175.00,",
      "B27,,twelve,",
    ].join("\n");
    const { book: b, updated, added, errors } = importPriceCsv(book(), csv);
    expect(findItem(b, "B24").priceCents).toBe(17299);
    expect(findItem(b, "W930").discontinued).toBe(true);
    expect(findItem(b, "W930").priceCents).toBe(7499); // blank price cell leaves it alone
    expect(findItem(b, "W3930")).toMatchObject({ kind: "cabinet", sku: "T999", priceCents: 17500 });
    expect([updated, added]).toEqual([2, 1]);
    expect(errors[0]).toMatch(/B27/);
  });

  it("round-trips through export and import", () => {
    const b = updateItem(book(), "LS36", { priceCents: 34999 });
    const back = importPriceCsv(normalizeBook({ ...book(), items: [] }), exportPriceCsv(b)).book;
    expect(back.items).toEqual(b.items);
  });
});

describe("kitchen cabinet estimate", () => {
  function kitchen() {
    let d = createEmptyDesign("Kitchen");
    d = place(d, "cabinet-wall-24", 21, 12, 30);
    d = place(d, "cabinet-wall-24", 24, 12, 30);
    d = place(d, "cabinet-wall-24", 24, 12, 30);
    d = place(d, "cabinet-base-24", 21, 24, 35);
    d = place(d, "cabinet-sink-36");
    d = place(d, "cabinet-wall-24", 25, 12, 30); // W2530: not on the list
    d = place(d, "sofa-3seat"); // not a cabinet
    return d;
  }

  it("groups priced cabinets by code, lists what can't be priced, adds accessories", () => {
    const est = cabinetEstimate(kitchen(), book(), { TOEKICK: 2, CROWN: 1 });
    expect(est.lines.map((l) => [l.code, l.qty, l.extCents])).toEqual([
      ["B21", 1, 16099],
      ["SB36", 1, 17799],
      ["W2130", 1, 11599],
      ["W2430", 2, 24598],
    ]);
    expect(est.issues).toEqual([{ code: "W2530", status: "not-in-list", name: "", qty: 1 }]);
    expect(est.accessoriesCents).toBe(2 * 1399 + 4399);
    expect(est.totalCents).toBe(16099 + 17799 + 11599 + 24598 + 2 * 1399 + 4399);
    expect(est.asOf).toBe("2024-03-19");
    const csv = cabinetEstimateCsv(est, book());
    expect(csv).toContain('"W2430","W24 x 30 Wall Cabinet","T102","2","122.99","245.98"');
    expect(csv).toContain("NOT PRICED (not-in-list)");
  });

  it("never prices a discontinued item", () => {
    const b = updateItem(book(), "SB36", { discontinued: true });
    const est = cabinetEstimate(kitchen(), b, {});
    expect(est.lines.some((l) => l.code === "SB36")).toBe(false);
    expect(est.issues.some((i) => i.code === "SB36" && i.status === "discontinued")).toBe(true);
  });
});

describe("saved estimate snapshots", () => {
  it("freeze prices so later edits never change a saved estimate", () => {
    let d = place(createEmptyDesign("Kitchen"), "cabinet-base-24");
    const b = book();
    const snap = snapshotEstimate(cabinetEstimate(d, b, { CROWN: 1 }), b, { now: new Date("2025-02-01T12:00:00Z"), id: "est-1" });
    expect(snap).toMatchObject({ id: "est-1", savedAt: "2025-02-01T12:00:00.000Z", supplier: "Test Supply", asOf: "2024-03-19", totalCents: 16699 + 4399 });
    expect(snap.accessories.map((a) => a.code)).toEqual(["CROWN"]);
    d = addSavedEstimate(d, snap);
    // Price goes up later: the live estimate changes, the saved one doesn't.
    const later = updateItem(b, "B24", { priceCents: 20000 });
    expect(cabinetEstimate(d, later).cabinetsCents).toBe(20000);
    expect(d.cabinetEstimates[0].lines[0].unitCents).toBe(16699);
    expect(removeSavedEstimate(d, "est-1").cabinetEstimates).toEqual([]);
  });
});

describe("price book storage (local cache)", () => {
  const memory = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  };

  it("seeds the sample, keeps each user's edits, and resets to the sample", () => {
    const storage = memory();
    const fresh = loadPriceBooks(storage, "u1");
    expect(fresh.map((b) => b.id)).toEqual(["sample-stock-cabinets"]);
    expect(isUneditedSeed(fresh[0])).toBe(true);
    const edited = [updateItem(fresh[0], "B24", { priceCents: 1 })];
    expect(isUneditedSeed(edited[0])).toBe(false);
    savePriceBooks(edited, storage, "u1");
    expect(findItem(loadPriceBooks(storage, "u1")[0], "B24").priceCents).toBe(1);
    expect(findItem(loadPriceBooks(storage, "u2")[0], "B24").priceCents).toBeNull();
    expect(findItem(resetBookToSeed("sample-stock-cabinets"), "B24").priceCents).toBeNull();
    expect(parsePriceBooks("{corrupt")).toHaveLength(1);
    expect(withSeeds([book()]).map((b) => b.id)).toEqual(["test-supply", "sample-stock-cabinets"]);
  });
});

describe("regression: an unpriced item is never $0", () => {
  it("keeps a null price null through normalizeBook (Number(null) === 0 trap)", () => {
    const b = normalizeBook({ id: "x", items: [{ code: "B24", priceCents: null }, { code: "B27" }, { code: "B30", priceCents: 0 }] });
    expect(b.items.map((i) => i.priceCents)).toEqual([null, null, 0]);
  });
});
