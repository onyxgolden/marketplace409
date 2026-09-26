"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Building2,
  Code2,
  DraftingCompass,
  GanttChart,
  Hammer,
  Landmark,
  LayoutGrid,
  Menu,
  Moon,
  Settings,
  Store,
  Sun,
  Tent,
  UserRound,
  X,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { friendlySignOutError, signOutSafely } from "@/lib/auth/signOutSafely.js";
import { useTheme } from "@/components/theme/ThemeProvider";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { WORKSPACES, isWorkspaceActive } from "@/lib/workspaces";
import CommandPaletteHost, { CommandPaletteTrigger } from "@/components/forge/CommandPalette";

const WORKSPACE_ICONS = { Store, Building2, Hammer, GanttChart, DraftingCompass, Code2, Landmark, Tent };

// Named export so ForgeApplicationRail can render the identical
// cross-workspace switcher above its own Forge-internal sub-nav, instead
// of duplicating this markup.
export function WorkspaceLinks({ pathname, expanded, onNavigate }) {
  return (
    <nav aria-label="Workspaces" className="space-y-2">
      {WORKSPACES.map((workspace) => {
        const Icon = WORKSPACE_ICONS[workspace.iconName];
        const active = isWorkspaceActive(pathname, workspace);

        return (
          <Link
            key={workspace.id}
            href={workspace.href}
            title={expanded ? undefined : workspace.name}
            aria-current={active ? "page" : undefined}
            aria-label={expanded ? undefined : workspace.name}
            onClick={onNavigate}
            className={[
              "group relative flex min-h-12 items-center rounded-xl border text-sm font-black transition",
              expanded ? "gap-3 px-3" : "justify-center px-2",
              active
                ? "border-amber-400 bg-amber-400 text-slate-950 shadow"
                : "border-white/10 bg-white/5 text-slate-200 hover:border-white/25 hover:bg-white/10 hover:text-white",
            ].join(" ")}
          >
            <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
            {expanded && <span className="truncate">{workspace.name}</span>}
            {/* Icon-only when collapsed: keyboard users get no visible label from `title` alone,
               so mirror the hover tooltip on :focus-visible as well. aria-hidden because the
               link's aria-label already announces the name. */}
            {!expanded && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white opacity-0 shadow-xl transition group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                {workspace.name}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

// Shared account menu: avatar button + dropdown showing the signed-in email with an explicit
// Sign out item. Rendered in the desktop right rail (tone="dark") and in Forge's mobile header
// (tone="light") so phone users can reach the account menu -- and sign out -- without a
// desktop-width viewport. Sign-out goes through the shared signOutSafely() helper (clears the
// IndexedDB Financial Overview dashboard cache before navigating, so stale financial data never
// survives on a shared device); a failure keeps the menu open with an inline message instead of
// navigating away or alert()ing raw error text.
export function AccountMenu({ tone = "dark" }) {
  const [user, setUser] = useState(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const accountMenuRef = useRef(null);
  const light = tone === "light";

  useEffect(() => {
    let active = true;
    // Created lazily inside the effect (never at module load or during
    // server rendering) so this component stays safe to render statically
    // — e.g. in tests — without a live Supabase URL/key configured.
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (active) setUser(data.user);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError("");
    const result = await signOutSafely({ supabase: createClient(), redirectTo: "/" });
    if (!result.success) {
      // Keep the menu open so the failure is visible where the user acted -- never claim
      // success or navigate away when the sign-out itself failed.
      setSigningOut(false);
      setSignOutError(friendlySignOutError(result.error));
      return;
    }
    setAccountMenuOpen(false);
    // On success, signOutSafely() has already navigated away.
  }

  // Close the account menu on outside click or Escape. The menu itself is the
  // explicit second step, so sign-out can never fire from a single stray
  // click on the avatar.
  useEffect(() => {
    if (!accountMenuOpen) return undefined;
    function onPointerDown(event) {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target)) {
        setAccountMenuOpen(false);
      }
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setAccountMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [accountMenuOpen]);

  return (
    <div className="group relative" ref={accountMenuRef}>
      <button
        type="button"
        aria-label={user ? `Account menu, signed in as ${user.email}` : "Account"}
        aria-haspopup={user ? "menu" : undefined}
        aria-expanded={user ? accountMenuOpen : undefined}
        onClick={user ? () => setAccountMenuOpen((open) => !open) : () => (window.location.href = "/auth")}
        className={
          light
            ? "flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            : "flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 hover:border-white/25 hover:bg-white/10"
        }
      >
        <UserRound aria-hidden="true" className="h-5 w-5" />
      </button>
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold shadow-xl transition group-hover:opacity-100 ${
          light
            ? "right-0 top-full z-50 mt-2 bg-white text-slate-800 opacity-0 dark:bg-slate-900 dark:text-white"
            : "right-full top-1/2 mr-2 -translate-y-1/2 bg-slate-900 text-white opacity-0"
        } ${accountMenuOpen ? "hidden" : ""}`}
      >
        {user ? user.email : "Sign in"}
      </div>
      {user && accountMenuOpen ? (
        <div
          role="menu"
          aria-label="Account"
          className={`absolute z-50 w-56 rounded-xl border p-2 shadow-2xl ${
            light
              ? "right-0 top-full mt-2 border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              : "right-full top-1/2 mr-2 -translate-y-1/2 border-white/10 bg-slate-900 text-white"
          }`}
        >
          <p className={`truncate px-3 py-2 text-xs font-bold ${light ? "text-slate-500 dark:text-slate-400" : "text-slate-300"}`}>
            Signed in as
            <span className={`block truncate text-sm ${light ? "text-slate-950 dark:text-white" : "text-white"}`}>{user.email}</span>
          </p>
          {signOutError ? (
            <p role="alert" className="mx-1 mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-800 dark:bg-red-950/60 dark:text-red-200">
              {signOutError}
            </p>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            disabled={signingOut}
            className={`mt-1 flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-bold disabled:opacity-60 ${
              light
                ? "text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-white/10"
                : "text-red-300 hover:bg-white/10 hover:text-red-200"
            }`}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// Icon-only account/notifications/settings rail. Exported standalone so
// Forge's own ForgeApplicationRail can render the identical rail alongside
// its existing sidebar instead of duplicating this markup.
export function WorkspaceRightRail({ showCommandPalette = false }) {
  const { resolvedTheme, setThemePreference } = useTheme();

  function toggleTheme() {
    setThemePreference(resolvedTheme === "dark" ? "light" : "dark");
  }

  return (
    <aside
      data-workspace-right-rail
      className="sticky top-0 hidden h-screen w-16 shrink-0 flex-col items-center gap-2 border-l border-slate-800 bg-slate-950 py-4 text-white lg:flex"
    >
      <AccountMenu tone="dark" />

      {/* Touch/mouse path to the FORGE command palette on desktop. Only
         rendered when the host shell opts in (promoted Forge subtrees) --
         the Marketplace shell never sets this, so its rail stays clean. */}
      {showCommandPalette ? <CommandPaletteTrigger /> : null}

      {/* Notifications: no backend yet (no cross-workspace notification
         source exists in the app today) — present but inert, not wired to
         fabricated data. */}
      <button
        type="button"
        aria-label="Notifications (not yet available)"
        disabled
        title="Notifications are not available yet"
        className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/5 bg-white/5 text-slate-500"
      >
        <Bell aria-hidden="true" className="h-5 w-5" />
      </button>

      {/* Settings: no account/settings page exists yet — same treatment. */}
      <button
        type="button"
        aria-label="Settings (not yet available)"
        disabled
        title="Settings are not available yet"
        className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/5 bg-white/5 text-slate-500"
      >
        <Settings aria-hidden="true" className="h-5 w-5" />
      </button>

      <button
        type="button"
        aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        onClick={toggleTheme}
        className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 hover:border-white/25 hover:bg-white/10"
      >
        {resolvedTheme === "dark" ? (
          <Sun aria-hidden="true" className="h-5 w-5" />
        ) : (
          <Moon aria-hidden="true" className="h-5 w-5" />
        )}
      </button>
    </aside>
  );
}

export default function WorkspaceShell({ children, forgeCommandPalette = false }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerCloseRef = useRef(null);

  // Mobile drawer: Escape closes it, tapping the backdrop closes it, and focus moves to the
  // close control when it opens so keyboard users land inside the drawer instead of staying
  // behind it.
  useEffect(() => {
    if (!mobileOpen) return undefined;
    drawerCloseRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === "Escape") setMobileOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  return (
    <div data-workspace-shell className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-950 lg:flex">
      <aside
        data-workspace-app-switcher
        data-expanded={expanded ? "true" : "false"}
        className={[
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-800 bg-slate-950 p-3 text-white shadow-xl transition-[width] duration-200 lg:flex",
          expanded ? "w-60" : "w-20",
        ].join(" ")}
      >
        <div className={["mb-3 flex items-center", expanded ? "justify-between gap-3" : "justify-center"].join(" ")}>
          {expanded && (
            <div className="min-w-0 text-lg font-black tracking-[0.18em]">409 MARKETPLACE</div>
          )}
          <button
            type="button"
            aria-label={expanded ? "Collapse workspace navigation" : "Expand workspace navigation"}
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-lg font-black hover:bg-white/10"
          >
            {expanded ? "‹" : "M"}
          </button>
        </div>

        <Link
          href="/?chooseWorkspace=1"
          title={expanded ? undefined : "All apps"}
          aria-label={expanded ? undefined : "All apps"}
          className={[
            "group relative mb-5 flex min-h-12 items-center rounded-xl border border-white/10 bg-white/5 text-sm font-black text-slate-300 transition hover:bg-white/10 hover:text-white",
            expanded ? "gap-3 px-3" : "justify-center px-2",
          ].join(" ")}
        >
          <LayoutGrid aria-hidden="true" className="h-5 w-5 shrink-0" />
          {expanded && <span>All apps</span>}
          {!expanded && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white opacity-0 shadow-xl transition group-hover:opacity-100 group-focus-visible:opacity-100"
            >
              All apps
            </span>
          )}
        </Link>

        <WorkspaceLinks pathname={pathname} expanded={expanded} />
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur lg:hidden">
          <Link href="/" className="font-black tracking-[0.16em] text-slate-950">
            409 MARKETPLACE
          </Link>
          <div className="flex items-center gap-2">
            {/* Phone users previously had no way to reach the account menu at all on
               workspace pages (Rental, Charts, Designer, Scheduling, Dev, …) — sign-out
               required desktop width. The same shared account menu the desktop right
               rail uses, now in the mobile header — mirroring ForgeApplicationRail. */}
            <AccountMenu tone="light" />

            <ThemeToggle
              compact
              menuAlign="bottom-right"
              variant="onLight"
            />

            {/* Touch/mouse path to the FORGE command palette -- phone users
               have no keyboard for Cmd/Ctrl+K. */}
            {forgeCommandPalette ? <CommandPaletteTrigger tone="light" /> : null}
            <button
              type="button"
              aria-label="Open workspace navigation"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((current) => !current)}
              className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-black"
            >
              <Menu aria-hidden="true" className="h-4 w-4" />
              Apps
            </button>
          </div>
        </header>

        {mobileOpen && (
          <div className="fixed inset-0 z-50 bg-slate-950/50 p-4 lg:hidden" onClick={() => setMobileOpen(false)}>
            <aside
              role="dialog"
              aria-modal="true"
              aria-label="Workspace navigation"
              onClick={(event) => event.stopPropagation()}
              className="ml-auto flex h-full w-full max-w-xs flex-col rounded-2xl bg-slate-950 p-4 text-white shadow-2xl"
            >
              <div className="mb-5 flex items-center justify-between">
                <div className="text-lg font-black tracking-[0.18em]">409 MARKETPLACE</div>
                <button
                  ref={drawerCloseRef}
                  type="button"
                  aria-label="Close workspace navigation"
                  onClick={() => setMobileOpen(false)}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/5"
                >
                  <X aria-hidden="true" className="h-5 w-5" />
                </button>
              </div>

              <Link
                href="/?chooseWorkspace=1"
                onClick={() => setMobileOpen(false)}
                className="mb-5 flex min-h-12 items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-black text-slate-300"
              >
                <LayoutGrid aria-hidden="true" className="h-5 w-5" />
                All apps
              </Link>

              <div
                data-testid="mobile-nav-scroll"
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
              >
                <WorkspaceLinks pathname={pathname} expanded onNavigate={() => setMobileOpen(false)} />
              </div>
            </aside>
          </div>
        )}

        <div data-workspace-content className="min-w-0">
          {children}
        </div>
      </div>

      {/* FORGE command palette host. Mounted once at the workspace-shell level
         (opt-in per layout) so Cmd/Ctrl+K works across every promoted Forge
         subtree -- rental, scheduling, designer, developer, private-financing,
         reservations, charts. Forge's own ForgeApplicationRail mounts its own
         host for the remaining /forge/* modules, so the two never overlap. */}
      {forgeCommandPalette ? <CommandPaletteHost /> : null}

      <WorkspaceRightRail showCommandPalette={forgeCommandPalette} />
    </div>
  );
}
