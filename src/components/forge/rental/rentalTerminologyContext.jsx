"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { resolveTermMap, termLabel as resolveTermLabel } from "@/domains/rental-terminology/rentalTerminology";

// Client-side term-map delivery for the rental shell.
//
// RentalTerminologyProvider fetches the workspace's term map once
// (GET /api/rental/terminology) and hands every consumer the same resolver.
// Fail-open by design: terminology is cosmetic, so a failed or slow fetch
// keeps the baseline terms instead of blocking the UI or erroring out.
//
// The context default is the baseline state (no provider needed), so panels
// stay renderable standalone — including in unit tests — and the adoption
// pattern is a single hook call:
//
//   const { termLabel } = useRentalTerminology();
//   <h2>{termLabel("tenant", { plural: true, capitalize: true })}</h2>
//
// updateTerms() lets the Terminology settings page push a freshly saved map
// into the shell immediately (nav labels re-render without a reload).

const defaultState = {
  terms: resolveTermMap(null),
  isLoading: true,
  termLabel: (key, options) => resolveTermLabel(null, key, options),
  updateTerms: () => {},
};

const RentalTerminologyContext = createContext(defaultState);

export function RentalTerminologyProvider({ children }) {
  const [terms, setTerms] = useState(() => resolveTermMap(null));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/rental/terminology", { credentials: "same-origin" });
        const payload = response.ok ? await response.json().catch(() => null) : null;
        if (!cancelled && payload?.terms) setTerms(resolveTermMap(payload.terms));
      } catch {
        // Fail-open: keep the baseline terms.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const updateTerms = useCallback((next) => {
    setTerms(resolveTermMap(next));
  }, []);

  const value = useMemo(() => ({
    terms,
    isLoading,
    updateTerms,
    termLabel: (key, options) => resolveTermLabel(terms, key, options),
  }), [terms, isLoading, updateTerms]);

  return <RentalTerminologyContext.Provider value={value}>{children}</RentalTerminologyContext.Provider>;
}

export function useRentalTerminology() {
  return useContext(RentalTerminologyContext);
}
