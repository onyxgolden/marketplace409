/**
 * Shared flange / nozzle drawing for the designer's 2D views (plan and
 * sheet/print). One component model (flangeGeometry) feeds every view:
 * a flange pair is two discs back to back across the connection plane,
 * drawn as bars perpendicular to the pipe axis; a top-facing flange
 * (face horizontal) draws as concentric rings. All sizes come from the
 * flange dimensions table — callers pass already-scaled pixel values.
 */

export function FlangePairGlyph({
  x,
  y,
  angleDeg = 0,
  od,
  thickness,
  pair = true,
  stroke = "#e2e8f0",
  fill = "none",
  testId,
}) {
  const t = Math.max(1.5, thickness);
  const half = Math.max(3, od / 2);
  const discs = pair ? [-t / 2, t / 2] : [0];
  return (
    <g transform={`translate(${x} ${y}) rotate(${angleDeg})`} data-testid={testId}>
      {discs.map((cx, i) => (
        <rect
          key={i}
          x={cx - t / 2}
          y={-half}
          width={t}
          height={half * 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={1}
        />
      ))}
    </g>
  );
}

export function FlangeRingGlyph({ x, y, od, stroke = "#e2e8f0", testId }) {
  const r = Math.max(3, od / 2);
  return (
    <g data-testid={testId}>
      <circle cx={x} cy={y} r={r} fill="none" stroke={stroke} strokeWidth={1.25} />
      <circle cx={x} cy={y} r={Math.max(1.5, r * 0.62)} fill="none" stroke={stroke} strokeWidth={0.75} />
    </g>
  );
}

/**
 * A nozzle in plan: a short neck stub from the equipment surface point
 * inward, terminated by its flange at the connection point. For a
 * center (top) nozzle the flange draws as rings.
 */
export function NozzlePlanGlyph({
  x,
  y,
  angleDeg,
  od,
  thickness,
  neckLength,
  neckWidth,
  top = false,
  stroke = "#e2e8f0",
}) {
  if (top) return <FlangeRingGlyph x={x} y={y} od={od} stroke={stroke} />;
  const rad = (angleDeg * Math.PI) / 180;
  const nx = x - Math.cos(rad) * neckLength;
  const ny = y - Math.sin(rad) * neckLength;
  return (
    <g>
      <line
        x1={nx}
        y1={ny}
        x2={x}
        y2={y}
        stroke={stroke}
        strokeWidth={Math.max(1.25, neckWidth)}
      />
      <FlangePairGlyph
        x={x}
        y={y}
        angleDeg={angleDeg}
        od={od}
        thickness={thickness}
        pair={false}
        stroke={stroke}
      />
    </g>
  );
}
