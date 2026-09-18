// Pure SVG pie-slice geometry -- no rendering, no DOM. Kept separate from the React component so
// the angle/path math (the part most likely to have an off-by-one at 0% or 100%) is unit-testable
// without a DOM environment.
export function buildPieSlices(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.valueCents, 0);
  if (total <= 0) return [];

  let cumulativeAngle = -Math.PI / 2; // 12 o'clock start, matches how a clock/pie is normally read
  return entries.map((entry) => {
    const fraction = entry.valueCents / total;
    const startAngle = cumulativeAngle;
    const endAngle = cumulativeAngle + fraction * 2 * Math.PI;
    cumulativeAngle = endAngle;
    return { ...entry, fraction, startAngle, endAngle };
  });
}

export function sliceToPath(slice, cx, cy, r) {
  // A single 100% slice degenerates under the normal two-point arc formula (start === end point),
  // so it's drawn as two half-circle arcs instead.
  if (slice.fraction >= 0.999999) {
    return `M ${cx - r},${cy} A ${r},${r} 0 1,1 ${cx + r},${cy} A ${r},${r} 0 1,1 ${cx - r},${cy} Z`;
  }
  const x1 = cx + r * Math.cos(slice.startAngle);
  const y1 = cy + r * Math.sin(slice.startAngle);
  const x2 = cx + r * Math.cos(slice.endAngle);
  const y2 = cy + r * Math.sin(slice.endAngle);
  const largeArcFlag = slice.endAngle - slice.startAngle > Math.PI ? 1 : 0;
  return `M ${cx},${cy} L ${x1},${y1} A ${r},${r} 0 ${largeArcFlag},1 ${x2},${y2} Z`;
}
