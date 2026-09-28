// temaGeometry.test.js — parametric TEMA component geometry, assembly layout,
// and connection anchors shared by the detailed and P&ID drawing modes.

import { describe, expect, it } from "vitest";
import { TEMA_FRONT_HEADS, TEMA_PRESETS, TEMA_REAR_HEADS, TEMA_SHELLS } from "./temaTypes";
import {
  temaAssembly,
  temaAnchorsWorld,
  temaComponent,
  temaDrawing,
  temaPidAssembly,
  temaPidComponent,
} from "./temaGeometry";

const ALL = [
  ...TEMA_FRONT_HEADS.map((t) => ["front", t.letter]),
  ...TEMA_SHELLS.map((t) => ["shell", t.letter]),
  ...TEMA_REAR_HEADS.map((t) => ["rear", t.letter]),
];

const round = (v) => Math.round(v * 100) / 100;
function signature(prims) {
  return JSON.stringify(
    prims.map((p) => {
      const out = { kind: p.kind, role: p.role };
      for (const [k, v] of Object.entries(p)) {
        if (typeof v === "number") out[k] = round(v);
        if (Array.isArray(v)) out[k] = v.map(([x, y]) => [round(x), round(y)]);
      }
      return out;
    }),
  );
}
function finitePrims(prims) {
  for (const p of prims) {
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === "number") expect(Number.isFinite(v), `${p.kind}.${k}`).toBe(true);
      if (Array.isArray(v)) for (const [x, y] of v) expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    }
  }
}
function bounds(prims) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const eat = (x, y) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
  for (const p of prims) {
    if (p.kind === "rect") { eat(p.x, p.y); eat(p.x + p.w, p.y + p.h); }
    else if (p.kind === "line") { eat(p.x1, p.y1); eat(p.x2, p.y2); }
    else if (p.kind === "poly") p.points.forEach(([x, y]) => eat(x, y));
    else if (p.kind === "circle") { eat(p.cx - p.r, p.cy - p.r); eat(p.cx + p.r, p.cy + p.r); }
  }
  return { minX, maxX, minY, maxY };
}

describe("the 20 component shapes", () => {
  it.each(ALL)("%s %s builds finite, in-footprint geometry with internal detail", (position, letter) => {
    const { prims } = temaComponent(position, letter, 60, 42);
    expect(prims.length).toBeGreaterThanOrEqual(5);
    finitePrims(prims);
    const b = bounds(prims);
    const eps = 0.01;
    expect(b.minX).toBeGreaterThanOrEqual(-30 - eps);
    expect(b.maxX).toBeLessThanOrEqual(30 + eps);
    expect(b.minY).toBeGreaterThanOrEqual(-21 - eps);
    expect(b.maxY).toBeLessThanOrEqual(21 + eps);
    // Not a generic rectangle: every type carries mechanical internals.
    const roles = new Set(prims.map((p) => p.role));
    expect([...roles].filter((r) => r !== "body").length, `${position} ${letter} roles`).toBeGreaterThanOrEqual(2);
  });

  it("gives all 20 types mechanically distinct geometry", () => {
    const sigs = ALL.map(([pos, l]) => signature(temaComponent(pos, l, 60, 42).prims));
    expect(new Set(sigs).size).toBe(20);
  });

  it("draws rear L like front A, M like B and rear N like front N (mirrored)", () => {
    const mirror = (prims) =>
      prims.map((p) => {
        if (p.kind === "rect") return { ...p, x: -(p.x + p.w) };
        if (p.kind === "line") return { ...p, x1: -p.x1, x2: -p.x2 };
        if (p.kind === "poly") return { ...p, points: p.points.map(([x, y]) => [-x, y]) };
        if (p.kind === "circle") return { ...p, cx: -p.cx };
        return p;
      });
    // Rear heads are drawn without tube nozzles for 2 passes; compare the
    // body geometry against the nozzle-free front head.
    const pairs = [["A", "L"], ["B", "M"], ["N", "N"]];
    for (const [front, rear] of pairs) {
      const f = temaComponent("front", front, 30, 42, { tubePasses: 2, nozzles: false, partition: false }).prims;
      const r = temaComponent("rear", rear, 30, 42, { tubePasses: 2 }).prims;
      expect(signature(r), `${rear} vs mirrored ${front}`).toBe(signature(mirror(f)));
    }
  });

  it("distinguishes the kettle by an enlarged shell and a weir", () => {
    const k = temaComponent("shell", "K", 120, 66).prims;
    const e = temaComponent("shell", "E", 120, 66).prims;
    expect(k.some((p) => p.role === "weir")).toBe(true);
    expect(e.some((p) => p.role === "weir")).toBe(false);
    const kb = bounds(k.filter((p) => p.role === "body"));
    const eb = bounds(e.filter((p) => p.role === "body"));
    expect(kb.maxY - kb.minY).toBeGreaterThan(eb.maxY - eb.minY);
  });

  it("puts shell nozzles where each shell type needs them", () => {
    const names = (shell) => temaComponent("shell", shell, 120, 42).anchors.map((a) => a.id).sort();
    expect(names("E")).toEqual(["shell-in", "shell-out"]);
    expect(names("F")).toEqual(["shell-in", "shell-out"]);
    expect(names("G")).toEqual(["shell-in", "shell-out"]);
    expect(names("H")).toEqual(["shell-in", "shell-in-2", "shell-out", "shell-out-2"]);
    expect(names("J")).toEqual(["shell-in", "shell-out", "shell-out-2"]);
    expect(names("K")).toEqual(["shell-in", "shell-out", "shell-out-2"]);
    expect(names("X")).toEqual(["shell-in", "shell-out"]);
    // E: in and out at opposite ends; F: both at the same end.
    const at = (shell, id) => temaComponent("shell", shell, 120, 42).anchors.find((a) => a.id === id);
    expect(at("E", "shell-in").x).toBeLessThan(0);
    expect(at("E", "shell-out").x).toBeGreaterThan(0);
    expect(at("F", "shell-in").x).toBeCloseTo(at("F", "shell-out").x);
  });
});

