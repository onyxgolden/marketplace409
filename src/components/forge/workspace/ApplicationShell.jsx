"use client";
import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { useSidebarHiddenItems } from "./useSidebarHiddenItems";
import SidebarCustomizePopover from "./SidebarCustomizePopover";

export function normalizeApplicationFunctions(
  functions,
) {
  if (!Array.isArray(functions)) {
    return Object.freeze([]);
  }

  return Object.freeze(
    functions
      .filter(
        (item) =>
          typeof item?.id ===
            "string" &&
          item.id.trim() &&
          typeof item?.label ===
            "string" &&
          item.label.trim(),
      )
      .map((item) =>
        Object.freeze({
          id:
            item.id.trim(),
          label:
            item.label.trim(),
        }),
      ),
  );
}

export function resolveActiveFunction(
  functions,
  requestedFunctionId,
) {
  const normalizedFunctions =
    normalizeApplicationFunctions(
      functions,
    );

  const requestedId =
    String(
      requestedFunctionId || "",
    ).trim();

  return (
    normalizedFunctions.find(
      (item) =>
        item.id === requestedId,
    )?.id ||
    normalizedFunctions[0]?.id ||
    null
  );
}

export default function ApplicationShell({
  applicationName,
  applicationDescription = null,
  functions = [],
  activeFunctionId,
  onFunctionChange,
  utility = null,
  activeSurface,
  sidebarKey = null,
}) {
  const normalizedFunctions =
    normalizeApplicationFunctions(
      functions,
    );

  // The first function is this application's landing view and can never be hidden -- same rule as
  // Rental Manager's "Overview" group, just applied by position instead of by label, since a flat
  // functions list (Financial, Property) has no named "Overview" group of its own to key off of.
  const homeId = normalizedFunctions[0]?.id ?? null;

  // Inert (no fetch, no persistence, hiddenItemIds always empty) when sidebarKey is falsy, so this
  // filter is a true no-op for any ApplicationShell caller that doesn't opt in -- zero behavior
  // change for Property, which passes no sidebarKey at all.
  const sidebarPrefs = useSidebarHiddenItems(sidebarKey);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const visibleFunctions = normalizedFunctions.filter(
    (item) => item.id === homeId || !sidebarPrefs.hiddenItemIds.has(item.id),
  );

  // Resolved against the FULL function list, not the hidden-filtered one, so a direct/deep link to
  // an item the user has hidden from the nav still renders its content -- hiding only removes it
  // from the picker, it never breaks a link someone already has.
  const resolvedActiveFunctionId =
    resolveActiveFunction(
      normalizedFunctions,
      activeFunctionId,
    );

  const hideableSections = sidebarKey
    ? [Object.freeze({ sectionLabel: null, items: normalizedFunctions.filter((item) => item.id !== homeId) })]
    : [];

  return (
    <section
      data-application-shell
      data-active-function={
        resolvedActiveFunctionId ||
        ""
      }
      className="min-h-screen bg-slate-100 text-slate-950 dark:bg-slate-950 dark:text-slate-100"
    >
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto max-w-[1800px] px-4 py-4 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <div className="min-w-0">
                <div className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">
                  FORGE Application
                </div>

                <h1 className="truncate text-2xl font-black tracking-tight lg:text-3xl dark:text-slate-50">
                  {applicationName}
                </h1>

                {applicationDescription && (
                  <p className="mt-1 max-w-3xl text-sm font-semibold text-slate-600 dark:text-slate-400">
                    {applicationDescription}
                  </p>
                )}
              </div>
            </div>

            {utility && (
              <div data-application-utility>
                {utility}
              </div>
            )}
          </div>

          {visibleFunctions.length >
            0 && (
            <nav
              aria-label={`${applicationName} functions`}
              className="mt-4 flex max-w-full items-center gap-2 overflow-x-auto pb-1"
            >
              {sidebarKey && (
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setCustomizeOpen((current) => !current)}
                    aria-haspopup="dialog"
                    aria-expanded={customizeOpen}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-[11px] font-black uppercase tracking-[0.08em] text-slate-500 hover:border-slate-300 hover:text-slate-950 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-white"
                  >
                    <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
                    <span>Customize</span>
                  </button>
                  {customizeOpen && (
                    <SidebarCustomizePopover
                      sections={hideableSections}
                      sidebarPrefs={sidebarPrefs}
                      onClose={() => setCustomizeOpen(false)}
                    />
                  )}
                </div>
              )}
              {visibleFunctions.map(
                (item) => {
                  const active =
                    item.id ===
                    resolvedActiveFunctionId;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={
                        active
                          ? "page"
                          : undefined
                      }
                      onClick={() =>
                        onFunctionChange?.(
                          item.id,
                        )
                      }
                      className={
                        active
                          ? "shrink-0 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white dark:bg-amber-400 dark:text-slate-950"
                          : "shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-600 transition hover:border-slate-950 hover:text-slate-950 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-400 dark:hover:text-white"
                      }
                    >
                      {item.label}
                    </button>
                  );
                },
              )}
            </nav>
          )}
        </div>
      </header>

      <main
        data-active-function-surface={
          resolvedActiveFunctionId ||
          ""
        }
        className="mx-auto max-w-[1800px] p-4 lg:p-8"
      >
        {activeSurface}
      </main>
    </section>
  );
}
