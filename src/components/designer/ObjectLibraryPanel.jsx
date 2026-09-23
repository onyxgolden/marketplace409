"use client";

import { useState } from "react";
import { listSymbolSets } from "@/domains/roomDesigner/symbolRegistry";
import SymbolThumbnail from "./SymbolThumbnail";

// Object domains shown in the library. Sets are DISCOVERED through the
// registry (listSymbolSets) — the panel owns no catalog data and creates
// no parallel registry. Room templates/structures and the piping domain
// keep their own panels and are deliberately excluded: objects only.
const LIBRARY_DOMAINS = Object.freeze([
  "furniture",
  "buildingElements",
  "siteOutdoor",
  "mepFixtures",
]);

/** Category names in first-appearance order within the domain's symbols. */
function categoriesOf(set) {
  const order = [];
  for (const s of set?.symbols || []) {
    if (s.category && !order.includes(s.category)) order.push(s.category);
  }
  return order;
}

function availableDomains() {
  const order = new Map(LIBRARY_DOMAINS.map((domain, i) => [domain, i]));
  return listSymbolSets()
    .filter((set) => order.has(set.domain))
    .sort((a, b) => order.get(a.domain) - order.get(b.domain));
}

const selectClass =
  "block w-full rounded bg-gray-800 px-2 py-1.5 text-xs text-white";

export default function ObjectLibraryPanel({
  dispatch,
  pendingCatalogId,
  pendingSymbol,
  initialDomain = "furniture",
}) {
  const domains = availableDomains();
  const startDomain =
    domains.find((s) => s.domain === pendingSymbol?.domain) ||
    domains.find((s) => s.domain === initialDomain) ||
    domains[0];
  const [domainId, setDomainId] = useState(startDomain?.domain);
  const activeSet = domains.find((s) => s.domain === domainId) || domains[0];
  const categories = categoriesOf(activeSet);
  const [category, setCategory] = useState(categories[0]);

  if (!activeSet) return null;

  const activeCategory = categories.includes(category) ? category : categories[0];
  const items = (activeSet.symbols || []).filter((s) => s.category === activeCategory);

  const selectDomain = (nextDomain) => {
    setDomainId(nextDomain);
    setCategory(categoriesOf(domains.find((s) => s.domain === nextDomain))[0]);
  };

  // Furniture keeps its EXISTING placement contract (SET_PENDING_CATALOG ->
  // design.furniture); every other domain goes through the EXISTING symbol
  // pipeline (SET_PENDING_SYMBOL -> PLACE_SYMBOL -> design.symbols). The
  // library is a view layer: no new creation path.
  const placeItem = (item) => {
    if (activeSet.domain === "furniture") {
      dispatch({ type: "SET_PENDING_CATALOG", catalogId: item.id });
    } else {
      dispatch({ type: "SET_PENDING_SYMBOL", domain: activeSet.domain, symbolId: item.id });
    }
  };

  const isActive = (item) =>
    activeSet.domain === "furniture"
      ? pendingCatalogId === item.id
      : pendingSymbol?.domain === activeSet.domain && pendingSymbol?.symbolId === item.id;

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-white">Object library</h2>
      <p className="mb-3 text-xs text-gray-400">Pick an object, then click the plan to place it.</p>

      <label className="mb-2 block text-xs text-gray-400">
        Domain
        <select
          aria-label="Object domain"
          value={activeSet.domain}
          onChange={(e) => selectDomain(e.target.value)}
          className={`${selectClass} mt-1`}
        >
          {domains.map((s) => (
            <option key={s.domain} value={s.domain}>
              {s.title}
            </option>
          ))}
        </select>
      </label>

      <label className="mb-3 block text-xs text-gray-400">
        Category
        <select
          aria-label="Object category"
          value={activeCategory}
          onChange={(e) => setCategory(e.target.value)}
          className={`${selectClass} mt-1`}
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c} ({activeSet.symbols.filter((s) => s.category === c).length})
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-3 gap-1.5" role="listbox" aria-label={`${activeSet.title} objects`}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={isActive(item)}
            title={`${item.label} — ${item.widthIn}″ × ${item.depthIn}″`}
            onClick={() => placeItem(item)}
            className={`flex flex-col items-center rounded border p-1.5 text-center ${
              isActive(item)
                ? "border-emerald-500 bg-emerald-900/40 text-white"
                : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500"
            }`}
          >
            <SymbolThumbnail domain={activeSet.domain} symbolId={item.id} />
            <span className="mt-1 block w-full truncate text-[11px] leading-tight">{item.label}</span>
            <span className="block text-[10px] text-gray-500">
              {item.widthIn}″ × {item.depthIn}″
            </span>
          </button>
        ))}
      </div>
      {items.length === 0 && (
        <p className="text-xs text-gray-500">No objects in this category yet.</p>
      )}
    </div>
  );
}
