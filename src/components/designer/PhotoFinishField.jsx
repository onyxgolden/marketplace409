"use client";

import { useState } from "react";
import { Upload, X } from "lucide-react";
import { decodeUnderlayFile, extractAverageColorFromDataUrl, UNDERLAY_ACCEPT } from "./underlayImage";

/** Default physical size (inches) an uploaded pattern tiles at, until the user changes it elsewhere. */
export const DEFAULT_FINISH_TILE_IN = 24;

/**
 * Upload-a-photo control for a room's flooring or a wall's covering — the
 * one place a user turns an arbitrary photo into either a tiled pattern or,
 * for walls, a flat paint color.
 *
 * `allowColorChoice` (walls only) shows an explicit Wallpaper/Color toggle
 * the user picks BEFORE uploading. This is deliberately not auto-detected
 * from the photo's own color variance: Jason's call was that an explicit
 * choice is more predictable than a heuristic the user can't see coming or
 * correct — one extra click beats a surprising guess.
 *
 * `value` is whatever's currently stored — `{ dataUrl, tileIn }` for a
 * room's floorImage, or `{ kind: "pattern", dataUrl, tileIn } |
 * { kind: "color", color }` for a wall's wallCovering. `onChange` receives
 * the same shape to dispatch; `onClear` removes it (back to the default).
 */
export default function PhotoFinishField({ label, value, allowColorChoice = false, onChange, onClear }) {
  const [mode, setMode] = useState("pattern"); // only shown/used when allowColorChoice
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const onFile = async (file) => {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    setBusy(true);
    try {
      const { dataUrl } = await decodeUnderlayFile(file);
      if (allowColorChoice && mode === "color") {
        const color = await extractAverageColorFromDataUrl(dataUrl);
        onChange({ kind: "color", color });
      } else if (allowColorChoice) {
        onChange({ kind: "pattern", dataUrl, tileIn: DEFAULT_FINISH_TILE_IN });
      } else {
        onChange({ dataUrl, tileIn: DEFAULT_FINISH_TILE_IN });
      }
    } catch (err) {
      setError(err?.message || "Could not read that image.");
    } finally {
      setBusy(false);
    }
  };

  const hasValue = Boolean(value);
  // A room's value never carries `kind`; a wall's does. Either way, only a
  // pattern (or a room's plain image) has a dataUrl worth previewing — a
  // wall reduced to a color has no image left to show, just the swatch.
  const preview = value?.dataUrl && value.kind !== "color" ? value.dataUrl : null;
  const swatchColor = value?.kind === "color" ? value.color : null;

  return (
    <div className="text-xs text-gray-400">
      <div className="mb-1">{label}</div>
      {allowColorChoice && (
        <div className="mb-1.5 flex overflow-hidden rounded border border-gray-700 text-[11px]" role="group" aria-label="Upload as">
          {["pattern", "color"].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`flex-1 px-2 py-1 ${mode === m ? "bg-emerald-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
            >
              {m === "pattern" ? "Wallpaper" : "Color"}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded bg-gray-800 px-2.5 py-1.5 text-white hover:bg-gray-700">
          <Upload size={13} />
          {busy ? "Reading…" : hasValue ? "Replace photo" : "Upload photo"}
          <input
            type="file"
            accept={UNDERLAY_ACCEPT}
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // allow re-selecting the same file after clearing an error
              onFile(file);
            }}
          />
        </label>
        {hasValue && (
          <button type="button" onClick={onClear} title="Remove" aria-label="Remove" className="text-gray-500 hover:text-gray-300">
            <X size={14} />
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
      {preview && (
        <div
          className="mt-2 h-10 w-16 rounded border border-gray-700 bg-cover bg-center"
          style={{ backgroundImage: `url(${preview})` }}
        />
      )}
      {swatchColor && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-6 w-6 rounded border border-gray-700" style={{ backgroundColor: swatchColor }} />
          <span className="font-mono text-[11px]">{swatchColor}</span>
        </div>
      )}
    </div>
  );
}
