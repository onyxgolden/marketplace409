"use client";
import { useState } from "react";
import RentalApplicationShell from "./RentalApplicationShell";
export default function RentalPageClient() {
  const [activeFunctionId, setActiveFunctionId] = useState("overview");
  return <RentalApplicationShell activeFunctionId={activeFunctionId} onFunctionChange={setActiveFunctionId} />;
}
