"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Building2,
  Ellipsis,
  Landmark,
  LayoutDashboard,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useSidebarHiddenItems } from "./useSidebarHiddenItems";
import SidebarCustomizePopover from "./SidebarCustomizePopover";

// Simplifi-app style bottom navigation: the first four functions get their own tab, everything
// else lives behind "More". Order follows the caller's functions list.
const MOBILE_PRIMARY_TAB_IDS = Object.freeze([
  "overview",
  "transactions",
  "properties",
  "assets",
]);

const MOBILE_TAB_ICONS = Object.freeze({
  overview: LayoutDashboard,
  transactions: ArrowLeftRight,
  properties: Building2,
  assets: Landmark,
});

const mobileBottomTabActiveClassName =
  "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[10px] font-black uppercase tracking-wide bg-slate-950 text-white dark:bg-amber-400 dark:text-slate-950";
const mobileBottomTabIdleClassName =
  "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[10px] font-black uppercase tracking-wide text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white";

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
  // Opt-in Simplifi-style mobile treatment: <lg gets a fixed bottom nav (first four functions
  // + a "More" sheet) instead of the scrolling chip row. Defaults off so the other apps
  // (Property, Rental) keep their current mobile behavior untouched.
  mobileBottomNav = false,
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

  // Mobile bottom-nav state and tab split. Honors the same hide/show preferences as the desktop
  // chips: a hidden function disappears from both the four primary tabs and the More sheet.
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  // Focus management for the More sheet (aria-modal="true" needs it): the More trigger ref gets
  // focus back on close; the sheet panel and its close button are focused/trapped while open.
  const moreButtonRef = useRef(null);
  const sheetPanelRef = useRef(null);
  const sheetCloseButtonRef = useRef(null);
  const prevMoreSheetOpenRef = useRef(false);
  const primaryTabs = mobileBottomNav
    ? visibleFunctions.filter((item) => MOBILE_PRIMARY_TAB_IDS.includes(item.id))
    : [];
  const moreTabs = mobileBottomNav
    ? visibleFunctions.filter((item) => !MOBILE_PRIMARY_TAB_IDS.includes(item.id))
    : [];
  const moreTabActive = moreTabs.some((item) => item.id === resolvedActiveFunctionId);

  function selectMobileFunction(id) {
    onFunctionChange?.(id);
    setMoreSheetOpen(false);
  }

  // More sheet: Escape closes, focus moves into the sheet on open, Tab is trapped inside it
  // while open, and focus returns to the More trigger on close.
  useEffect(() => {
    if (!moreSheetOpen) {
      if (prevMoreSheetOpenRef.current) {
        prevMoreSheetOpenRef.current = false;
        moreButtonRef.current?.focus?.();
      }
      return undefined;
    }
    prevMoreSheetOpenRef.current = true;
    sheetCloseButtonRef.current?.focus?.();
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setMoreSheetOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const panel = sheetPanelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [moreSheetOpen]);

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
              className={
                mobileBottomNav
                  ? "mt-4 hidden max-w-full items-center gap-2 overflow-x-auto pb-1 lg:flex"
                  : "mt-4 flex max-w-full items-center gap-2 overflow-x-auto pb-1"
              }
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
        className={
          mobileBottomNav
            ? // Fixed bottom nav needs clearance on mobile only; desktop keeps the original p-8.
              "mx-auto max-w-[1800px] px-4 pt-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:px-8 lg:pt-8 lg:pb-8"
            : "mx-auto max-w-[1800px] p-4 lg:p-8"
        }
      >
        {activeSurface}
      </main>

      {mobileBottomNav && (
        <nav
          aria-label={`${applicationName} functions`}
          data-mobile-bottom-nav
          className="fixed inset-x-0 bottom-0 z-40 lg:hidden"
        >
          <div className="border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
            <div className="flex items-stretch gap-1 px-2 py-2">
              {primaryTabs.map((item) => {
                const active = item.id === resolvedActiveFunctionId;
                const Icon = MOBILE_TAB_ICONS[item.id] ?? LayoutDashboard;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => selectMobileFunction(item.id)}
                    className={active ? mobileBottomTabActiveClassName : mobileBottomTabIdleClassName}
                  >
                    <Icon aria-hidden="true" className="h-5 w-5" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                ref={moreButtonRef}
                aria-haspopup="dialog"
                aria-expanded={moreSheetOpen}
                aria-current={moreTabActive ? "page" : undefined}
                onClick={() => setMoreSheetOpen((current) => !current)}
                className={moreTabActive && !moreSheetOpen ? mobileBottomTabActiveClassName : mobileBottomTabIdleClassName}
              >
                <Ellipsis aria-hidden="true" className="h-5 w-5" />
                <span>More</span>
              </button>
            </div>
          </div>
        </nav>
      )}

      {mobileBottomNav && moreSheetOpen && (
        <div
          data-mobile-more-sheet
          ref={sheetPanelRef}
          role="dialog"
          aria-modal="true"
          aria-label="More functions"
          className="fixed inset-0 z-50 lg:hidden"
        >
          <button
            type="button"
            aria-label="Close more functions"
            onClick={() => setMoreSheetOpen(false)}
            className="absolute inset-0 cursor-default bg-slate-950/50"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl dark:bg-slate-900">
            <div className="px-5 pb-5 pt-3">
              <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
              <div className="flex items-center justify-between">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  More
                </p>
                <button
                  type="button"
                  ref={sheetCloseButtonRef}
                  onClick={() => setMoreSheetOpen(false)}
                  aria-label="Close more functions"
                  className="rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                >
                  <X aria-hidden="true" className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-3 space-y-1">
                {moreTabs.map((item) => {
                  const active = item.id === resolvedActiveFunctionId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={active ? "page" : undefined}
                      onClick={() => selectMobileFunction(item.id)}
                      className={
                        active
                          ? "flex min-h-[52px] w-full items-center rounded-xl bg-slate-950 px-4 py-3 text-left text-sm font-black text-white dark:bg-amber-400 dark:text-slate-950"
                          : "flex min-h-[52px] w-full items-center rounded-xl border border-slate-200 px-4 py-3 text-left text-sm font-black text-slate-700 hover:border-slate-950 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-400"
                      }
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
              {sidebarKey && (
                <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <SidebarCustomizePopover
                    inline
                    sections={hideableSections}
                    sidebarPrefs={sidebarPrefs}
                    onClose={() => setMoreSheetOpen(false)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
