"use client";

import PropertyConditionAssessmentPanel from "./PropertyConditionAssessmentPanel";
import PropertyHVACPanel from "./PropertyHVACPanel";
import PropertyValuationPanel from "./PropertyValuationPanel";
import ApplicationShell from "@/components/forge/workspace/ApplicationShell";

export const PROPERTY_FUNCTIONS =
  Object.freeze([
    Object.freeze({
      id: "valuations",
      label: "Valuations",
    }),
    Object.freeze({
      id: "condition",
      label: "Condition",
    }),
    Object.freeze({
      id: "hvac",
      label: "HVAC & Evidence",
    }),
  ]);

export function buildPropertyActiveSurface({
  activeFunctionId,
}) {
  switch (activeFunctionId) {
    case "condition":
      return (
        <PropertyConditionAssessmentPanel />
      );

    case "hvac":
      return (
        <PropertyHVACPanel />
      );

    case "valuations":
    default:
      return (
        <PropertyValuationPanel />
      );
  }
}

export default function PropertyApplicationShell({
  activeFunctionId,
  onFunctionChange,
}) {
  const activeSurface =
    buildPropertyActiveSurface({
      activeFunctionId,
    });

  return (
    <ApplicationShell
      applicationName="Property"
      applicationDescription="Property value, standardized condition history, HVAC systems, service events, and private evidence."
      functions={PROPERTY_FUNCTIONS}
      activeFunctionId={
        activeFunctionId
      }
      onFunctionChange={
        onFunctionChange
      }
      activeSurface={
        <div className="space-y-5">
          {activeSurface}
        </div>
      }
    />
  );
}
