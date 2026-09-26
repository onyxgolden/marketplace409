"use client";
import { useState } from "react";
import RentalApplicationShell, { resolveRentalSectionParam } from "./RentalApplicationShell";
// initialSection is the raw `?section=` URL value (e.g. from the /forge/property compatibility
// redirect). It resolves to a function id via resolveRentalSectionParam; anything unrecognized
// -- including retired ids -- falls back to "overview" through resolveActiveFunction.
export default function RentalPageClient({ initialSection = null }) {
  const [activeFunctionId, setActiveFunctionId] = useState(() => resolveRentalSectionParam(initialSection) ?? "overview");
  const [activeRecordContext, setActiveRecordContext] = useState(null);
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
  return <RentalApplicationShell activeFunctionId={activeFunctionId} activeRecordContext={activeRecordContext} activeViewFilter={activeViewFilter} onFunctionChange={navigate} />;
}
