// symbolDrawRoutines.roomFloor.test.jsx — a room's uploaded flooring photo,
// tiled as an SVG pattern fill (drawRoomSymbol).

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { drawRoomSymbol } from "./symbolDrawRoutines";

const room = {
  id: "room_1",
  label: "Kitchen",
  polygon: [{ x: 0, y: 0 }, { x: 144, y: 0 }, { x: 144, y: 144 }, { x: 0, y: 144 }],
};
const toScreen = (p) => ({ x: p.x, y: p.y }); // 1:1 identity for these tests
const scale = 2; // 2 screen px per inch

describe("drawRoomSymbol without a floor image (unchanged default look)", () => {
  it("fills with the plain translucent blue tint, no pattern", () => {
    const html = renderToStaticMarkup(<svg>{drawRoomSymbol({ instance: room, toScreen, scale, highlighted: false })}</svg>);
    expect(html).toContain('fill="#3b82f6"');
    expect(html).toContain('fill-opacity="0.08"');
    expect(html).not.toContain("<pattern");
    expect(html).not.toContain("<defs");
  });
});

describe("drawRoomSymbol with a floor image", () => {
  const withFloor = { ...room, floorImage: { dataUrl: "data:image/png;base64,ZmFrZQ==", tileIn: 24 } };

  it("fills the polygon with a pattern referencing the uploaded photo", () => {
    const html = renderToStaticMarkup(<svg>{drawRoomSymbol({ instance: withFloor, toScreen, scale, highlighted: false })}</svg>);
    expect(html).toContain("<pattern");
    expect(html).toContain(`fill="url(#room-floor-${withFloor.id})"`);
    expect(html).toContain('fill-opacity="1"');
    expect(html).toContain("data:image/png;base64,ZmFrZQ==");
  });

  it("sizes the pattern tile in SCREEN pixels (tileIn * scale), so it re-tiles when the user zooms", () => {
    const html = renderToStaticMarkup(<svg>{drawRoomSymbol({ instance: withFloor, toScreen, scale, highlighted: false })}</svg>);
    // tileIn (24) * scale (2) = 48 screen px per repeat.
    expect(html).toContain('width="48"');
    expect(html).toContain('height="48"');
  });

  it("gives the label a dark backing pill for readability over an arbitrary photo", () => {
    const html = renderToStaticMarkup(<svg>{drawRoomSymbol({ instance: withFloor, toScreen, scale, highlighted: false })}</svg>);
    expect(html).toContain('fill="#0f172a"');
    expect(html).toContain('fill="#f1f5f9"'); // label text, lightened for contrast against the pill
  });

  it("falls back to the plain tint (no pattern) when scale is missing or zero — never a zero-size pattern", () => {
    const html = renderToStaticMarkup(<svg>{drawRoomSymbol({ instance: withFloor, toScreen, scale: 0, highlighted: false })}</svg>);
    expect(html).not.toContain("<pattern");
    expect(html).toContain('fill="#3b82f6"');
  });

  it("falls back to the plain tint when floorImage has no dataUrl", () => {
    const broken = { ...room, floorImage: { tileIn: 24 } };
    const html = renderToStaticMarkup(<svg>{drawRoomSymbol({ instance: broken, toScreen, scale, highlighted: false })}</svg>);
    expect(html).not.toContain("<pattern");
  });

  it("still shows the selection stroke color when highlighted, independent of the floor pattern", () => {
    const html = renderToStaticMarkup(<svg>{drawRoomSymbol({ instance: withFloor, toScreen, scale, highlighted: true })}</svg>);
    expect(html).toContain('stroke="#f59e0b"');
  });
});
