"use client";
import { useState } from "react";
import RentalApplicationShell from "@/components/forge/rental/RentalApplicationShell";
export default function RentalPage() {
  const [activeFunctionId, setActiveFunctionId] = useState("overview");
  return <RentalApplicationShell activeFunctionId={activeFunctionId} onFunctionChange={setActiveFunctionId} />;
}
