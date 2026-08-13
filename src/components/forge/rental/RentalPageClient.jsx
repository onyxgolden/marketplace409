"use client";
import { useState } from "react";
import RentalApplicationShell from "./RentalApplicationShell";
export default function RentalPageClient() {
  const [activeFunctionId, setActiveFunctionId] = useState("overview");
  const [activeRecordContext, setActiveRecordContext] = useState(null);
  function navigate(functionId, recordContext = null) { setActiveFunctionId(functionId); setActiveRecordContext(recordContext); }
  return <RentalApplicationShell activeFunctionId={activeFunctionId} activeRecordContext={activeRecordContext} onFunctionChange={navigate} />;
}
