"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Star } from "lucide-react";

/** localStorage key scoping collapsed tool-category state to the designer palette. */
export const COLLAPSED_STORAGE_KEY = "forge-designer.tool-categories.collapsed.v1";

/** localStorage key for the user's favorite tool ids (left palette). */
export const FAVORITE_STORAGE_KEY = "forge-designer.favorite-tools.v1";

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
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // Only a strict boolean `true` collapses a category. Valid JSON with
    // wrong-typed values ("false", 0, {}, []) must not silently collapse
    // anything, so anything that is not exactly `true` means expanded.
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value === true));
  } catch {
    return {};
  }
}

/** Lazily read the favorite tool id list; corrupt data falls back to []. */
function readFavoriteToolIds() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FAVORITE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id) => typeof id === "string"))];
  } catch {
    return [];
  }
}

function ToolButton({ tool, active, disabled, favorite, onSelect, onToggleFavorite }) {
  const Icon = tool.icon;
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => onSelect(tool.id)}
        title={disabled ? "Import a background image first" : tool.hint}
        disabled={disabled}
        aria-pressed={active}
        aria-describedby={disabled ? `${tool.id}-disabled-reason` : undefined}
        className={`flex w-full flex-col items-center gap-1 rounded px-1 py-2 text-xs ${
          active ? "bg-emerald-600 text-white" : "text-gray-300 hover:bg-gray-800"
        } ${disabled ? "cursor-not-allowed opacity-40 hover:bg-transparent" : ""}`}
      >
        <Icon size={20} aria-hidden="true" />
        {tool.label}
      </button>
      {disabled && (
        <span id={`${tool.id}-disabled-reason`} className="sr-only">
          Import a background image first to enable this tool.
        </span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(tool.id);
        }}
        aria-pressed={favorite}
        aria-label={`${favorite ? "Remove" : "Add"} ${tool.label} ${favorite ? "from" : "to"} favorites`}
        title={favorite ? "Remove from favorites" : "Add to favorites"}
        className={`absolute right-1 top-1 rounded p-0.5 ${
          favorite ? "text-amber-400" : "text-gray-600 opacity-0 hover:text-amber-400 focus:opacity-100 group-hover:opacity-100"
        }`}
      >
        <Star size={12} aria-hidden="true" fill={favorite ? "currentColor" : "none"} />
      </button>
    </div>
  );
}

/**
 * Left tool palette: pinned tools (Select, Erase, Pan) stay on top, then a
 * Favorites category (hidden until the user stars a tool), then Visio-style
 * collapsible stencil categories (House, Mechanical, Process, Plan, plus any
 * runtime-registered categories such as Custom). Collapse state and
 * favorites persist across reloads.
 */
export default function ToolPalette({
  grouped,
  activeToolId,
  hasUnderlay,
  onSelect,
  // Tools whose starred state is owned elsewhere, as a Map of toolId ->
  // boolean. Custom shapes use this: a shape's star lives on the shape record
  // in the user's library, so it survives a delete-and-re-save and travels
  // with the library, rather than being a second list keyed by tool id here.
  // Tools absent from the map keep using the palette's own favorites.
  externalFavorites = null,
  onToggleExternalFavorite = null,
}) {
  const [collapsedByCategory, setCollapsedByCategory] = useState(readCollapsedByCategory);
  const [favoriteIds, setFavoriteIds] = useState(readFavoriteToolIds);

  // Persist on every change so the expand/collapse layout survives reloads.
  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(collapsedByCategory));
    } catch {
      // Storage may be unavailable (private mode, quota); the palette still works in-memory.
    }
  }, [collapsedByCategory]);

  // Persist favorites on every change.
  useEffect(() => {
    try {
      window.localStorage.setItem(FAVORITE_STORAGE_KEY, JSON.stringify(favoriteIds));
    } catch {
      // Storage may be unavailable (private mode, quota); favorites still work in-memory.
    }
  }, [favoriteIds]);

  const toggleCategory = (categoryId) =>
    setCollapsedByCategory((prev) => ({ ...prev, [categoryId]: !prev[categoryId] }));

  const toggleFavorite = (toolId) =>
    setFavoriteIds((prev) =>
      prev.includes(toolId) ? prev.filter((id) => id !== toolId) : [...prev, toolId]
    );

  // All visible tools by id, in display order (pinned, categories, ungrouped).
  const toolById = new Map();
  const allTools = [
    ...grouped.pinned,
    ...grouped.categories.flatMap((category) => category.tools),
    ...grouped.ungrouped,
  ];
  allTools.forEach((tool) => {
    if (!toolById.has(tool.id)) toolById.set(tool.id, tool);
  });

  const ownedElsewhere = (toolId) =>
    externalFavorites instanceof Map && externalFavorites.has(toolId);
  const isFavorite = (toolId) =>
    ownedElsewhere(toolId) ? externalFavorites.get(toolId) === true : favoriteIds.includes(toolId);
  const handleToggleFavorite = (toolId) => {
    if (ownedElsewhere(toolId)) {
      if (typeof onToggleExternalFavorite === "function") onToggleExternalFavorite(toolId);
      return;
    }
    toggleFavorite(toolId);
  };

  // Favorites render as a category above the stencil groups, in palette
  // display order, ignoring stale ids that no longer exist.
  const favoriteTools = allTools.filter((tool) => isFavorite(tool.id));
  const categories =
    favoriteTools.length > 0
      ? [{ id: "favorites", label: "Favorites", tools: favoriteTools }, ...grouped.categories]
      : grouped.categories;

  const renderTool = (tool) => (
    <ToolButton
      key={tool.id}
      tool={tool}
      active={activeToolId === tool.id}
      disabled={tool.needsUnderlay && !hasUnderlay}
      favorite={isFavorite(tool.id)}
      onSelect={onSelect}
      onToggleFavorite={handleToggleFavorite}
    />
  );

  return (
    <nav
      className="flex w-28 flex-col gap-1 overflow-y-auto border-r border-gray-800 bg-gray-900 p-2"
      aria-label="Tools"
    >
      {grouped.pinned.map(renderTool)}
      {categories.map((category) => {
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
