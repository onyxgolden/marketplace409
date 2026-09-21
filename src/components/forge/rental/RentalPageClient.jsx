"use client";
import { useState } from "react";
import RentalApplicationShell, { resolveRentalSectionParam } from "./RentalApplicationShell";
// initialSection is the raw `?section=` URL value (e.g. from the /forge/property compatibility
// redirect). It resolves to a function id via resolveRentalSectionParam; anything unrecognized
// -- including retired ids -- falls back to "overview" through resolveActiveFunction.
export default function RentalPageClient({ initialSection = null }) {
  const [activeFunctionId, setActiveFunctionId] = useState(() => resolveRentalSectionParam(initialSection) ?? "overview");
  const [activeRecordContext, setActiveRecordContext] = useState(null);
  function navigate(functionId, recordContext = null) { setActiveFunctionId(functionId); setActiveRecordContext(recordContext); }
  return <RentalApplicationShell activeFunctionId={activeFunctionId} activeRecordContext={activeRecordContext} onFunctionChange={navigate} />;
}