describe("assembled exchanger", () => {
  it("lays out front head, shell and rear head end to end across the footprint", () => {
    const a = temaAssembly(TEMA_PRESETS.AES, 192, 42);
    expect(a.designation).toBe("AES");
    expect(a.segments.front[0]).toBeCloseTo(-96);
    expect(a.segments.front[1]).toBeCloseTo(a.segments.shell[0]);
    expect(a.segments.shell[1]).toBeCloseTo(a.segments.rear[0]);
    expect(a.segments.rear[1]).toBeCloseTo(96);
    finitePrims(a.prims);
    const b = bounds(a.prims);
    expect(b.minX).toBeGreaterThanOrEqual(-96.01);
    expect(b.maxX).toBeLessThanOrEqual(96.01);
    expect(b.minY).toBeGreaterThanOrEqual(-21.01);
    expect(b.maxY).toBeLessThanOrEqual(21.01);
  });

  it("puts tube nozzles on the front head for multi-pass and splits them for one pass", () => {
    const ids = (cfg) => temaAssembly(cfg, 192, 42).anchors.map((a) => a.id).sort();
    expect(ids(TEMA_PRESETS.AES)).toEqual(["shell-in", "shell-out", "tube-in", "tube-out"]);
    const bem = temaAssembly(TEMA_PRESETS.BEM, 192, 42); // 1 pass
    const tubeIn = bem.anchors.find((a) => a.id === "tube-in");
    const tubeOut = bem.anchors.find((a) => a.id === "tube-out");
    expect(tubeIn.x).toBeLessThan(bem.segments.front[1]);
    expect(tubeOut.x).toBeGreaterThan(bem.segments.rear[0]);
  });

  it("keeps every anchor on the footprint edge so pipes meet nozzle flanges", () => {
    for (const code of Object.keys(TEMA_PRESETS)) {
      for (const anchor of temaAssembly(TEMA_PRESETS[code], 192, 42).anchors) {
        expect(Math.abs(anchor.y), `${code} ${anchor.id}`).toBeCloseTo(21);
        expect(["up", "down"]).toContain(anchor.dir);
      }
    }
  });

  it("scales uniformly: doubling width and depth doubles every coordinate", () => {
    const a = temaAssembly(TEMA_PRESETS.AET, 192, 42);
    const b = temaAssembly(TEMA_PRESETS.AET, 384, 84);
    const scaled = a.prims.map((p) => {
      const q = { ...p };
      for (const [k, v] of Object.entries(p)) {
        if (typeof v === "number") q[k] = v * 2;
        if (Array.isArray(v)) q[k] = v.map(([x, y]) => [x * 2, y * 2]);
      }
      return q;
    });
    expect(signature(b.prims)).toBe(signature(scaled));
    expect(b.anchors.map((x) => [round(x.x), round(x.y)])).toEqual(a.anchors.map((x) => [round(x.x * 2), round(x.y * 2)]));
  });

  it("builds every valid front/shell/rear combination without throwing", () => {
    for (const f of TEMA_FRONT_HEADS) for (const s of TEMA_SHELLS) for (const r of TEMA_REAR_HEADS) {
      const passes = r.letter === "U" ? 2 : 1;
      const a = temaAssembly({ front: f.letter, shell: s.letter, rear: r.letter, tubePasses: passes }, 240, 60);
      finitePrims(a.prims);
      expect(a.anchors.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("draws the kettle rear internals inside the enlarged shell", () => {
    const a = temaAssembly({ front: "B", shell: "K", rear: "U", tubePasses: 2 }, 240, 66);
    expect(a.prims.some((p) => p.role === "weir")).toBe(true);
    expect(a.prims.some((p) => p.role === "ubend")).toBe(true);
  });
});

describe("P&ID mode shares the connection anchors", () => {
  it.each(Object.keys(TEMA_PRESETS))("%s anchors are identical in both modes", (code) => {
    const detailed = temaAssembly(TEMA_PRESETS[code], 200, 48);
    const pid = temaPidAssembly(TEMA_PRESETS[code], 200, 48);
    expect(pid.anchors).toEqual(detailed.anchors);
    expect(signature(pid.prims)).not.toBe(signature(detailed.prims));
    expect(pid.prims.some((p) => p.kind === "text" && p.text === code)).toBe(true);
  });

  it("matches anchors for the standalone components too", () => {
    for (const [pos, l] of ALL) {
      expect(temaPidComponent(pos, l, 60, 42).anchors).toEqual(temaComponent(pos, l, 60, 42).anchors);
    }
  });

  it("temaDrawing picks the mode and falls back to the symbol defaults", () => {
    const symbol = { id: "tema-exchanger", widthIn: 192, depthIn: 42, tema: { kind: "assembly", defaultConfig: TEMA_PRESETS.AES } };
    const inst = { x: 0, y: 0, rotationDeg: 0 };
    expect(temaDrawing(symbol, inst).mode).toBe("detailed");
    expect(temaDrawing(symbol, { ...inst, drawingMode: "pid" }).mode).toBe("pid");
    expect(temaDrawing(symbol, { ...inst, tema: TEMA_PRESETS.BEU }).designation).toBe("BEU");
    const part = { id: "tema-front-a", widthIn: 30, depthIn: 42, tema: { kind: "component", position: "front", letter: "A" } };
    expect(temaDrawing(part, inst).designation).toBe("A");
  });
});

describe("world-space anchors", () => {
  it("follow the instance position, rotation and size", () => {
    const symbol = { id: "tema-exchanger", widthIn: 192, depthIn: 42, tema: { kind: "assembly", defaultConfig: TEMA_PRESETS.AES } };
    const base = temaAnchorsWorld(symbol, { x: 100, y: 50, rotationDeg: 0 });
    const local = temaAssembly(TEMA_PRESETS.AES, 192, 42).anchors;
    expect(base.map((a) => [round(a.x), round(a.y)])).toEqual(local.map((a) => [round(a.x + 100), round(a.y + 50)]));
    const rotated = temaAnchorsWorld(symbol, { x: 0, y: 0, rotationDeg: 90 });
    // SVG rotate(90) maps local (x, y) -> (-y, x).
    expect(rotated.map((a) => [round(a.x), round(a.y)])).toEqual(local.map((a) => [round(-a.y), round(a.x)]));
    const resized = temaAnchorsWorld(symbol, { x: 0, y: 0, rotationDeg: 0, widthIn: 384, depthIn: 84 });
    expect(resized.map((a) => round(a.y))).toEqual(local.map((a) => round(a.y * 2)));
    const pidMode = temaAnchorsWorld(symbol, { x: 100, y: 50, rotationDeg: 0, drawingMode: "pid" });
    expect(pidMode).toEqual(base);
  });
});
