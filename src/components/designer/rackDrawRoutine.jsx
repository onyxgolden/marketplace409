"use client";

// Plan symbol for pipe racks and sleeper racks: dashed rack edges, bent
// lines with column squares and longitudinal column lines (pipe rack), or
// sleeper bars (sleeper rack), plus the tag and a TOS elevation note.
// Geometry comes from rackGeometry.rackPlan so screen and print agree.

import { rackLabel, rackParams, rackPlan } from "@/domains/roomDesigner/rackGeometry";
import { uprightTextTransform } from "./uprightText";

export function drawRackSymbol({ symbol, instance, toScreen, scale, highlighted }) {
  const p = rackParams(symbol, instance);
  const plan = rackPlan(p);
  const c = toScreen({ x: instance.x, y: instance.y });
  const k = scale;
  const steel = highlighted ? "#f59e0b" : symbol.memberColor || "#94a3b8";
  const sw = highlighted ? 2.5 : 1.25;
  const hl = plan.halfL * k;
  const hw = plan.halfW * k;
  const below = hw + 13;
  return (
    <g key={instance.id} transform={`translate(${c.x} ${c.y}) rotate(${instance.rotationDeg || 0})`} data-rack={p.kind}>
      <rect x={-hl} y={-hw} width={hl * 2} height={hw * 2} fill="transparent" stroke={steel} strokeWidth={sw} strokeDasharray="10 6" />
      {plan.columnLines.map((z) => (
        <line key={`cl${z}`} x1={-hl} y1={z * k} x2={hl} y2={z * k} stroke={steel} strokeWidth={sw} />
      ))}
      {plan.bentLines.map((x) => (
        <line key={`b${x}`} x1={x * k} y1={-hw} x2={x * k} y2={hw} stroke={steel} strokeWidth={sw * 1.4} />
      ))}
      {plan.columns.map((col, i) => {
        const s = Math.max(4, col.size * k);
        return <rect key={`c${i}`} x={col.x * k - s / 2} y={col.z * k - s / 2} width={s} height={s} fill={steel} />;
      })}
      {plan.sleepers.map((sl) => {
        const w = Math.max(3, sl.w * k);
        return <rect key={`s${sl.x}`} x={sl.x * k - w / 2} y={-hw} width={w} height={hw * 2} fill={steel} fillOpacity={0.55} stroke={steel} strokeWidth={sw} />;
      })}
      {instance.tag && (
        <text y={below} transform={uprightTextTransform(instance.rotationDeg, 0, below)} textAnchor="middle" fontSize={11} fontWeight={700} fill={highlighted ? "#f59e0b" : "#fde68a"}>
          {instance.tag.slice(0, 14)}
        </text>
      )}
      <text y={below + (instance.tag ? 13 : 0)} transform={uprightTextTransform(instance.rotationDeg, 0, below + (instance.tag ? 13 : 0))} textAnchor="middle" fontSize={10} fill="#9ca3af">
        {symbol.label} · {rackLabel(p)}
      </text>
    </g>
  );
}
