import { describe, expect, it, beforeEach } from "vitest";
import {
  __resetSymbolRegistry,
  findSymbol,
  getSymbolRegistryGeneration,
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

  it("deep-freezes nested symbol extras and snapshots them at registration — D2 fix-round Gate 1", () => {
    const rack = { kind: "pipe", tiers: 2, elevationIn: 180, tierSpacingIn: 72, bentSpacingIn: 240 };
    const set = registerSymbolSet({
      domain: "racks",
      title: "Racks",
      symbols: [{ id: "r", label: "Rack", widthIn: 480, depthIn: 240, rack }],
    });
    const symbol = findSymbol("racks", "r");
    expect(symbol).toBe(set.symbols[0]);
    // Nested extras are frozen at every depth, not just the top level.
    expect(Object.isFrozen(symbol.rack)).toBe(true);
    // Mutating the REGISTERED copy is refused (strict-mode assignment throws).
    expect(() => {
      "use strict";
      symbol.rack.elevationIn = 120;
    }).toThrow();
    expect(symbol.rack.elevationIn).toBe(180);
    // Mutating the CALLER's object after registration cannot reach the
    // registry: the registered symbol is a snapshot, not an alias.
    rack.elevationIn = 120;
    expect(findSymbol("racks", "r").rack.elevationIn).toBe(180);
    // The caller's object itself was never frozen by registration.
    expect(Object.isFrozen(rack)).toBe(false);
  });

  it("deep-freezes nested arrays and keeps draw2D identity — D2 fix-round Gate 1", () => {
    const draw2D = () => null;
    registerSymbolSet({
      domain: "piping",
      title: "Piping",
      symbols: [
        {
          id: "v",
          label: "Valve",
          widthIn: 12,
          depthIn: 12,
          draw2D,
          ports: [{ x: 0, y: 0 }, { x: 12, y: 0 }],
        },
      ],
    });
    const symbol = findSymbol("piping", "v");
    expect(symbol.draw2D).toBe(draw2D);
    expect(Object.isFrozen(symbol.ports)).toBe(true);
    expect(Object.isFrozen(symbol.ports[0])).toBe(true);
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

  it("findSymbol returns the exact registered (frozen) symbol object — D2 index", () => {
    const set = registerSymbolSet(goodSet("piping"));
    // Same object identity as the linear scan used to return: callers that
    // compare by reference (rackParams input, draw routines) see no change.
    expect(findSymbol("piping", "a")).toBe(set.symbols[0]);
    expect(findSymbol("piping", "b")).toBe(set.symbols[1]);
    // Unknown domain/id still resolve to undefined, never throw.
    expect(findSymbol("piping", "zzz")).toBeUndefined();
    expect(findSymbol("nope", "a")).toBeUndefined();
    expect(findSymbol(undefined, "a")).toBeUndefined();
    expect(findSymbol("piping", undefined)).toBeUndefined();
  });

  it("index is rebuilt on reset + re-register — D2 index", () => {
    registerSymbolSet(goodSet("piping"));
    expect(findSymbol("piping", "a").label).toBe("A");
    __resetSymbolRegistry();
    expect(findSymbol("piping", "a")).toBeUndefined();
    registerSymbolSet({
      domain: "piping",
      title: "Piping v2",
      symbols: [{ id: "a", label: "A2", widthIn: 10, depthIn: 8 }],
    });
    expect(findSymbol("piping", "a").label).toBe("A2");
  });

  it("registry generation bumps on register and reset — D2 cache guard", () => {
    const g0 = getSymbolRegistryGeneration();
    registerSymbolSet(goodSet("one"));
    expect(getSymbolRegistryGeneration()).toBeGreaterThan(g0);
    const g1 = getSymbolRegistryGeneration();
    registerSymbolSet(goodSet("two"));
    expect(getSymbolRegistryGeneration()).toBeGreaterThan(g1);
    const g2 = getSymbolRegistryGeneration();
    __resetSymbolRegistry();
    expect(getSymbolRegistryGeneration()).toBeGreaterThan(g2);
  });
});
