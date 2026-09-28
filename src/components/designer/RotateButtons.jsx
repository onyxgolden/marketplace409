"use client";

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
