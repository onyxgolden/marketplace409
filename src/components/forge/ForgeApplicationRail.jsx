"use client";

import Link from "next/link";
import {
  usePathname,
} from "next/navigation";
import {
  useState,
} from "react";

import {
  WorkspaceLinks,
  WorkspaceRightRail,
} from "@/components/workspace-shell";

// Rental Manager and Programmer were promoted to their own sibling
// workspaces (see src/lib/workspaces.js) — this list is now Forge's
// *internal* sub-navigation only. Their own nested layouts
// (forge/rental/layout.js, forge/developer/layout.js) supply the outer
// workspace shell instead, and this rail steps aside for those subtrees
// below (see PROMOTED_PREFIXES).
export const FORGE_APPLICATIONS =
  Object.freeze([
    Object.freeze({
      href: "/forge",
      label: "Workspace",
      shortLabel: "W",
      exact: true,
    }),
    Object.freeze({
      href: "/forge/financial",
      label: "Financial",
      shortLabel: "$",
    }),
    Object.freeze({
      href: "/forge/property",
      label: "Property",
      shortLabel: "P",
    }),
    Object.freeze({
      href: "/forge/connections",
      label: "Connections",
      shortLabel: "C",
    }),
    Object.freeze({
      href: "/forge/results",
      label: "Results",
      shortLabel: "R",
    }),
    Object.freeze({
      href: "/forge/import",
      label: "Import",
      shortLabel: "I",
    }),
  ]);

export const PROMOTED_PREFIXES = ["/forge/rental", "/forge/developer"];

export function isPromotedSubtree(pathname) {
  return PROMOTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isForgeApplicationActive(
  pathname,
  application,
) {
  if (
    application.exact
  ) {
    return pathname ===
      application.href;
  }

  return (
    pathname ===
      application.href ||
    pathname.startsWith(
      `${application.href}/`,
    )
  );
}

function ForgeApplicationLinks({
  pathname,
  expanded,
  onNavigate,
  applications =
    FORGE_APPLICATIONS,
}) {
  return (
    <nav
      aria-label="Forge applications"
      className="space-y-2"
    >
      {applications.map(
        (application) => {
          const active =
            isForgeApplicationActive(
              pathname,
              application,
            );

          return (
            <Link
              key={application.href}
              href={application.href}
              title={
                expanded
                  ? undefined
                  : application.label
              }
              aria-current={
                active
                  ? "page"
                  : undefined
              }
              onClick={onNavigate}
              className={[
                "flex min-h-12 items-center rounded-xl border text-sm font-black transition",
                expanded
                  ? "gap-3 px-3"
                  : "justify-center px-2",
                active
                  ? "border-amber-400 bg-amber-400 text-slate-950 shadow"
                  : "border-white/10 bg-white/5 text-slate-200 hover:border-white/25 hover:bg-white/10 hover:text-white",
              ].join(" ")}
            >
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/20 text-sm"
              >
                {application.shortLabel}
              </span>

              {expanded && (
                <span className="truncate">
                  {application.label}
                </span>
              )}
            </Link>
          );
        },
      )}
    </nav>
  );
}

export default function ForgeApplicationRail({
  children,
}) {
  const pathname =
    usePathname();
  const [
    expanded,
    setExpanded,
  ] = useState(false);
  const [
    mobileOpen,
    setMobileOpen,
  ] = useState(false);

  // /forge/rental and /forge/developer are their own promoted workspaces
  // now — their nested layouts already supply WorkspaceShell, so this
  // rail must not wrap them in Forge's own chrome as well.
  if (isPromotedSubtree(pathname)) {
    return <>{children}</>;
  }

  return (
    <div
      data-forge-route-shell
      className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-950 lg:flex"
    >
      <aside
        data-forge-application-rail
        data-expanded={
          expanded
            ? "true"
            : "false"
        }
        className={[
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-800 bg-slate-950 p-3 text-white shadow-xl transition-[width] duration-200 lg:flex",
          expanded
            ? "w-60"
            : "w-20",
        ].join(" ")}
      >
        <div
          className={[
            "mb-5 flex items-center",
            expanded
              ? "justify-between gap-3"
              : "justify-center",
          ].join(" ")}
        >
          {expanded && (
            <Link
              href="/forge"
              className="min-w-0"
            >
              <div className="text-lg font-black tracking-[0.18em]">
                FORGE
              </div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-400">
                Applications
              </div>
            </Link>
          )}

          <button
            type="button"
            aria-label={
              expanded
                ? "Collapse Forge navigation"
                : "Expand Forge navigation"
            }
            aria-expanded={
              expanded
            }
            onClick={() =>
              setExpanded(
                (current) =>
                  !current,
              )
            }
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-lg font-black hover:bg-white/10"
          >
            {expanded
              ? "‹"
              : "F"}
          </button>
        </div>

        {/* Outer cross-workspace switcher — identical to WorkspaceShell's,
           so switching to Rentals/Marketplace/Dev from inside Forge looks
           and behaves the same as it does everywhere else. */}
        <div className="mb-5">
          <WorkspaceLinks pathname={pathname} expanded={expanded} />
        </div>

        <div
          className="mb-3 border-t border-white/10 pt-3"
          aria-hidden={!expanded}
        >
          {expanded && (
            <div className="px-1 pb-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
              Forge
            </div>
          )}
          <ForgeApplicationLinks
            pathname={pathname}
            expanded={expanded}
          />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur lg:hidden">
          <Link
            href="/forge"
            className="font-black tracking-[0.16em] text-slate-950"
          >
            FORGE
          </Link>

          <button
            type="button"
            aria-label="Open Forge navigation"
            aria-expanded={
              mobileOpen
            }
            onClick={() =>
              setMobileOpen(
                (current) =>
                  !current,
              )
            }
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-black"
          >
            Applications
          </button>
        </header>

        {mobileOpen && (
          <div className="fixed inset-0 z-50 bg-slate-950/50 p-4 lg:hidden">
            <aside className="ml-auto flex h-full w-full max-w-xs flex-col rounded-2xl bg-slate-950 p-4 text-white shadow-2xl">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <div className="text-xl font-black tracking-[0.18em]">
                    FORGE
                  </div>
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-400">
                    Applications
                  </div>
                </div>

                <button
                  type="button"
                  aria-label="Close Forge navigation"
                  onClick={() =>
                    setMobileOpen(
                      false,
                    )
                  }
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-xl"
                >
                  ×
                </button>
              </div>

              <div className="mb-5">
                <WorkspaceLinks
                  pathname={pathname}
                  expanded
                  onNavigate={() => setMobileOpen(false)}
                />
              </div>

              <div className="border-t border-white/10 pt-3">
                <div className="px-1 pb-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                  Forge
                </div>
                <ForgeApplicationLinks
                  pathname={pathname}
                  expanded
                  onNavigate={() =>
                    setMobileOpen(
                      false,
                    )
                  }
                />
              </div>
            </aside>
          </div>
        )}

        <div
          data-forge-route-content
          className="min-w-0"
        >
          {children}
        </div>
      </div>

      <WorkspaceRightRail />
    </div>
  );
}
