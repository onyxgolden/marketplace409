"use client";
import { useCallback, useEffect, useState } from "react";
import RentalApplicationShell, { resolveRentalSectionParam } from "./RentalApplicationShell";
import { resolveRentalRecordContextParam } from "./rentalRecordParam";
// initialSection is the raw `?section=` URL value (e.g. from the /forge/property compatibility
// redirect). It resolves to a function id via resolveRentalSectionParam; anything unrecognized
// -- including retired ids -- falls back to "overview" through resolveActiveFunction.
// initialRecordContext is the resolved `?recordType=`/`?recordId=`/`?propertyId=` record
// context (or null): it restores the selected record after a reload instead of dropping
// to the dashboard with no property selected.

// Record drill-downs are real history entries: every navigate() pushes a URL,
// so tenant/property/ledger views are deep-linkable and the browser Back and
// Forward buttons restore the section and record instead of leaving the app.
function rentalUrlFor(functionId, recordContext) {
  const params = new URLSearchParams();
  if (functionId && functionId !== "overview") params.set("section", functionId);
  if (recordContext?.recordType && recordContext?.recordId) {
    params.set("recordType", recordContext.recordType);
    params.set("recordId", recordContext.recordId);
    if (recordContext.propertyId) params.set("propertyId", recordContext.propertyId);
  }
  const query = params.toString();
  return query ? `${window.location.pathname}?${query}` : window.location.pathname;
}

function stateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    functionId: resolveRentalSectionParam(params.get("section")) ?? "overview",
    recordContext: resolveRentalRecordContextParam({
      recordType: params.get("recordType"),
      recordId: params.get("recordId"),
      propertyId: params.get("propertyId"),
    }),
  };
}

export default function RentalPageClient({ initialSection = null, initialRecordContext = null }) {
  const [activeFunctionId, setActiveFunctionId] = useState(() => resolveRentalSectionParam(initialSection) ?? "overview");
  const [activeRecordContext, setActiveRecordContext] = useState(() => initialRecordContext);
  const [activeViewFilter, setActiveViewFilter] = useState(null);
  // viewFilter is a dashboard deep-link affordance ("show me just the vacant
  // units"): it narrows the destination panel's queue and renders a banner with
  // a one-click clear. Plain sidebar navigation always passes null, which
  // clears any active filter.
  const navigate = useCallback((functionId, recordContext = null, viewFilter = null) => {
    setActiveFunctionId(functionId);
    setActiveRecordContext(recordContext);
    setActiveViewFilter(viewFilter);
    // The record label is display-only metadata: it rides in history.state so
    // Back/Forward restores the banner text, but it never pollutes the URL.
    window.history.pushState({ recordLabel: recordContext?.recordLabel || null }, "", rentalUrlFor(functionId, recordContext));
  }, []);
  // Mount-time normalization: the server rendered from these same params, but a
  // client-side mount (or a retired section id resolving to overview) leaves a
  // canonical URL behind via replaceState -- no extra history entry.
  useEffect(() => {
    window.history.replaceState(
      { recordLabel: initialRecordContext?.recordLabel || null },
      "",
      rentalUrlFor(resolveRentalSectionParam(initialSection) ?? "overview", initialRecordContext),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Browser Back/Forward: re-derive the section and record from the URL. A
  // hard reload (no history.state) falls back to the generic record label,
  // exactly like the initial server render.
  useEffect(() => {
    function onPopState(event) {
      const { functionId, recordContext } = stateFromUrl();
      const label = event.state?.recordLabel;
      setActiveFunctionId(functionId);
      setActiveRecordContext(recordContext && label ? { ...recordContext, recordLabel: label } : recordContext);
      setActiveViewFilter(null);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  return <RentalApplicationShell activeFunctionId={activeFunctionId} activeRecordContext={activeRecordContext} activeViewFilter={activeViewFilter} onFunctionChange={navigate} />;
}
