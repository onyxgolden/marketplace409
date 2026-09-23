"use client";

import { findSymbol } from "@/domains/roomDesigner/symbolRegistry";
import { renderSymbol2D } from "./symbolDrawRoutines";

/**
 * Live-rendered library thumbnail for a registered symbol.
 *
 * The icon IS the symbol's existing 2D draw routine (resolved through
 * renderSymbol2D, the same entry point the canvas uses) — never a
 * separate icon implementation. The routine renders into a 48px SVG
 * whose square viewBox is cropped to the symbol footprint, so canvas
 * labels (drawn below the footprint) clip away instead of drifting
 * into a second rendering.
 *
 * When the symbol has no registered draw routine, renderSymbol2D falls
 * back to the default rect placeholder — the established canvas
 * behavior — and an unknown symbol id gets a dashed empty box.
 */
const SIZE = 48;

export default function SymbolThumbnail({ domain, symbolId }) {
  const symbol = findSymbol(domain, symbolId);

  if (!symbol) {
    return (
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <rect
          x={6}
          y={6}
          width={SIZE - 12}
          height={SIZE - 12}
          rx={4}
          fill="none"
          stroke="#4b5563"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      </svg>
    );
  }

  const maxIn = Math.max(symbol.widthIn, symbol.depthIn);
  const scale = (SIZE - 8) / maxIn; // 4px padding around the footprint
  const w = symbol.widthIn * scale;
  const h = symbol.depthIn * scale;
  const side = Math.max(w, h) + 6; // square viewBox: no aspect distortion
  const center = side / 2;
  const toScreen = (p) => ({ x: center + p.x * scale, y: center + p.y * scale });
  // Furniture sizing resolves through pieceSize(instance) via catalogId;
  // other domains ignore the extra field.
  const instance = {
    id: `thumb-${domain}-${symbolId}`,
    catalogId: symbolId,
    x: 0,
    y: 0,
    rotationDeg: 0,
  };

  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${side} ${side}`}
      style={{ overflow: "hidden" }}
      aria-hidden="true"
    >
      {renderSymbol2D(domain, symbolId, instance, { toScreen, scale, highlighted: false })}
    </svg>
  );
}
