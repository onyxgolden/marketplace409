"use client";

import { useEffect, useMemo, useState } from "react";
import { FURNITURE_CATALOG } from "@/domains/roomDesigner/furnitureCatalog";
import { listSymbolSets } from "@/domains/roomDesigner/symbolRegistry";
import { buildShapeSearchIndex, searchShapes } from "@/domains/roomDesigner/designerShapeSearch";
import { ChevronDown, ChevronRight, Shapes, Star } from "lucide-react";
import { MobileDrawer } from "./MobileDrawer";

/**
 * Former localStorage key for remembered collapsed categories. No longer read:
 * every category now starts collapsed each session (owner decision).
 */
export const COLLAPSED_STORAGE_KEY = "forge-designer.tool-categories.collapsed.v1";

/** localStorage key for the user's favorite tool ids (left palette). */
export const FAVORITE_STORAGE_KEY = "forge-designer.favorite-tools.v1";

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

function ToolButton({ tool, active, disabled, favorite, onSelect, onToggleFavorite, showLabel = false }) {
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
        className={`flex w-full flex-col items-center gap-1 rounded px-1 py-1.5 text-[8px] ${
          active ? "bg-emerald-600 text-white" : "text-gray-300 hover:bg-gray-800"
        } ${disabled ? "cursor-not-allowed opacity-40 hover:bg-transparent" : ""}`}
      >
        <Icon size={13} aria-hidden="true" />
        {/* Phone layout: the icon rail hides labels below md, but the All
            tools drawer (always below md) must show them — it is the only
            surface where a phone user can identify a tool. */}
        <span className={showLabel ? "" : "hidden md:inline"}>{tool.label}</span>
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
 *
 * Phone layout: below md the palette is a slim icon rail (pinned tools plus
 * an "All tools" button). The full library — search, favorites, stencil
 * categories — opens in a left-anchored drawer controlled by
 * `mobileToolsOpen` / `onToggleMobileTools` (owned by the screen so drawers
 * stay exclusive).
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
  // Rendered right under the pinned tools. The screen passes the shape
  // library's Favorites section here: favorite SHAPES get their own ordered,
  // one-tap section, so they are left out of the generic Favorites category
  // below instead of appearing twice.
  favoritesSection = null,
  // Shape search picked a furniture/symbol result: arm it for placement.
  onPickShape = null,
  // Phone layout: full-library drawer below md (state owned by the screen so
  // the panel/tools/House Plans drawers stay mutually exclusive).
  mobileToolsOpen = false,
  onToggleMobileTools = null,
}) {
  // Every category starts collapsed each time the designer opens (owner
  // decision); expanding is per session and deliberately not remembered.
  const [expandedByCategory, setExpandedByCategory] = useState({});
  const [favoriteIds, setFavoriteIds] = useState(readFavoriteToolIds);
  const [query, setQuery] = useState("");

  // Persist favorites on every change.
  useEffect(() => {
    try {
      window.localStorage.setItem(FAVORITE_STORAGE_KEY, JSON.stringify(favoriteIds));
    } catch {
      // Storage may be unavailable (private mode, quota); favorites still work in-memory.
    }
  }, [favoriteIds]);

  const toggleCategory = (categoryId) =>
    setExpandedByCategory((prev) => ({ ...prev, [categoryId]: !prev[categoryId] }));

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
  // display order, ignoring stale ids that no longer exist. Tools whose star
  // is owned elsewhere (custom shapes) are shown by `favoritesSection`.
  const favoriteTools = allTools.filter((tool) => !ownedElsewhere(tool.id) && isFavorite(tool.id));
  const categories =
    favoriteTools.length > 0
      ? [{ id: "favorites", label: "Favorites", tools: favoriteTools }, ...grouped.categories]
      : grouped.categories;

  const renderTool = (tool, showLabel = false, selectFn = onSelect) => (
    <ToolButton
      key={tool.id}
      tool={tool}
      active={activeToolId === tool.id}
      disabled={tool.needsUnderlay && !hasUnderlay}
      favorite={isFavorite(tool.id)}
      onSelect={selectFn}
      onToggleFavorite={handleToggleFavorite}
      showLabel={showLabel}
    />
  );

  // One search across palette tools (incl. saved shapes), furniture and
  // every symbol domain. While a query is typed, results replace the
  // favorites and categories.
  const searchIndex = useMemo(
    () => buildShapeSearchIndex({ tools: allTools, furniture: FURNITURE_CATALOG, symbolSets: listSymbolSets() }),
    // allTools is rebuilt each render from `grouped`; key the index on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grouped],
  );
  const results = query.trim() ? searchShapes(searchIndex, query, 40) : null;
  const pickResult = (result, selectFn = onSelect, pickShapeFn = onPickShape) => {
    if (result.kind === "tool") selectFn(result.id);
    else if (typeof pickShapeFn === "function") pickShapeFn(result);
  };

  // Phone drawer: picking a tool also closes the drawer (one tap returns to
  // the canvas). The toggle closes because the drawer is open when tapped.
  const selectAndCloseDrawer = (toolId) => {
    onSelect(toolId);
    if (mobileToolsOpen && typeof onToggleMobileTools === "function") onToggleMobileTools();
  };

  // Phone drawer: arming a furniture piece, shape, or symbol from search also
  // closes the drawer — otherwise the modal stays over the canvas.
  const pickShapeAndCloseDrawer = (result) => {
    if (typeof onPickShape === "function") onPickShape(result);
    if (mobileToolsOpen && typeof onToggleMobileTools === "function") onToggleMobileTools();
  };

  // The full library: search, results, favorites, stencil categories,
  // ungrouped tools. Rendered docked at md+ and inside the phone drawer below
  // md — one definition so both stay in sync. `showLabels` forces tool names
  // visible: the drawer is always below md, so the responsive `md:inline`
  // labels would otherwise never appear there.
  const renderLibrary = (showLabels = false, selectFn = onSelect, pickShapeFn = onPickShape) => (
    <>
      <input
        type="search"
        aria-label="Search shapes"
        placeholder="Search shapes"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setQuery("");
        }}
        className="mt-1 w-full rounded bg-gray-800 px-1.5 py-1 text-[11px] text-white placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
      {results && (
        <div className="flex flex-col gap-0.5" role="list" aria-label="Shape search results">
          {results.length === 0 && <p className="px-1 text-[10px] text-gray-500">No shapes match.</p>}
          {results.map((r) => {
            const t = r.kind === "tool" ? toolById.get(r.id) : null;
            const disabled = Boolean(t?.needsUnderlay && !hasUnderlay);
            return (
              <button
                key={`${r.kind}:${r.domain || ""}:${r.id}`}
                type="button"
                role="listitem"
                data-testid="shape-search-result"
                disabled={disabled}
                title={`${r.label} — ${r.group}`}
                onClick={() => pickResult(r, selectFn, pickShapeFn)}
                className="rounded px-1 py-1 text-left text-[11px] leading-tight text-gray-200 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {r.label}
                <span className="block truncate text-[9px] text-gray-500">{r.group}</span>
              </button>
            );
          })}
        </div>
      )}
      {!results && favoritesSection}
      {!results && categories.map((category) => {
        const collapsed = !expandedByCategory[category.id];
        const Chevron = collapsed ? ChevronRight : ChevronDown;
        return (
          <div key={category.id} className="mt-1">
            <button
              type="button"
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${category.label} tools`}
              onClick={() => toggleCategory(category.id)}
              className="mb-1 flex w-full items-center gap-1 rounded px-1 py-1 text-left text-[8px] font-semibold uppercase tracking-wide text-gray-500 hover:bg-gray-800 hover:text-gray-300"
            >
              <Chevron className="h-2 w-2 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {category.label} ({category.tools.length})
              </span>
            </button>
            {!collapsed && <div className="flex flex-col gap-1">{category.tools.map((t) => renderTool(t, showLabels, selectFn))}</div>}
          </div>
        );
      })}
      {!results && grouped.ungrouped.map((t) => renderTool(t, showLabels, selectFn))}
    </>
  );

  return (
    <nav
      // Phone layout: slim icon rail below md (pinned tools + an "All tools"
      // button that opens the full library drawer); the full labeled palette
      // with search and stencil categories returns at md+.
      className="flex w-12 shrink-0 flex-col gap-1 overflow-y-auto border-r border-gray-800 bg-gray-900 p-1 md:w-28 md:p-2"
      aria-label="Tools"
    >
      {grouped.pinned.map((t) => renderTool(t))}
      {/* Phone layout: the rail shows pinned tools only, so this button opens
          the full library (search, categories, favorites) in a drawer. */}
      <button
        type="button"
        onClick={onToggleMobileTools}
        aria-expanded={mobileToolsOpen}
        aria-label="All tools"
        title="All tools"
        className={`flex w-full flex-col items-center gap-0.5 rounded px-1 py-2 text-gray-300 hover:bg-gray-800 md:hidden ${
          mobileToolsOpen ? "bg-emerald-600 text-white" : ""
        }`}
      >
        <Shapes size={20} aria-hidden="true" />
        <span className="text-[10px] font-semibold">All</span>
      </button>
      <div className="hidden md:contents">
        {renderLibrary()}
      </div>
      <MobileDrawer
        open={mobileToolsOpen}
        // Toggle-when-open closes the drawer; drawers are exclusive.
        onClose={onToggleMobileTools}
        label="All tools"
        side="left"
      >
        {renderLibrary(/* showLabels */ true, selectAndCloseDrawer, pickShapeAndCloseDrawer)}
      </MobileDrawer>
    </nav>
  );
}
