import { redirect } from "next/navigation";

import { supabase } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import { loadProgrammerAuthorization } from "@/lib/supabase/loadProgrammerAuthorization";
import WorkspaceHubGrid from "@/components/WorkspaceHubGrid";
import WorkspaceAccountPanel from "@/components/WorkspaceAccountPanel";
import { WORKSPACES } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

async function loadWorkspaceHub() {
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

  if (!user) return { user: null, stats, isDeveloperAuthorized: false, favoriteWorkspaceId: null };

  const [{ count: leaseCount }, { count: accountCount }, preference, programmerAuthorization] = await Promise.all([
    supabaseServer
      .from("rental_leases")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", user.id),
    supabaseServer
      .from("financial_accounts")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", user.id),
    supabaseServer
      .from("user_workspace_preferences")
      .select("favorite_workspace_id")
      .eq("user_id", user.id)
      .maybeSingle(),
    // Same authorization check /forge/developer itself enforces (loadProgrammerAuthorization ->
    // notFound() there) -- reused here only to decide whether the Dev tile is worth showing at all.
    // That page-level check (and every API route under /api/forge/developer/) is the real
    // enforcement; hiding the tile from an unauthorized visitor is a UX courtesy on top of it, never
    // a substitute for it.
    loadProgrammerAuthorization(),
  ]);

  stats.rentals = `${leaseCount ?? 0} lease${leaseCount === 1 ? "" : "s"}`;
  stats.forge = `${accountCount ?? 0} linked account${accountCount === 1 ? "" : "s"}`;

  return {
    user,
    stats,
    isDeveloperAuthorized: Boolean(programmerAuthorization.ok && programmerAuthorization.authorized),
    favoriteWorkspaceId: preference.data?.favorite_workspace_id ?? null,
  };
}

export default async function HubPage({ searchParams } = {}) {
  const { user, stats, isDeveloperAuthorized, favoriteWorkspaceId } = await loadWorkspaceHub();

  // Dev is filtered out of the array itself (not just skipped when rendering) so both the tile grid
  // AND the favorite-redirect lookup below see the same, authorization-correct set -- a stale
  // favorite of "dev" saved while someone was authorized must not blindly redirect them (or, worse,
  // someone else signed into the same saved preference) straight into /forge/developer once they no
  // longer are.
  const visibleWorkspaces = isDeveloperAuthorized
    ? WORKSPACES
    : WORKSPACES.filter((workspace) => workspace.id !== "dev");

  // A favorite sends a fresh visit here straight to it, instead of the picker -- every app's "All
  // apps" sidebar link is how someone gets back to this page on purpose, so it passes chooseWorkspace
  // to explicitly opt out of that redirect (previously it linked to plain "/", which just re-triggered
  // the same redirect it was meant to escape -- a favorited workspace could never be left via that
  // link, only by clearing the favorite from outside this page, which itself lives only on this page).
  const params = await searchParams;
  const wantsPicker = params?.chooseWorkspace === "1";
  if (favoriteWorkspaceId && !wantsPicker) {
    const favorite = visibleWorkspaces.find((workspace) => workspace.id === favoriteWorkspaceId);
    if (favorite) redirect(favorite.href);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-100 px-6 py-16 text-slate-950 dark:bg-slate-950">
      <div className="mb-12 text-center">
        <div className="text-sm font-black uppercase tracking-[0.3em] text-amber-500">
          409 Marketplace
        </div>
        <h1 className="mt-2 text-4xl font-black tracking-tight dark:text-white">
          Choose a workspace
        </h1>
        <p className="mt-3 text-slate-600 dark:text-slate-300">
          Pick where you want to work, or star one as your favorite to open it automatically next time.
        </p>
      </div>

      <WorkspaceAccountPanel initialUser={user} />

      <WorkspaceHubGrid
        workspaces={visibleWorkspaces}
        stats={stats}
        initialFavoriteWorkspaceId={favoriteWorkspaceId}
      />
    </main>
  );
}
