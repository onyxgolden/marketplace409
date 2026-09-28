"use client";
import { useEffect, useState } from "react";
import RentalApplicationShell, { resolveRentalSectionParam } from "./RentalApplicationShell";
// initialSection is the raw `?section=` URL value (e.g. from the /forge/property compatibility
// redirect). It resolves to a function id via resolveRentalSectionParam; anything unrecognized
// -- including retired ids -- falls back to "overview" through resolveActiveFunction.
// initialRecordContext is the resolved `?recordType=`/`?recordId=`/`?propertyId=` record
// context (or null): it restores the selected record after a reload instead of dropping
// to the dashboard with no property selected.
export default function RentalPageClient({ initialSection = null, initialRecordContext = null }) {
  const [activeFunctionId, setActiveFunctionId] = useState(() => resolveRentalSectionParam(initialSection) ?? "overview");
  const [activeRecordContext, setActiveRecordContext] = useState(() => initialRecordContext);
  const [activeViewFilter, setActiveViewFilter] = useState(null);
  // viewFilter is a dashboard deep-link affordance ("show me just the vacant
  // units"): it narrows the destination panel's queue and renders a banner with
  // a one-click clear. Plain sidebar navigation always passes null, which
  // clears any active filter.
  function navigate(functionId, recordContext = null, viewFilter = null) {
    setActiveFunctionId(functionId);
    setActiveRecordContext(recordContext);
    setActiveViewFilter(viewFilter);
  }
  // Keep the URL in sync with navigation state (replaceState -- no history spam),
  // so a reload restores the section and the selected record. The dashboard
  // default stays param-free to keep shared/bookmarked URLs clean.
  useEffect(() => {
    const params = new URLSearchParams();
    if (activeFunctionId && activeFunctionId !== "overview") params.set("section", activeFunctionId);
    if (activeRecordContext?.recordType && activeRecordContext?.recordId) {
      params.set("recordType", activeRecordContext.recordType);
      params.set("recordId", activeRecordContext.recordId);
      if (activeRecordContext.propertyId) params.set("propertyId", activeRecordContext.propertyId);
    }
    const query = params.toString();
    window.history.replaceState(null, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);
  }, [activeFunctionId, activeRecordContext]);
  return <RentalApplicationShell activeFunctionId={activeFunctionId} activeRecordContext={activeRecordContext} activeViewFilter={activeViewFilter} onFunctionChange={navigate} />;
}
