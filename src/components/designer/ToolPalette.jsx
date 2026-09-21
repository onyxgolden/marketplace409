"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/** localStorage key scoping collapsed tool-category state to the designer palette. */
export const COLLAPSED_STORAGE_KEY = "forge-designer.tool-categories.collapsed.v1";

/**
 * Lazily read the collapsed-by-category map ({ [categoryId]: true }).
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

function ToolButton({ tool, active, disabled, onSelect }) {
  const Icon = tool.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(tool.id)}
      title={disabled ? "Import a background image first" : tool.hint}
      disabled={disabled}
      className={`flex w-full flex-col items-center gap-1 rounded px-1 py-2 text-xs ${
        active ? "bg-emerald-600 text-white" : "text-gray-300 hover:bg-gray-800"
      } ${disabled ? "cursor-not-allowed opacity-40 hover:bg-transparent" : ""}`}
    >
      <Icon size={20} aria-hidden="true" />
      {tool.label}
    </button>
  );
}

/**
 * Left tool palette: pinned tools (Select, Erase, Pan) stay on top, then
 * Visio-style collapsible stencil categories (House, Mechanical, Process,
 * Plan). Collapse state persists across reloads.
 */
export default function ToolPalette({ grouped, activeToolId, hasUnderlay, onSelect }) {
  const [collapsedByCategory, setCollapsedByCategory] = useState(readCollapsedByCategory);

  // Persist on every change so the expand/collapse layout survives reloads.
  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(collapsedByCategory));
    } catch {
      // Storage may be unavailable (private mode, quota); the palette still works in-memory.
    }
  }, [collapsedByCategory]);

  const toggleCategory = (categoryId) =>
    setCollapsedByCategory((prev) => ({ ...prev, [categoryId]: !prev[categoryId] }));

  const renderTool = (tool) => (
    <ToolButton
      key={tool.id}
      tool={tool}
      active={activeToolId === tool.id}
      disabled={tool.needsUnderlay && !hasUnderlay}
      onSelect={onSelect}
    />
  );

  return (
    <nav
      className="flex w-28 flex-col gap-1 overflow-y-auto border-r border-gray-800 bg-gray-900 p-2"
      aria-label="Tools"
    >
      {grouped.pinned.map(renderTool)}
      {grouped.categories.map((category) => {
        const collapsed = Boolean(collapsedByCategory[category.id]);
        const Chevron = collapsed ? ChevronRight : ChevronDown;
        return (
          <div key={category.id} className="mt-1">
            <button
              type="button"
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${category.label} tools`}
              onClick={() => toggleCategory(category.id)}
              className="mb-1 flex w-full items-center gap-1 rounded px-1 py-1 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 hover:bg-gray-800 hover:text-gray-300"
            >
              <Chevron className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {category.label} ({category.tools.length})
              </span>
            </button>
            {!collapsed && <div className="flex flex-col gap-1">{category.tools.map(renderTool)}</div>}
          </div>
        );
      })}
      {grouped.ungrouped.map(renderTool)}
    </nav>
  );
}
