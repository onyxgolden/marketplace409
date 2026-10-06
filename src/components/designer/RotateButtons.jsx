"use client";

import { useState } from "react";
import { RotateCcw, RotateCw } from "lucide-react";

// Inspector rotation: 45 degrees counter-clockwise or clockwise. Calls
// onRotate(newAngle); the domain normalizes angles into 0..359.
const buttonClass = "flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-xs text-white hover:bg-gray-700";

export default function RotateButtons({ rotationDeg = 0, onRotate }) {
  return (
    <div className="mt-2 flex gap-2">
      <button type="button" aria-label="Rotate 45° counter-clockwise" title="Rotate 45° counter-clockwise"
        onClick={() => onRotate(rotationDeg - 45)} className={buttonClass}>
        <RotateCcw size={13} /> 45°
      </button>
      <button type="button" aria-label="Rotate 45° clockwise" title="Rotate 45° clockwise"
        onClick={() => onRotate(rotationDeg + 45)} className={buttonClass}>
        <RotateCw size={13} /> 45°
      </button>
    </div>
  );
}

const shownAngle = (deg) => String(Math.round((Number(deg) || 0) * 100) / 100);

/**
 * Type an exact angle in degrees and press Set angle (or Enter). Blank or
 * non-numeric entries are ignored. Angles wrap into 0-359 in the domain.
 */
export function RotateToAngle({ rotationDeg = 0, onRotate }) {
  // `draft` is null while the field shows the piece's current angle. When the
  // angle changes from outside (a 45° button, another piece), drop the draft.
  const [draft, setDraft] = useState(null);
  const [seenAngle, setSeenAngle] = useState(rotationDeg);
  if (seenAngle !== rotationDeg) {
    setSeenAngle(rotationDeg);
    setDraft(null);
  }
  const text = draft ?? shownAngle(rotationDeg);

  const apply = () => {
    if (text.trim() === "") return;
    const value = Number(text);
    if (!Number.isFinite(value)) return;
    onRotate(value);
  };

  return (
    <form
      className="mt-2 flex items-center gap-2 text-xs text-gray-300"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <label className="flex items-center gap-1">
        Exact angle
        <input
          type="number"
          step="any"
          aria-label="Exact angle in degrees"
          value={text}
          onChange={(e) => setDraft(e.target.value)}
          className="w-20 rounded bg-gray-800 px-2 py-1 text-white"
        />
        °
      </label>
      <button type="submit" className={buttonClass}>Set angle</button>
    </form>
  );
}
