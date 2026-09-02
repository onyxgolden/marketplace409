import Link from "next/link";
import { ArrowRight, Building2, Code2, GanttChart, Hammer, HeartPulse, Store } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import { isOwnerOrActiveCoOwner } from "@/lib/supabase/isOwnerOrActiveCoOwner";
import { WORKSPACES } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

const ICONS = { Store, Building2, Hammer, GanttChart, Code2 };

// Deliberately not a WORKSPACES entry: that array also drives WorkspaceLinks, the cross-app
// sidebar shown everywhere (including inside Forge) with no auth context of its own. Keeping this
// tile local to this one server-rendered page is what lets it carry a real visibility check
// (isOwnerOrCoOwner) without threading owner/co-owner state through every place WORKSPACES is
// read. Health itself still lives inside Forge (/forge/health) -- this is a private shortcut to
// it, not a promotion to a sibling top-level workspace.
const HEALTH_SHORTCUT = Object.freeze({
  id: "health",
  name: "Health",
  href: "/forge/health",
  description: "Shared household health records. Visible only to you and your co-owner.",
});

async function loadWorkspaceStats() {
  const supabaseServer = await createClient();
  const {
    data: { user },
  } = await supabaseServer.auth.getUser();

  const { count: listingsCount } = await supabase
    .from("listings")
    .select("*", { count: "exact", head: true });

  const stats = {
    marketplace:
      listingsCount != null
        ? `${listingsCount.toLocaleString()} active listing${listingsCount === 1 ? "" : "s"}`
        : "Browse local listings",
    rentals: "Sign in to view your portfolio",
    forge: "Sign in to view your workspace",
    scheduling: "Gantt chart wall-boards",
    dev: "Programmer tools",
  };

  if (!user) return { stats, isOwnerOrCoOwner: false };

  const [{ count: leaseCount }, { count: accountCount }, isOwnerOrCoOwner] = await Promise.all([
    supabaseServer
      .from("rental_leases")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", user.id),
    supabaseServer
      .from("financial_accounts")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", user.id),
    isOwnerOrActiveCoOwner({ supabaseClient: supabaseServer, actorUserId: user.id }),
  ]);

  stats.rentals = `${leaseCount ?? 0} lease${leaseCount === 1 ? "" : "s"}`;
  stats.forge = `${accountCount ?? 0} linked account${accountCount === 1 ? "" : "s"}`;

  return { stats, isOwnerOrCoOwner };
}

export default async function HubPage() {
  const { stats, isOwnerOrCoOwner } = await loadWorkspaceStats();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-100 px-6 py-16 text-slate-950 dark:bg-slate-950">
      <div className="mb-12 text-center">
        <div className="text-sm font-black uppercase tracking-[0.3em] text-amber-500">
          409 Marketplace
        </div>
        <h1 className="mt-2 text-4xl font-black tracking-tight dark:text-white">
          Choose a workspace
        </h1>
        <p className="mt-3 text-slate-600 dark:text-slate-300">Pick where you want to work.</p>
      </div>

      <div className="grid w-full max-w-4xl gap-5 sm:grid-cols-2">
        {WORKSPACES.map((workspace) => {
          const Icon = ICONS[workspace.iconName];
          return (
            <Link
              key={workspace.id}
              href={workspace.href}
              className="group flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-lg"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-950 dark:bg-amber-400 text-white dark:text-slate-950">
                <Icon aria-hidden="true" className="h-6 w-6" />
              </div>
              <div className="text-xl font-black dark:text-white">{workspace.name}</div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{workspace.description}</p>
              <div className="mt-4 flex items-center justify-between text-sm font-bold text-slate-500 dark:text-slate-400">
                <span>{stats[workspace.id]}</span>
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4 text-slate-400 transition group-hover:translate-x-1 group-hover:text-amber-500"
                />
              </div>
            </Link>
          );
        })}

        {isOwnerOrCoOwner && (
          <Link
            key={HEALTH_SHORTCUT.id}
            href={HEALTH_SHORTCUT.href}
            className="group flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-lg"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-950 dark:bg-amber-400 text-white dark:text-slate-950">
              <HeartPulse aria-hidden="true" className="h-6 w-6" />
            </div>
            <div className="text-xl font-black dark:text-white">{HEALTH_SHORTCUT.name}</div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{HEALTH_SHORTCUT.description}</p>
            <div className="mt-4 flex items-center justify-between text-sm font-bold text-slate-500 dark:text-slate-400">
              <span>Private</span>
              <ArrowRight
                aria-hidden="true"
                className="h-4 w-4 text-slate-400 transition group-hover:translate-x-1 group-hover:text-amber-500"
              />
            </div>
          </Link>
        )}
      </div>
    </main>
  );
}
