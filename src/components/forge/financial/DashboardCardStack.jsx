"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";

import { useDashboardLayout } from "./useDashboardLayout.js";
import { ForgeEmptyState } from "@/components/forge/ForgeStates";

// Renders a reorderable/hideable stack of dashboard cards.
//
// cards: [{ id, title, element }] -- `element` is the card's own content,
// wrapped untouched (panels keep their internals). `cardIds` is the default
// order registry from dashboardCardLayout.js. `storageKey` is the
// user-scoped localStorage key.
//
// Reorder uses up/down controls (not drag): reliable on touch, keyboard
// operable, and deterministic to test. Hidden cards are listed in the
// customize bar with a Show control, so nothing can be lost; "Reset to
// defaults" restores the original layout in one tap.
export default function DashboardCardStack({
  storageKey,
  cardIds,
  cards,
  className = "",
  customizeLabel = "Customize cards",
  ...rest
}) {
  // The storageKey ends with ":sections" or ":kpis"; the matching server
  // layout key ("financial-sections" / "financial-kpis") enables
  // cross-device sync for that zone. A key without a known zone suffix
  // stays localStorage-only.
  const syncKey = (() => {
    if (typeof storageKey !== "string") return null;
    if (storageKey.endsWith(":sections")) return "financial-sections";
    if (storageKey.endsWith(":kpis")) return "financial-kpis";
    return null;
  })();
  const {
    visibleCardIds,
    hiddenCardIds,
    isCustomized,
    moveUp,
    moveDown,
    hideCard,
    showCard,
    showAllCards,
    resetLayout,
  } = useDashboardLayout(storageKey, cardIds, syncKey);

  const [customizing, setCustomizing] = useState(false);

  const byId = useMemo(
    () => new Map(cards.map((card) => [card.id, card])),
    [cards],
  );
  const visibleCards = visibleCardIds
    .map((id) => byId.get(id))
    .filter(Boolean);
  const hiddenCards = hiddenCardIds
    .map((id) => byId.get(id))
    .filter(Boolean);

  const controlButtonClassName =
    "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-slate-600 transition hover:border-slate-400 hover:text-slate-950 disabled:opacity-30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white";

  return (
    <div className={className} data-dashboard-card-stack {...rest}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setCustomizing((current) => !current)}
          aria-pressed={customizing}
          className="flex min-h-[44px] items-center gap-2 rounded-full border border-slate-300 bg-white px-4 text-xs font-black text-slate-600 transition hover:border-slate-400 hover:text-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
        >
          <SlidersHorizontal size={14} aria-hidden="true" />
          {customizing ? "Done" : customizeLabel}
        </button>

        {customizing && (
          <button
            type="button"
            onClick={resetLayout}
            disabled={!isCustomized}
            className="flex min-h-[44px] items-center gap-2 rounded-full border border-slate-300 bg-white px-4 text-xs font-black text-slate-600 transition hover:border-slate-400 hover:text-slate-950 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
          >
            <RotateCcw size={14} aria-hidden="true" />
            Reset to defaults
          </button>
        )}
      </div>

      {customizing && hiddenCards.length > 0 && (
        <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-800/40">
          <p className="text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Hidden cards
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {hiddenCards.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => showCard(card.id)}
                aria-label={`Show ${card.title}`}
                className="flex min-h-[44px] items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 text-xs font-bold text-slate-600 transition hover:border-slate-400 hover:text-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
              >
                <Eye size={14} aria-hidden="true" />
                {card.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {visibleCards.length === 0 ? (
        <div className="mt-3" data-dashboard-cards-empty>
          <ForgeEmptyState
            headline="All dashboard cards are hidden."
            guidance="Nothing to show here until you bring a card back or restore the default layout."
            onAction={showAllCards}
            actionLabel="Show all cards"
          />
          <div className="mt-2 text-center">
            <button
              type="button"
              onClick={resetLayout}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-xs font-black text-slate-500 underline decoration-dotted underline-offset-4 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            >
              <RotateCcw size={14} aria-hidden="true" />
              Or reset to defaults
            </button>
          </div>
        </div>
      ) : (
        visibleCards.map((card, index) => (
          <div
            key={card.id}
            data-dashboard-card={card.id}
            className="relative"
          >
            {customizing && (
              <div className="mb-2 flex min-h-[44px] items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-1 dark:border-sky-800 dark:bg-sky-950/40">
                <span className="truncate text-xs font-black uppercase tracking-wide text-sky-800 dark:text-sky-300">
                  {card.title}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveUp(card.id)}
                    disabled={index === 0}
                    aria-label={`Move ${card.title} up`}
                    className={controlButtonClassName}
                  >
                    <ChevronUp size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDown(card.id)}
                    disabled={index === visibleCards.length - 1}
                    aria-label={`Move ${card.title} down`}
                    className={controlButtonClassName}
                  >
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => hideCard(card.id)}
                    aria-label={`Hide ${card.title}`}
                    className={controlButtonClassName}
                  >
                    <EyeOff size={16} aria-hidden="true" />
                  </button>
                </span>
              </div>
            )}
            {card.element}
          </div>
        ))
      )}
    </div>
  );
}
