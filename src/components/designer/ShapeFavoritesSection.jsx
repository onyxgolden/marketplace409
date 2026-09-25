"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Puzzle, Star } from "lucide-react";

/**
 * Favorites section of the shape library, at the top of the tool palette.
 *
 * One tap on a favorite places it on the canvas right away (centered on
 * what the user is looking at, 2D or 3D) — no arming a tool and clicking
 * the plan. Each row can be moved up/down (buttons, or Alt+↑/↓ on the row)
 * and un-starred. Shapes are starred from the "My shapes" category.
 *
 * Purely presentational: the order and the stars live in the user's shape
 * library, and every change goes out through the callbacks.
 */
export default function ShapeFavoritesSection({ shapes, onPlace, onMove, onRemove }) {
  const [collapsed, setCollapsed] = useState(false);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const count = shapes.length;

  return (
    <section className="mt-1" aria-label="Favorite shapes">
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? "Expand" : "Collapse"} favorite shapes`}
        onClick={() => setCollapsed((c) => !c)}
        className="mb-1 flex w-full items-center gap-1 rounded px-1 py-1 text-left text-xs font-semibold uppercase tracking-wide text-amber-500/80 hover:bg-gray-800 hover:text-amber-400"
      >
        <Chevron className="h-3 w-3 shrink-0" aria-hidden="true" />
        {/* Wraps rather than truncates: the palette is only 7rem wide. */}
        <span className="leading-tight">Favorite shapes ({count})</span>
      </button>
      {!collapsed && count === 0 && (
        <p className="px-1 pb-1 text-[10px] leading-tight text-gray-500">
          Star a shape in My shapes to pin it here.
        </p>
      )}
      {!collapsed && count > 0 && (
        <ol className="flex flex-col gap-1">
          {shapes.map((shape, index) => (
            <li key={shape.id} data-testid="favorite-shape" className="rounded bg-gray-800/40">
              <button
                type="button"
                onClick={() => onPlace(shape.id)}
                onKeyDown={(e) => {
                  if (!e.altKey) return;
                  if (e.key === "ArrowUp" && index > 0) {
                    e.preventDefault();
                    onMove(shape.id, -1);
                  } else if (e.key === "ArrowDown" && index < count - 1) {
                    e.preventDefault();
                    onMove(shape.id, 1);
                  }
                }}
                aria-label={`Place ${shape.name}`}
                title={`Place "${shape.name}" in the middle of the view (Alt+↑/↓ to reorder)`}
                className="flex w-full flex-col items-center gap-0.5 rounded px-1 pt-1.5 pb-0.5 text-[11px] leading-tight text-gray-200 hover:bg-gray-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400"
              >
                <Puzzle className="h-4 w-4 text-amber-400/90" aria-hidden="true" />
                <span className="line-clamp-2 text-center">{shape.name}</span>
              </button>
              <div className="flex items-center justify-center gap-0.5 pb-1">
                <IconButton
                  label={`Move ${shape.name} up`}
                  disabled={index === 0}
                  onClick={() => onMove(shape.id, -1)}
                >
                  <ChevronUp className="h-3 w-3" aria-hidden="true" />
                </IconButton>
                <IconButton
                  label={`Move ${shape.name} down`}
                  disabled={index === count - 1}
                  onClick={() => onMove(shape.id, 1)}
                >
                  <ChevronDown className="h-3 w-3" aria-hidden="true" />
                </IconButton>
                <IconButton label={`Remove ${shape.name} from favorites`} onClick={() => onRemove(shape.id)}>
                  <Star className="h-3 w-3 text-amber-400" fill="currentColor" aria-hidden="true" />
                </IconButton>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function IconButton({ label, disabled = false, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
