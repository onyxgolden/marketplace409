"use client";

import { useMemo, useState } from "react";
import {
  filterListings,
  orderListingsNeutral,
} from "@/lib/dscr/listings";
import { LenderCard, LenderFilters } from "@/components/dscr/LenderCards";

export default function DscrDirectory({ initialLenders }) {
  const [filters, setFilters] = useState({});

  const lenders = useMemo(() => {
    const filtered = filterListings(initialLenders, {
      state: filters.state,
      minLoan: filters.minLoan,
      maxLoan: filters.maxLoan,
      propertyType: filters.propertyType,
      transactionType: filters.transactionType,
    });
    return orderListingsNeutral(filtered);
  }, [initialLenders, filters]);

  return (
    <div>
      <LenderFilters filters={filters} setFilters={setFilters} />

      <div className="mt-4 text-sm text-gray-600">
        {lenders.length} {lenders.length === 1 ? "provider" : "providers"}
        {Object.values(filters).some((v) => v !== undefined && v !== "") &&
          " matching your filters"}
        .
      </div>

      {lenders.length === 0 ? (
        <div className="bg-white rounded-2xl shadow p-8 text-center mt-4">
          <p className="text-gray-600">
            No providers match those filters. Try widening the loan range or
            clearing the state.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
          {lenders.map((l) => (
            <LenderCard key={l.id} lender={l} />
          ))}
        </div>
      )}
    </div>
  );
}
