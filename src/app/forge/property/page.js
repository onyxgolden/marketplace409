"use client";

import {
  createElement,
  useState,
} from "react";

import PropertyApplicationShell from "@/components/forge/property/PropertyApplicationShell";

export default function PropertyPage() {
  const [
    activeFunctionId,
    setActiveFunctionId,
  ] = useState("valuations");

  return createElement(
    PropertyApplicationShell,
    {
      activeFunctionId,
      onFunctionChange:
        setActiveFunctionId,
    },
  );
}
