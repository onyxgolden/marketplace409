"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { catalogByCategory } from "@/domains/roomDesigner/furnitureCatalog";

/** localStorage key scoping collapsed furniture-catalog state to the designer panel. */
const COLLAPSED_STORAGE_KEY = "forge-designer.furniture-catalog.collapsed.v1";

/**
 * Lazily read the collapsed-by-category map ({ [category]: true }).
 * Anything missing/unparseable defaults to expanded, so all categories
 * start expanded on first load and after any schema change.
 */
function readCollapsedByCategory() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export default function FurnitureCatalogPanel({ pendingCatalogId, dispatch }) {
  const [collapsedByCategory, setCollapsedByCategory] = useState(readCollapsedByCategory);

  // Persist on every change so the expand/collapse layout survives reloads.
  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(collapsedByCategory));
    } catch {
      // Storage may be unavailable (private mode, quota); the panel still works in-memory.
    }
  }, [collapsedByCategory]);

  const toggleCategory = (category) =>
    setCollapsedByCategory((prev) => ({ ...prev, [category]: !prev[category] }));

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-white">Furniture catalog</h2>
      <p className="mb-3 text-xs text-gray-400">Pick a piece, then click the plan to place it.</p>
      {catalogByCategory().map((group) => {
        const collapsed = Boolean(collapsedByCategory[group.category]);
        const Chevron = collapsed ? ChevronRight : ChevronDown;
        return (
          <div key={group.category} className="mb-2">
            <button
              type="button"
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.category} category`}
              onClick={() => toggleCategory(group.category)}
              className="mb-1 flex w-full items-center gap-1 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-300"
            >
              <Chevron className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {group.category} ({group.items.length})
              </span>
            </button>
            {!collapsed && (
              <div className="grid grid-cols-2 gap-1">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => dispatch({ type: "SET_PENDING_CATALOG", catalogId: item.id })}
                    className={`rounded border p-1.5 text-left text-xs ${
                      pendingCatalogId === item.id
                        ? "border-emerald-500 bg-emerald-900/40 text-white"
                        : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500"
                    }`}
                  >
                    <span className="mb-1 block h-3 w-6 rounded-sm" style={{ background: item.color }} />
                    {item.label}
                    <span className="block text-[10px] text-gray-500">
                      {item.widthIn}″ × {item.depthIn}″
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export { COLLAPSED_STORAGE_KEY };
