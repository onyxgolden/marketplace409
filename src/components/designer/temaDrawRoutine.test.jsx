// temaDrawRoutine.test.jsx — SVG rendering of TEMA exchanger geometry.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TEMA_PRESETS } from "@/domains/roomDesigner/temaTypes";
import { drawTemaSymbol, temaPrimitiveToSvg } from "./temaDrawRoutine";
import { drawProcessEquipmentSymbol } from "./symbolDrawRoutines";

const assembly = {
  id: "tema-exchanger",
  label: "Shell-and-tube exchanger (TEMA, configurable)",
  widthIn: 192,
  depthIn: 42,
  color: "#f59e0b",
  tagPrefix: "E",
  tema: { kind: "assembly", defaultConfig: TEMA_PRESETS.AES, defaultMode: "detailed" },
};
const frontA = {
  id: "tema-front-a",
  label: "TEMA front head A — Channel and removable cover",
  widthIn: 24,
  depthIn: 42,
  color: "#f59e0b",
  tema: { kind: "component", position: "front", letter: "A", defaultMode: "detailed" },
};
const ctx = { toScreen: (p) => ({ x: p.x, y: p.y }), scale: 1, highlighted: false };
const render = (symbol, instance = {}, extra = {}) =>
  renderToStaticMarkup(<svg>{drawTemaSymbol({ symbol, instance: { id: "i1", x: 0, y: 0, rotationDeg: 0, ...instance }, ...ctx, ...extra })}</svg>);

describe("drawTemaSymbol", () => {
  it("renders the detailed assembly with an accessible name and the tag", () => {
    const m = render(assembly, { tag: "E-101" });
    expect(m).toContain('aria-label="TEMA AES shell-and-tube exchanger, detailed drawing"');
    expect(m).toContain('data-tema-mode="detailed"');
    expect(m).toContain("E-101");
    expect(m).toContain("AES");
  });

  it("renders the simplified P&ID drawing when the instance asks for it", () => {
    const detailed = render(assembly);
    const pid = render(assembly, { drawingMode: "pid" });
    expect(pid).toContain('data-tema-mode="pid"');
    expect(pid).not.toBe(detailed);
    expect(pid).toContain(">AES<");
  });

  it("follows the instance configuration, rotation and size", () => {
    const beu = render(assembly, { tema: TEMA_PRESETS.BEU, rotationDeg: 90, widthIn: 240 });
    expect(beu).toContain("TEMA BEU");
    expect(beu).toContain("rotate(90)");
  });

  it("marks connection anchors only while selected", () => {
    expect(render(assembly)).not.toContain("data-anchor");
    const selected = render(assembly, {}, { highlighted: true });
    for (const id of ["tube-in", "tube-out", "shell-in", "shell-out"]) expect(selected).toContain(`data-anchor="${id}"`);
  });

  it("names a component by its position and letter", () => {
    expect(render(frontA)).toContain('aria-label="TEMA front head A, detailed drawing"');
  });

  it("is what drawProcessEquipmentSymbol uses for TEMA symbols", () => {
    const viaDomain = renderToStaticMarkup(<svg>{drawProcessEquipmentSymbol({ symbol: assembly, instance: { id: "i1", x: 0, y: 0, rotationDeg: 0 }, ...ctx })}</svg>);
    expect(viaDomain).toBe(render(assembly));
  });
});

describe("temaPrimitiveToSvg", () => {
  const style = { stroke: "#fff", sw: 1, accent: "#f00", body: "#000" };
  it("scales every primitive kind into screen space", () => {
    const out = (p) => renderToStaticMarkup(<svg>{temaPrimitiveToSvg(p, 0, 2, style)}</svg>);
    expect(out({ kind: "rect", x: 1, y: 2, w: 3, h: 4, role: "body" })).toContain('x="2" y="4" width="6" height="8"');
    expect(out({ kind: "line", x1: 0, y1: 0, x2: 5, y2: 0, role: "hidden" })).toContain("stroke-dasharray");
    expect(out({ kind: "poly", points: [[0, 0], [1, 1]], closed: true, role: "flow" })).toContain("<polygon");
    expect(out({ kind: "poly", points: [[0, 0], [1, 1]], closed: false, role: "body" })).toContain("<polyline");
    expect(out({ kind: "circle", cx: 1, cy: 1, r: 1, role: "internal" })).toContain('r="2"');
    expect(out({ kind: "text", x: 0, y: 0, text: "AES", size: 5, role: "label" })).toContain(">AES<");
  });
});
