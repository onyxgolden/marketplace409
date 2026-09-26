"use client";

import { pieceSize } from "@/domains/roomDesigner/designerDocument";
import { MAX_MOUNT_IN, standardSizesFor } from "@/domains/roomDesigner/furnitureSizing";

const MIN_IN = 1;
const MAX_IN = 480;
const inputClass = "mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-white";
const inch = (v) => `${v}″`;

/**
 * Size controls for a placed furniture piece or cabinet.
 *
 * Every piece: custom width, depth and height (half-inch steps, 1"–480").
 * Cabinets: the industry-standard sizes of their family as quick picks per
 * axis (a value that isn't standard shows as "Custom"). Wall cabinets and
 * shelves: mounting height — how high the cabinet's bottom sits.
 * Reset drops every override back to the catalog size.
 */
export default function FurnitureSizeEditor({ piece, entry, dispatch }) {
  const size = pieceSize(piece);
  const standard = standardSizesFor(piece.catalogId);
  const mounted = entry.mountIn !== undefined;
  const overridden = ["widthIn", "depthIn", "heightIn", "mountIn"].some((k) => piece[k] !== undefined);

  const resize = (next) => {
    const w = next.widthIn ?? size.widthIn;
    const d = next.depthIn ?? size.depthIn;
    const h = next.heightIn ?? size.heightIn;
    if ([w, d, h].every((v) => Number.isFinite(v) && v >= MIN_IN && v <= MAX_IN)) {
      dispatch({ type: "RESIZE_FURNITURE", furnitureId: piece.id, widthIn: w, depthIn: d, heightIn: h });
    }
  };
  const mount = (v) => {
    if (Number.isFinite(v) && v >= 0 && v <= MAX_MOUNT_IN) {
      dispatch({ type: "SET_FURNITURE_MOUNT", furnitureId: piece.id, mountIn: v });
    }
  };

  const axis = (key, label) => (
    <label className="block text-xs text-gray-400">
      {label} (″)
      <input
        type="number"
        aria-label={label}
        min={MIN_IN}
        max={MAX_IN}
        step={0.5}
        value={size[key]}
        onChange={(e) => resize({ [key]: Number(e.target.value) })}
        className={inputClass}
      />
    </label>
  );

  const picker = (key, label, options, onPick) => {
    const current = key === "mountIn" ? size.mountIn : size[key];
    const isStandard = options.includes(current);
    return (
      <label className="block text-xs text-gray-400">
        {label}
        <select
          aria-label={`Standard ${label.toLowerCase()}`}
          value={isStandard ? String(current) : "custom"}
          onChange={(e) => e.target.value !== "custom" && onPick(Number(e.target.value))}
          className={inputClass}
        >
          {!isStandard && <option value="custom">Custom ({inch(current)})</option>}
          {options.map((v) => (
            <option key={v} value={String(v)}>{inch(v)}</option>
          ))}
        </select>
      </label>
    );
  };

  return (
    <div className="space-y-2" data-testid="furniture-size-editor">
      <div className="flex justify-between text-xs text-gray-400">
        <span>Size (W × D × H)</span>
        <span className="text-gray-200">
          {inch(size.widthIn)} × {inch(size.depthIn)} × {inch(size.heightIn)}
        </span>
      </div>

      {standard && (
        <div className="rounded border border-gray-800 p-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Standard {standard.label.toLowerCase()} sizes
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {picker("widthIn", "Width", standard.widths, (v) => resize({ widthIn: v }))}
            {picker("depthIn", "Depth", standard.depths, (v) => resize({ depthIn: v }))}
            {picker("heightIn", "Height", standard.heights, (v) => resize({ heightIn: v }))}
          </div>
        </div>
      )}

      <div>
        {standard && <p className="mb-1 text-[11px] text-gray-500">Custom size</p>}
        <div className="grid grid-cols-3 gap-1.5">
          {axis("widthIn", "Width")}
          {axis("depthIn", "Depth")}
          {axis("heightIn", "Height")}
        </div>
      </div>

      {mounted && (
        <div className="grid grid-cols-2 gap-1.5">
          <label className="block text-xs text-gray-400">
            Mounting height (″)
            <input
              type="number"
              aria-label="Mounting height"
              min={0}
              max={MAX_MOUNT_IN}
              step={0.5}
              value={size.mountIn}
              onChange={(e) => mount(Number(e.target.value))}
              className={inputClass}
            />
          </label>
          {standard?.mounts && picker("mountIn", "Mount", standard.mounts, mount)}
        </div>
      )}
      {mounted && <p className="text-[11px] text-gray-500">Mounting height is the cabinet bottom above the floor.</p>}

      {overridden && (
        <button
          onClick={() => dispatch({ type: "RESET_FURNITURE_SIZE", furnitureId: piece.id })}
          className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
        >
          Reset to catalog size ({inch(entry.widthIn)} × {inch(entry.depthIn)} × {inch(entry.heightIn)})
        </button>
      )}
    </div>
  );
}
