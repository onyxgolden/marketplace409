"use client";

import { useEffect, useRef } from "react";
import {
  CHART_BACKGROUND_CATEGORIES,
  listChartBackgroundsByCategory,
} from "@/domains/chartBuilder";

const CATEGORY_LABELS = {
  solid: "Solids",
  gradient: "Gradients",
  pattern: "Patterns",
};

export default function BackgroundPicker({ currentId, onSelect, onClose }) {
  const panelRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      if (panelRef.current && !panelRef.current.contains(event.target)) {
        onClose();
      }
    }
    function handleKey(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full z-30 mt-2 w-[340px] rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
      role="dialog"
      aria-label="Choose slide background"
    >
      <div className="mb-2 text-sm font-semibold text-slate-900">
        Slide background
      </div>
      {CHART_BACKGROUND_CATEGORIES.map((category) => (
        <div key={category} className="mb-3 last:mb-0">
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
            {CATEGORY_LABELS[category]}
          </div>
          <div className="flex flex-wrap gap-2">
            {listChartBackgroundsByCategory(category).map((preset) => {
              const active = preset.id === currentId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.name}
                  aria-label={`${preset.name} background`}
                  aria-pressed={active}
                  onClick={() => onSelect(preset.id)}
                  className={`relative h-12 w-20 overflow-hidden rounded-lg border-2 transition ${
                    active
                      ? "border-blue-600 ring-2 ring-blue-200"
                      : "border-slate-200 hover:border-slate-400"
                  }`}
                  style={{
                    background: preset.css,
                    backgroundSize: preset.backgroundSize,
                  }}
                >
                  {active && (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
                          preset.ink === "light" ? "bg-white text-slate-900" : "bg-slate-900 text-white"
                        }`}
                      >
                        ✓
                      </span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            {listChartBackgroundsByCategory(category).map((preset) => (
              <span key={preset.id} className="w-20 text-center text-[10px] leading-tight text-slate-500">
                {preset.name}
              </span>
            ))}
          </div>
        </div>
      ))}
      <p className="mt-2 text-[11px] text-slate-500">
        The background is saved with the chart, so exports keep the same look.
      </p>
    </div>
  );
}
