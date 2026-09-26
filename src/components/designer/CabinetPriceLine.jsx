"use client";

import { bookLabel, priceCabinet } from "@/domains/roomDesigner/cabinetPriceBooks";
import { formatUSD } from "@/domains/roomDesigner/homeEstimate";

/**
 * In the cabinet inspector: the cabinet's code at its current size (B24,
 * W2430, ...) and what the design's chosen supplier charges for it — or why
 * it can't be priced (not on the list, discontinued, no price). The
 * supplier dropdown is the same design-wide choice as the Cabinet estimate.
 */
export default function CabinetPriceLine({ piece, design, dispatch, books }) {
  const bookId = design.settings?.cabinetPriceBookId || "";
  const book = books.find((b) => b.id === bookId) || null;
  const priced = priceCabinet(book, piece);
  if (priced.status === "not-a-cabinet") return null;

  let detail;
  if (!book) detail = <span className="text-gray-500">Choose a supplier to see its price.</span>;
  else if (priced.status === "priced") {
    detail = (
      <span className="text-gray-200">
        {priced.item.name} · #{priced.item.sku || "—"} · <strong className="text-emerald-300">{formatUSD(priced.item.priceCents)}</strong>
      </span>
    );
  } else if (priced.status === "discontinued") detail = <span className="text-amber-300">{priced.item.name} is discontinued.</span>;
  else if (priced.status === "no-price") detail = <span className="text-amber-300">{priced.item.name} has no price entered.</span>;
  else detail = <span className="text-amber-300">{priced.code} isn&apos;t on this supplier&apos;s list — try a standard size.</span>;

  return (
    <div className="rounded border border-gray-800 p-2 text-xs" data-testid="cabinet-price-line">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-gray-400">Cabinet code</span>
        <span className="font-mono text-sm font-semibold text-amber-200">{priced.code}</span>
      </div>
      <label className="mb-1 block text-gray-400">
        Supplier
        <select
          aria-label="Supplier for pricing"
          value={bookId}
          onChange={(e) => dispatch({ type: "UPDATE_SETTINGS", settings: { cabinetPriceBookId: e.target.value || null } })}
          className="mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-white"
        >
          <option value="">— Choose a supplier —</option>
          {books.map((b) => (
            <option key={b.id} value={b.id}>{bookLabel(b)}</option>
          ))}
        </select>
      </label>
      <p>{detail}</p>
    </div>
  );
}
