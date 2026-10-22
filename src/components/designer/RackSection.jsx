"use client";

// Inspector section for a pipe rack / sleeper rack: length and width (the
// symbol's size), tiers, top-of-steel elevation of the first tier, spacing
// between tiers, and bent (sleeper) spacing — all in feet. Out-of-range
// entries are not dispatched; the hint shows the allowed range.

import { useState } from "react";
import { RACK_LIMITS, rackLabel, rackParams, rackTopIn } from "@/domains/roomDesigner/rackGeometry";
import { feetInchesLabel } from "@/domains/roomDesigner/designerGeometry";

const inputClass = "mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-xs text-white";
const ft = (inches) => Math.round((inches / 12) * 100) / 100;

function FeetField({ label, valueIn, minIn, maxIn, onCommit }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? String(ft(valueIn));
  const inches = Math.round(Number(shown) * 12);
  const bad = shown.trim() === "" || !Number.isFinite(Number(shown)) || inches < minIn || inches > maxIn;
  const commit = () => {
    if (draft !== null && !bad && inches !== valueIn) onCommit(inches);
    setDraft(null);
  };
  return (
    <label className="block text-xs text-gray-400">
      {label} (ft)
      <input
        type="number" step="0.5" value={shown} aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        className={`${inputClass} ${bad ? "ring-1 ring-amber-400" : ""}`}
      />
      {bad && draft !== null && (
        <span className="text-[11px] text-amber-300">{ft(minIn)}–{ft(maxIn)} ft</span>
      )}
    </label>
  );
}

export default function RackSection({ symbol, instance, dispatch }) {
  if (!symbol?.rack) return null;
  const p = rackParams(symbol, instance);
  const lim = RACK_LIMITS[p.kind];
  const set = (fields) => dispatch({ type: "SET_RACK_PARAMS", symbolId: instance.id, fields });
  const size = (fields) => dispatch({ type: "SET_SYMBOL_SIZE", symbolId: instance.id, ...fields });
  return (
    <div className="space-y-2 border-t border-gray-800 pt-2" data-testid="rack-section">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {p.kind === "sleeper" ? "Sleeper rack" : "Pipe rack"}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <FeetField label="Length" valueIn={p.lengthIn} minIn={48} maxIn={4800} onCommit={(v) => size({ widthIn: v })} />
        <FeetField label="Width" valueIn={p.widthIn} minIn={24} maxIn={720} onCommit={(v) => size({ depthIn: v })} />
        <FeetField label={p.kind === "sleeper" ? "Top of sleeper" : "Top of steel, tier 1"} valueIn={p.elevationIn}
          minIn={lim.elevationIn[0]} maxIn={lim.elevationIn[1]} onCommit={(v) => set({ elevationIn: v })} />
        <FeetField label={p.kind === "sleeper" ? "Sleeper spacing" : "Bent spacing"} valueIn={p.bentSpacingIn}
          minIn={lim.bentSpacingIn[0]} maxIn={lim.bentSpacingIn[1]} onCommit={(v) => set({ bentSpacingIn: v })} />
        {p.kind === "pipe" && (
          <>
            <label className="block text-xs text-gray-400">
              Tiers
              <select value={p.tiers} aria-label="Tiers" onChange={(e) => set({ tiers: Number(e.target.value) })} className={inputClass}>
                {Array.from({ length: lim.tiers[1] - lim.tiers[0] + 1 }, (_, i) => lim.tiers[0] + i).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            {p.tiers > 1 && (
              <FeetField label="Between tiers" valueIn={p.tierSpacingIn}
                minIn={lim.tierSpacingIn[0]} maxIn={lim.tierSpacingIn[1]} onCommit={(v) => set({ tierSpacingIn: v })} />
            )}
          </>
        )}
      </div>
      <p className="text-[11px] text-gray-500">
        {rackLabel(p)} · overall {feetInchesLabel(rackTopIn(p))} high. Steel sizes are nominal planning geometry.
      </p>
    </div>
  );
}
