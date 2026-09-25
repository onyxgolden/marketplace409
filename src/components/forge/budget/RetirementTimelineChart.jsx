"use client";
import { useMemo, useState } from "react";

// Milestone timeline chart for the retirement-number card (Boldin-style).
//
// Hand-rolled SVG — one dependency-free line chart with milestone dots and a
// hover tooltip. X axis runs currentAge -> planningAge; the balance lines
// start at retirementAge (pre-retirement accumulation is deliberately not
// modeled — see projectRetirementTimeline). When the spending-smile toggle is
// on, both paths render side by side, matching the card's established
// comparison pattern.

const W = 800;
const H = 340;
const PAD = { left: 58, right: 18, top: 18, bottom: 52 };

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const dollarsCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

function nearestPoint(points, age) {
  let best = null;
  let bestDist = Infinity;
  for (const point of points) {
    const dist = Math.abs(point.age - age);
    if (dist < bestDist) {
      bestDist = dist;
      best = point;
    }
  }
  return best;
}

export default function RetirementTimelineChart({
  flat,
  smile,
  milestones,
  currentAge,
  retirementAge,
  planningAge,
  smileOn,
}) {
  const [hoverAge, setHoverAge] = useState(null);

  const geometry = useMemo(() => {
    if (!flat || flat.years.length === 0) return null;
    const allPoints = smile?.years?.length ? [...flat.years, ...smile.years] : flat.years;
    const maxBalance = Math.max(...allPoints.map((point) => point.balance ?? 0), 1);
    const x = (age) =>
      PAD.left + ((age - currentAge) / Math.max(1, planningAge - currentAge)) * (W - PAD.left - PAD.right);
    const y = (balance) => PAD.top + (1 - (balance ?? 0) / maxBalance) * (H - PAD.top - PAD.bottom);
    const pathFor = (projection) =>
      projection.years
        .filter((point) => point.balance != null)
        .map((point, i) => `${i === 0 ? "M" : "L"}${x(point.age).toFixed(1)},${y(point.balance).toFixed(1)}`)
        .join(" ");
    return { maxBalance, x, y, flatPath: pathFor(flat), smilePath: smile?.years?.length ? pathFor(smile) : null };
  }, [flat, smile, currentAge, planningAge]);

  if (!geometry) return null;

  const { x, y, flatPath, smilePath, maxBalance } = geometry;
  const plotBottom = H - PAD.bottom;
  const runwayY = plotBottom + 22; // pre-retirement milestone row, below the axis

  const handleMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    const age = Math.round(currentAge + ((px - PAD.left) / (W - PAD.left - PAD.right)) * (planningAge - currentAge));
    setHoverAge(Math.max(currentAge, Math.min(planningAge, age)));
  };

  const hoverFlat = hoverAge != null ? nearestPoint(flat.years, hoverAge) : null;
  const hoverSmile = hoverAge != null && smile?.years?.length ? nearestPoint(smile.years, hoverAge) : null;
  const hoverMilestone =
    hoverAge != null ? milestones.find((milestone) => Math.round(milestone.age) === hoverAge) : null;

  // Tooltip: drawn inside the SVG so it can't misalign with the viewBox.
  const tipX = hoverFlat ? x(hoverFlat.age) : 0;
  const tipY = hoverFlat ? y(hoverFlat.balance) : 0;
  const tipLeft = tipX > W * 0.62; // flip to the left half of the chart
  const tipLines = [];
  if (hoverFlat) {
    tipLines.push(hoverFlat.calendarYear != null ? `${hoverFlat.calendarYear} · age ${hoverFlat.age}` : `Age ${hoverFlat.age}`);
    tipLines.push(`Flat: ${dollars.format(hoverFlat.balance ?? 0)}`);
    if (hoverFlat.withdrawal != null) tipLines.push(`Withdrawal: ${dollars.format(hoverFlat.withdrawal)}/yr`);
    if (smileOn && hoverSmile) tipLines.push(`Smile: ${dollars.format(hoverSmile.balance ?? 0)}`);
    if (hoverMilestone) tipLines.push(`★ ${hoverMilestone.label}`);
  }
  const tipWidth = 218;
  const tipHeight = tipLines.length * 17 + 12;
  const tipBoxX = tipLeft ? tipX - tipWidth - 12 : tipX + 12;
  const tipBoxY = Math.max(PAD.top, Math.min(tipY - tipHeight / 2, H - tipHeight - 8));

  const yTicks = [0, 0.5, 1].map((fraction) => fraction * maxBalance);
  const xTicks = [];
  const tickStep = Math.max(5, Math.round((planningAge - currentAge) / 6 / 5) * 5);
  for (let age = Math.ceil(currentAge / tickStep) * tickStep; age <= planningAge; age += tickStep) {
    xTicks.push(age);
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Projected retirement balance from age ${retirementAge} to ${planningAge}, with milestones.`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverAge(null)}
      >
        {/* Y gridlines + labels */}
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#94a3b8">
              {dollarsCompact.format(tick)}
            </text>
          </g>
        ))}
        {/* X axis + labels */}
        <line x1={PAD.left} x2={W - PAD.right} y1={plotBottom} y2={plotBottom} stroke="#cbd5e1" strokeWidth="1" />
        {xTicks.map((age) => (
          <text key={age} x={x(age)} y={plotBottom + 18} textAnchor="middle" fontSize="11" fill="#94a3b8">
            {age}
          </text>
        ))}
        <text x={(PAD.left + W - PAD.right) / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="#94a3b8">
          Age
        </text>

        {/* Pre-retirement runway */}
        {retirementAge > currentAge ? (
          <g>
            <line
              x1={x(currentAge)}
              x2={x(retirementAge)}
              y1={runwayY}
              y2={runwayY}
              stroke="#cbd5e1"
              strokeWidth="2"
              strokeDasharray="5 4"
            />
            <text x={x(currentAge)} y={runwayY - 8} fontSize="10" fill="#94a3b8">
              now
            </text>
          </g>
        ) : null}

        {/* Balance lines */}
        <path d={flatPath} fill="none" stroke="#0284c7" strokeWidth="2.5" strokeLinejoin="round" />
        {smileOn && smilePath ? (
          <path d={smilePath} fill="none" stroke="#059669" strokeWidth="2.5" strokeDasharray="7 4" strokeLinejoin="round" />
        ) : null}

        {/* Milestone dots */}
        {milestones.map((milestone) => {
          const onLine = milestone.age >= retirementAge;
          const point = onLine ? nearestPoint(flat.years, milestone.age) : null;
          const cx = x(milestone.age);
          const cy = onLine && point ? y(point.balance) : runwayY;
          return (
            <g key={milestone.key}>
              <circle cx={cx} cy={cy} r="6" fill="#f59e0b" stroke="#ffffff" strokeWidth="2" />
              <title>{milestone.label}</title>
            </g>
          );
        })}

        {/* Hover crosshair + tooltip */}
        {hoverFlat ? (
          <g pointerEvents="none">
            <line
              x1={x(hoverFlat.age)}
              x2={x(hoverFlat.age)}
              y1={PAD.top}
              y2={plotBottom}
              stroke="#94a3b8"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle cx={x(hoverFlat.age)} cy={y(hoverFlat.balance)} r="4.5" fill="#0284c7" stroke="#fff" strokeWidth="2" />
            <rect
              x={tipBoxX}
              y={tipBoxY}
              width={tipWidth}
              height={tipHeight}
              rx="8"
              fill="#0f172a"
              opacity="0.95"
            />
            {tipLines.map((line, i) => (
              <text
                key={i}
                x={tipBoxX + 10}
                y={tipBoxY + 19 + i * 17}
                fontSize="12"
                fontWeight={i === 0 ? "700" : "500"}
                fill={i === 0 ? "#ffffff" : line.startsWith("★") ? "#fbbf24" : "#cbd5e1"}
              >
                {line}
              </text>
            ))}
          </g>
        ) : null}
      </svg>

      {/* Legend */}
      <div className="mt-1 flex flex-wrap items-center gap-4 px-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-6 bg-sky-600" /> Flat real spending
        </span>
        {smileOn ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-6 bg-emerald-600"
              style={{ backgroundImage: "linear-gradient(90deg,#059669 60%,transparent 60%)", backgroundSize: "8px 2px" }}
            />
            Spending smile
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" /> Milestone
        </span>
      </div>
    </div>
  );
}
