"use client";

/**
 * DesignerHelpModal — plain-language help panel for the room Designer.
 * Follows DxfExportDialog's dark-card portal pattern (this module's own
 * visual convention) rather than Scheduling/Rental's light theme, since it
 * lives inside Designer. Closes on Escape or backdrop click, matching
 * RentalHelpModal's convention.
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { HELP_SECTIONS, HELP_SHORTCUTS } from "./designerHelpContent";

export default function DesignerHelpModal({ onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Designer help"
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-gray-900 p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Designer help</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Keyboard shortcuts
        </h3>
        <dl className="mb-4 space-y-1">
          {HELP_SHORTCUTS.map((s) => (
            <div key={s.label} className="flex justify-between gap-3 text-sm">
              <dt className="text-gray-300">{s.label}</dt>
              <dd className="text-gray-500">{s.description}</dd>
            </div>
          ))}
        </dl>

        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Topics
        </h3>
        <dl className="space-y-3">
          {HELP_SECTIONS.map((s) => (
            <div key={s.label}>
              <dt className="text-sm font-semibold text-gray-200">{s.label}</dt>
              <dd className="text-xs text-gray-400">{s.description}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>,
    document.body,
  );
}
