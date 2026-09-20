import { describe, expect, it, beforeEach } from "vitest";
import {
  __resetSymbolRegistry,
  findSymbol,
  getSymbolSet,
  listSymbolSets,
  registerSymbolSet,
} from "./symbolRegistry";

const goodSet = (domain) => ({
  domain,
  title: `${domain} set`,
  symbols: [
    { id: "a", label: "A", widthIn: 10, depthIn: 8 },
    { id: "b", label: "B", widthIn: 4, depthIn: 4 },
  ],
});

describe("symbolRegistry", () => {
  beforeEach(() => {
    __resetSymbolRegistry();
  });

  it("registers a set and looks it up by domain", () => {
    registerSymbolSet(goodSet("piping"));
    const set = getSymbolSet("piping");
    expect(set.title).toBe("piping set");
    expect(set.symbols.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("finds symbols by domain + id", () => {
    registerSymbolSet(goodSet("piping"));
    expect(findSymbol("piping", "a").label).toBe("A");
    expect(findSymbol("piping", "nope")).toBeUndefined();
    expect(findSymbol("unknown-domain", "a")).toBeUndefined();
  });

  it("lists sets in registration order", () => {
    registerSymbolSet(goodSet("one"));
    registerSymbolSet(goodSet("two"));
    expect(listSymbolSets().map((s) => s.domain)).toEqual(["one", "two"]);
  });

  it("freezes sets and symbols", () => {
    const set = registerSymbolSet(goodSet("piping"));
    expect(Object.isFrozen(set)).toBe(true);
    expect(Object.isFrozen(set.symbols)).toBe(true);
    expect(Object.isFrozen(set.symbols[0])).toBe(true);
  });

  it("rejects a duplicate domain", () => {
    registerSymbolSet(goodSet("piping"));
    expect(() => registerSymbolSet(goodSet("piping"))).toThrow(/already registered/);
  });

  it("rejects duplicate symbol ids within a set", () => {
    expect(() =>
      registerSymbolSet({
        domain: "piping",
        title: "Piping",
        symbols: [
          { id: "valve", label: "Valve", widthIn: 12, depthIn: 12 },
          { id: "valve", label: "Valve 2", widthIn: 6, depthIn: 6 },
        ],
      }),
    ).toThrow(/duplicate symbol id/);
  });

  it("rejects symbols with missing ids, labels, or non-positive sizes", () => {
    for (const symbols of [
      [{ label: "No id", widthIn: 1, depthIn: 1 }],
      [{ id: "x", widthIn: 1, depthIn: 1 }],
      [{ id: "x", label: "Bad size", widthIn: 0, depthIn: 1 }],
      [{ id: "x", label: "Bad size", widthIn: 1, depthIn: -2 }],
    ]) {
      expect(() => registerSymbolSet({ domain: "d", title: "D", symbols })).toThrow();
    }
  });

  it("rejects malformed sets", () => {
    expect(() => registerSymbolSet(null)).toThrow();
    expect(() => registerSymbolSet({ domain: "", title: "T", symbols: goodSet("x").symbols })).toThrow();
    expect(() => registerSymbolSet({ domain: "d", title: "T", symbols: [] })).toThrow();
  });

  it("keeps extra symbol fields for draw routines (color, shape, draw2D)", () => {
    const draw2D = () => null;
    registerSymbolSet({
      domain: "piping",
      title: "Piping",
      symbols: [{ id: "v", label: "Valve", widthIn: 12, depthIn: 12, color: "#fff", shape: "circle", draw2D }],
    });
    const symbol = findSymbol("piping", "v");
    expect(symbol.color).toBe("#fff");
    expect(symbol.shape).toBe("circle");
    expect(symbol.draw2D).toBe(draw2D);
  });
});
