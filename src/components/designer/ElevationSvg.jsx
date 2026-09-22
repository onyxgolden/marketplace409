"use client";

/**
 * ElevationSvg — shared SVG renderer for FORGE Home Designer slice 5
 * elevations. Pure presentational: takes a buildElevation /
 * buildStackedElevation result and draws walls as filled rectangles with
 * opening cut-outs, the grade line, and dimension labels.
 *
 * Coordinates stay in inches; the viewBox is computed from the elevation
 * span plus padding so the drawing scales to its container. Vertical values
 * are inches above grade — SVG's y grows downward, so v maps to
 * (topLimit - v).
 *
 * Used by the DesignerScreen Elevations section (dark) and by the
 * printable ElevationPrintView (light). A wall perpendicular to the view
 * plane projects to zero width and renders as a vertical edge line.
 */

import { feetInchesLabel } from "@/domains/roomDesigner/designerGeometry";

const PAD_SIDE_IN = 10;
const PAD_TOP_IN = 8;
const PAD_BOTTOM_IN = 14;
const THIN_WALL_MIN_IN = 0.5; // walls narrower than this render as an edge line

function spanOf(elevation) {
  let min = 0;
  let max = 0;
  for (const level of elevation.levels || []) {
    min = Math.min(min, level.minIn || 0);
    max = Math.max(max, level.maxIn || 0);
  }
  if (!(max > min)) {
    min -= 60;
    max += 60;
  }
  return { min, max };
}

function topOf(elevation) {
  let top = 0;
  for (const level of elevation.levels || []) {
    for (const w of level.wallViews || []) top = Math.max(top, w.topIn);
  }
  return top > 0 ? top : 108;
}

export default function ElevationSvg({ elevation, dark = true, id = "elevation" }) {
  if (!elevation || !elevation.ok) return null;
  const { min, max } = spanOf(elevation);
  const top = topOf(elevation);
  const vbX = min - PAD_SIDE_IN;
  const vbY = -PAD_BOTTOM_IN;
  const vbW = max - min + PAD_SIDE_IN * 2;
  const vbH = top + PAD_TOP_IN + PAD_BOTTOM_IN;
  const yOf = (v) => top - v;

  const palette = dark
    ? {
        wall: "#64748b",
        opening: "#0b0f14",
        stroke: "#94a3b8",
        grade: "#f59e0b",
        text: "#cbd5e1",
      }
    : {
        wall: "#cbd5e1",
        opening: "#ffffff",
        stroke: "#111827",
        grade: "#92400e",
        text: "#111827",
      };

  const overallWidth = max - min;
  const gradeLevels = (elevation.levels || []).filter((l) => l.gradeLine);

  return (
    <svg
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      width="100%"
      role="img"
      aria-label={elevation.directionLabel}
      data-testid={`elevation-svg-${id}`}
    >
      {/* grade line under the first level */}
      {gradeLevels.map((level) => (
        <g key={`grade-${level.id}`}>
          <line
            x1={min}
            x2={max}
            y1={yOf(level.baseIn)}
            y2={yOf(level.baseIn)}
            stroke={palette.grade}
            strokeWidth={1.5}
            strokeDasharray="10 6"
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={max + 3}
            y={yOf(level.baseIn) + 1}
            fontSize={5}
            fill={palette.grade}
          >
            Grade
          </text>
        </g>
      ))}

      {elevation.levels.map((level) => (
        <g key={level.id}>
          {/* per-level height label on the left */}
          <text
            x={min - 3}
            y={yOf(level.baseIn + level.wallHeightIn / 2)}
            fontSize={5}
            fill={palette.text}
            textAnchor="end"
            transform={`rotate(-90 ${min - 3} ${yOf(level.baseIn + level.wallHeightIn / 2)})`}
          >
            {feetInchesLabel(level.wallHeightIn)} · {level.name}
          </text>
          {level.wallViews.map((wall) =>
            wall.lengthIn < THIN_WALL_MIN_IN ? (
              // Perpendicular wall: a vertical edge, not a hidden wall.
              <line
                key={wall.wallId}
                x1={wall.projectedStartIn}
                x2={wall.projectedStartIn}
                y1={yOf(wall.topIn)}
                y2={yOf(wall.baseIn)}
                stroke={palette.stroke}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              <g key={wall.wallId}>
                <rect
                  x={wall.projectedStartIn}
                  y={yOf(wall.topIn)}
                  width={wall.lengthIn}
                  height={wall.topIn - wall.baseIn}
                  fill={palette.wall}
                  stroke={palette.stroke}
                  strokeWidth={0.5}
                />
                {wall.openingViews.map((opening) =>
                  opening.widthIn > 0 ? (
                    <rect
                      key={opening.id}
                      x={opening.startIn}
                      y={yOf(opening.headerIn)}
                      width={opening.widthIn}
                      height={opening.headerIn - opening.sillIn}
                      fill={palette.opening}
                      stroke={palette.stroke}
                      strokeWidth={0.5}
                    />
                  ) : null,
                )}
              </g>
            ),
          )}
        </g>
      ))}

      {/* overall width dimension */}
      <g>
        <line
          x1={min}
          x2={max}
          y1={yOf(0) + 6}
          y2={yOf(0) + 6}
          stroke={palette.text}
          strokeWidth={0.75}
          vectorEffect="non-scaling-stroke"
        />
        <line x1={min} x2={min} y1={yOf(0) + 4} y2={yOf(0) + 8} stroke={palette.text} strokeWidth={0.75} />
        <line x1={max} x2={max} y1={yOf(0) + 4} y2={yOf(0) + 8} stroke={palette.text} strokeWidth={0.75} />
        <text
          x={(min + max) / 2}
          y={yOf(0) + 12}
          fontSize={6}
          fill={palette.text}
          textAnchor="middle"
        >
          {feetInchesLabel(overallWidth)}
        </text>
      </g>
    </svg>
  );
}
