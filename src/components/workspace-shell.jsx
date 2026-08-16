"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell,
  Building2,
  Code2,
  Hammer,
  LayoutGrid,
  Menu,
  Settings,
  Store,
  UserRound,
  X,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { WORKSPACES, isWorkspaceActive } from "@/lib/workspaces";

const WORKSPACE_ICONS = { Store, Building2, Hammer, Code2 };

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
            onClick={onNavigate}
            className={[
              "flex min-h-12 items-center rounded-xl border text-sm font-black transition",
              expanded ? "gap-3 px-3" : "justify-center px-2",
              active
                ? "border-amber-400 bg-amber-400 text-slate-950 shadow"
                : "border-white/10 bg-white/5 text-slate-200 hover:border-white/25 hover:bg-white/10 hover:text-white",
            ].join(" ")}
          >
            <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
            {expanded && <span className="truncate">{workspace.name}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

// Icon-only account/notifications/settings rail. Exported standalone so
// Forge's own ForgeApplicationRail can render the identical rail alongside
// its existing sidebar instead of duplicating this markup.
export function WorkspaceRightRail() {
  const [user, setUser] = useState(null);

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
    await createClient().auth.signOut();
    window.location.href = "/";
  }

  return (
    <aside
      data-workspace-right-rail
      className="sticky top-0 hidden h-screen w-16 shrink-0 flex-col items-center gap-2 border-l border-slate-800 bg-slate-950 py-4 text-white lg:flex"
    >
      <div className="group relative">
        <button
          type="button"
          aria-label={user ? `Signed in as ${user.email}` : "Account"}
          onClick={user ? handleSignOut : () => (window.location.href = "/auth")}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 hover:border-white/25 hover:bg-white/10"
        >
          <UserRound aria-hidden="true" className="h-5 w-5" />
        </button>
        <div className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white opacity-0 shadow-xl transition group-hover:opacity-100">
          {user ? `${user.email} · Sign out` : "Sign in"}
        </div>
      </div>

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
    </aside>
  );
}

export default function WorkspaceShell({ children }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div data-workspace-shell className="min-h-screen bg-slate-950 text-slate-950 lg:flex">
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
          href="/"
          title={expanded ? undefined : "All apps"}
          className={[
            "mb-5 flex min-h-12 items-center rounded-xl border border-white/10 bg-white/5 text-sm font-black text-slate-300 transition hover:bg-white/10 hover:text-white",
            expanded ? "gap-3 px-3" : "justify-center px-2",
          ].join(" ")}
        >
          <LayoutGrid aria-hidden="true" className="h-5 w-5 shrink-0" />
          {expanded && <span>All apps</span>}
        </Link>

        <WorkspaceLinks pathname={pathname} expanded={expanded} />
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur lg:hidden">
          <Link href="/" className="font-black tracking-[0.16em] text-slate-950">
            409 MARKETPLACE
          </Link>
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
        </header>

        {mobileOpen && (
          <div className="fixed inset-0 z-50 bg-slate-950/50 p-4 lg:hidden">
            <aside className="ml-auto flex h-full w-full max-w-xs flex-col rounded-2xl bg-slate-950 p-4 text-white shadow-2xl">
              <div className="mb-5 flex items-center justify-between">
                <div className="text-lg font-black tracking-[0.18em]">409 MARKETPLACE</div>
                <button
                  type="button"
                  aria-label="Close workspace navigation"
                  onClick={() => setMobileOpen(false)}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/5"
                >
                  <X aria-hidden="true" className="h-5 w-5" />
                </button>
              </div>

              <Link
                href="/"
                onClick={() => setMobileOpen(false)}
                className="mb-5 flex min-h-12 items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-black text-slate-300"
              >
                <LayoutGrid aria-hidden="true" className="h-5 w-5" />
                All apps
              </Link>

              <WorkspaceLinks pathname={pathname} expanded onNavigate={() => setMobileOpen(false)} />
            </aside>
          </div>
        )}

        <div data-workspace-content className="min-w-0">
          {children}
        </div>
      </div>

      <WorkspaceRightRail />
    </div>
  );
}
