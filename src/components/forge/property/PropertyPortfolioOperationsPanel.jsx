"use client";

import {
  useState,
} from "react";

import PropertyValuationPanel from "./PropertyValuationPanel";

export const PROPERTY_PORTFOLIO_OPERATION_VIEWS =
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
      label: "HVAC",
    }),
  ]);

export default function PropertyPortfolioOperationsPanel({
  initialView = "valuations",
}) {
  const supportedInitialView =
    PROPERTY_PORTFOLIO_OPERATION_VIEWS
      .some(
        ({ id }) =>
          id === initialView,
      )
      ? initialView
      : "valuations";

  const [
    activeView,
    setActiveView,
  ] = useState(
    supportedInitialView,
  );

  return (
    <section
      data-property-portfolio-operations
      className="space-y-5"
    >
      <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
              Property Operations
            </div>

            <h3 className="mt-1 text-xl font-black">
              Value, condition, and major systems
            </h3>
          </div>

          <div
            role="tablist"
            aria-label="Property operations"
            className="flex flex-wrap gap-2"
          >
            {PROPERTY_PORTFOLIO_OPERATION_VIEWS.map(
              (view) => (
                <button
                  key={view.id}
                  type="button"
                  role="tab"
                  aria-selected={
                    activeView ===
                    view.id
                  }
                  onClick={() =>
                    setActiveView(
                      view.id,
                    )
                  }
                  className={
                    activeView ===
                    view.id
                      ? "rounded-xl bg-white px-4 py-2 text-xs font-black text-slate-950"
                      : "rounded-xl border border-slate-700 px-4 py-2 text-xs font-black text-slate-300 transition hover:border-slate-400 hover:text-white"
                  }
                >
                  {view.label}
                </button>
              ),
            )}
          </div>
        </div>
      </div>

      {activeView ===
        "valuations" && (
        <PropertyValuationPanel />
      )}

      {activeView ===
        "condition" && (
        <PreparedOperationSurface
          kind="condition"
          eyebrow="Condition Assessments"
          title="Standardized property condition history"
          detail="Record owner observations against the Texas REI 7-6-aligned checklist, including roof, water-heater, replacement-cost, and capital-priority details."
        />
      )}

      {activeView === "hvac" && (
        <PreparedOperationSurface
          kind="hvac"
          eyebrow="Major Systems"
          title="HVAC systems, components, and service events"
          detail="Track the system separately from compressors, capacitors, blower motors, coils, controls, warranties, invoices, and replacement history."
        />
      )}
    </section>
  );
}

function PreparedOperationSurface({
  kind,
  eyebrow,
  title,
  detail,
}) {
  return (
    <section
      data-property-prepared-operation={
        kind
      }
      className="rounded-2xl border border-slate-200 bg-white p-6"
    >
      <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
        {eyebrow}
      </div>

      <h4 className="mt-2 text-xl font-black text-slate-950">
        {title}
      </h4>

      <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
        {detail}
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-xs font-black uppercase tracking-wide text-emerald-800">
            Manual records
          </div>

          <p className="mt-2 text-sm font-semibold leading-6 text-emerald-950">
            The authenticated storage and history APIs are ready for the interactive editor.
          </p>
        </div>

        <div className="rounded-2xl border border-dashed border-indigo-300 bg-indigo-50 p-4">
          <div className="text-xs font-black uppercase tracking-wide text-indigo-800">
            Evidence-assisted entry
          </div>

          <p className="mt-2 text-sm font-semibold leading-6 text-indigo-950">
            Future photos and documents will create reviewable field proposals before records are saved.
          </p>

          <button
            type="button"
            disabled
            className="mt-3 rounded-xl border border-indigo-300 bg-white px-4 py-2 text-xs font-black text-indigo-500 opacity-70"
          >
            Add from photo or document — planned
          </button>
        </div>
      </div>
    </section>
  );
}
