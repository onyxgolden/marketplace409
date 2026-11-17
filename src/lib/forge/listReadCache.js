// FORGE load-times Slice 2 (S2A): hot-read server data cache for exactly
// two authenticated project-list DTOs — Scheduling and Designer.
//
// Safety invariants (scope: results/chatgpt/forge-load-times-slice2-scope-2026-11-16.md):
// - The route authenticates and authorizes EVERY request BEFORE any cache
//   lookup, including hits. Nothing here bypasses getUser, app
//   entitlement, membership, or effective-owner resolution.
// - Cache keys are explicit and stable: app namespace, DTO version,
//   canonical effective owner, actor id, plus the list generation (below).
//   Cached values hold the minimum serializable list DTO only — never
//   cookies, tokens, an auth client, or a service-role credential, in key
//   or value.
// - Errors are never cached: a failed probe or a failed query throws, so
//   the next request retries instead of serving a persisted failure (same
//   rule as src/app/market/_data.js).
// - HTTP responses stay private/non-cacheable (the routes set
//   Cache-Control: private, no-store). The cache is the server data layer
//   only, never a shared HTTP response.
// - TTL is 15s defense-in-depth ONLY. Freshness after a write comes from
//   the generation key (below), never from the TTL.
// - The shared/public portion of the Scheduling list is NEVER cached: the
//   public example rows are fetched fresh on every GET and merged with the
//   cached owner-scoped rows, so a public row can never linger stale in
//   another actor's cache entry. Designer has no public rows (strictly
//   owner-filtered), so its whole DTO is cached.
//
// Post-write freshness — generation-keyed cache (fix round 1 for PR #822,
// ChatGPT NEEDS CHANGES P1-1/P1-2/P1-3):
// - The previous design invalidated with revalidateTag(tag, "max") after a
//   write. That is stale-while-revalidate, NOT an immediate miss: the next
//   request can receive the pre-write entry while the fresh one is rebuilt
//   in the background (proven by the control in listReadCache.test.js,
//   which runs the old design through the real Next 16.4.1 cache and
//   observes the stale serve). There is no supported immediate
//   invalidation path for Route Handlers — updateTag() throws outside
//   Server Actions — so this module no longer invalidates at all.
// - Instead, every GET first runs one cheap generation probe over exactly
//   the RLS-visible set the list query reads: the row count plus the newest
//   updated_at, in a single round trip (one row). The probe result is part
//   of the unstable_cache key, so any insert, update, or delete that
//   changes the visible set changes the key and the next GET cannot serve
//   the pre-write entry — the first GET after a write is a guaranteed
//   miss and reads fresh rows. Mutations perform NO cache operation, so a
//   committed write can never be reported as fresh-when-it-isn't, and
//   there is no invalidation step that can fail silently (P1-2, closed by
//   removal): if the probe or the list read fails, the GET fails visibly
//   with a 500 and the error is never cached, so the next read retries.
// - P1-3 is closed by the probe itself. The Scheduling private probe is
//   computed over the whole RLS-visible set (is_public = false, no owner
//   predicate — the same visibility the list query reads), so a co-owner's
//   write to a B-owned row changes the generation for every actor who can
//   see B, regardless of which owner key the entry was filed under. No
//   visibility is narrowed: the private list still returns every row RLS
//   shows the actor, exactly as before.
// - Residual weakness, disclosed honestly: {count, max(updated_at)} is a
//   weak generation. A delete immediately followed by a create in the same
//   millisecond — same count, same newest timestamp — could alias, and the
//   pre-write entry would then serve until the 15s TTL expires. A strong
//   digest would need to read every row or add schema, both out of scope
//   for S2A. Every writer in the app bumps updated_at to now on update and
//   changes the count on insert/delete (verified against the migrations
//   and the four route files), so aliasing needs two writes landing in the
//   same millisecond with cancelling effects.
//
// Why the cached callback closes over the request's Supabase client
// (mechanism proof, Next.js 16.4.1 — the deployed runtime):
// - `unstable_cache` builds its key as `cb.toString() + keyParts +
//   JSON.stringify(args)`, so a client cannot be passed as an argument
//   (it is not JSON-serializable) and must not appear in the key.
// - `cookies()` THROWS inside an unstable_cache callback
//   (next/dist/server/request/cookies.js: `case 'unstable-cache': throw
//   createCookiesInUnstableCacheError(...)`), so the callback cannot build
//   its own request-scoped client from cookies — and an anon-key client
//   would return only public rows (RLS), i.e. the wrong DTO.
// - A service-role client (RLS bypass) and a global in-process map are both
//   explicitly forbidden by the scope as fallbacks.
// - So the only compliant shape is the one used here: the wrapper is built
//   per request, closing over THAT request's already-authenticated client,
//   and the cache key pins the entry to the exact principal (app + DTO
//   version + effective owner + actor id + generation). The captured client
//   is used ONLY on a cache miss, ONLY for the principal named in the key,
//   and NEVER reused under another principal — a hit never invokes the
//   callback at all. Auth runs before lookup on every request, so a revoked
//   actor never reaches a cached entry.

import { unstable_cache } from "next/cache";

// Bump when either list DTO changes shape, so old entries can never be
// served as the new shape.
export const FORGE_LIST_CACHE_VERSION = "v1";

// Short defense-in-depth TTL (scope suggests 10-15s). Post-write
// freshness comes from the generation key, never from the TTL.
export const FORGE_LIST_CACHE_TTL_SECONDS = 15;

const SCHEDULING_LIST_COLUMNS =
  "id,owner_id,project_name,start_date,end_date,is_public,created_at,updated_at";
const DESIGNER_LIST_COLUMNS =
  "id,owner_id,project_name,created_at,updated_at";

function toSchedulingProjectDto(row, effectiveOwnerId) {
  return {
    id: row.id,
    name: row.project_name,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isOwner: row.owner_id === effectiveOwnerId,
    isPublic: row.is_public,
  };
}

function toDesignerProjectDto(row) {
  return {
    id: row.id,
    name: row.project_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertNoQueryError(error) {
  if (error) throw error;
}

// One cheap round trip over exactly the RLS-visible set the list query
// reads: the exact row count plus the newest updated_at (a single row,
// newest-first with limit 1). `filters` are the same equality filters the
// list query applies (is_public=false for the Scheduling private set,
// owner_id for Designer) — the probe and the list read the same set, so a
// write visible to the list always moves the generation. The probe is NOT
// cached: it runs on every GET, and a probe failure throws, so the GET
// fails visibly instead of serving a possibly-stale entry.
async function probeListGeneration({ supabaseClient, table, filters }) {
  let query = supabaseClient
    .from(table)
    .select("updated_at", { count: "exact" });
  for (const [column, value] of filters) {
    query = query.eq(column, value);
  }
  const { data, error, count } = await query
    .order("updated_at", { ascending: false })
    .limit(1);
  assertNoQueryError(error);
  const maxUpdatedAt =
    Array.isArray(data) && data.length > 0
      ? (data[0]?.updated_at ?? null)
      : null;
  return {
    count: typeof count === "number" ? count : null,
    maxUpdatedAt,
  };
}

function generationKeyPart({ count, maxUpdatedAt }) {
  return `${count ?? "?"}:${maxUpdatedAt ?? "?"}`;
}

// Scheduling, owner-scoped portion only (is_public = false). The query is
// byte-identical to the route's pre-S2A list query apart from the added
// is_public filter; RLS still restricts it to rows the actor has workspace
// access to, exactly as before. Public rows are NOT in here — see
// fetchFreshPublicSchedulingProjects.
export async function getCachedSchedulingPrivateProjects({
  supabaseClient,
  effectiveOwnerId,
  actorId,
}) {
  const ownerIdentity = effectiveOwnerId || actorId;
  const generation = await probeListGeneration({
    supabaseClient,
    table: "forge_scheduling_projects",
    filters: [["is_public", false]],
  });
  const cachedFetch = unstable_cache(
    async () => {
      const { data, error } = await supabaseClient
        .from("forge_scheduling_projects")
        .select(SCHEDULING_LIST_COLUMNS)
        .eq("is_public", false)
        .order("updated_at", { ascending: false });
      assertNoQueryError(error);
      return (data || []).map((row) =>
        toSchedulingProjectDto(row, effectiveOwnerId),
      );
    },
    [
      "forge-list",
      "scheduling",
      FORGE_LIST_CACHE_VERSION,
      ownerIdentity,
      actorId,
      generationKeyPart(generation),
    ],
    {
      revalidate: FORGE_LIST_CACHE_TTL_SECONDS,
    },
  );
  return cachedFetch();
}

// Scheduling, shared/public portion — ALWAYS fresh, never cached (see the
// header). The public set is tiny (the seeded example project); one small
// select per GET is the price of never serving another actor a stale
// public row.
export async function fetchFreshPublicSchedulingProjects({
  supabaseClient,
  effectiveOwnerId,
}) {
  const { data, error } = await supabaseClient
    .from("forge_scheduling_projects")
    .select(SCHEDULING_LIST_COLUMNS)
    .eq("is_public", true)
    .order("updated_at", { ascending: false });
  assertNoQueryError(error);
  return (data || []).map((row) =>
    toSchedulingProjectDto(row, effectiveOwnerId),
  );
}

// Merge the cached private rows with the fresh public rows into the DTO
// the pre-S2A single query returned: one list, updated_at desc. Equal
// timestamps keep insertion order (private before public) via the stable
// sort — deterministic, but NOT claimed byte-identical to the pre-S2A
// single query for arbitrary equal-timestamp lists: that query had no
// secondary sort either, so Postgres left tie order unspecified. The merge
// makes ties private-first instead of leaving them to the planner.
export function mergeSchedulingProjectLists(privateProjects, publicProjects) {
  return [...(privateProjects || []), ...(publicProjects || [])].sort(
    (a, b) => {
      if (a.updatedAt === b.updatedAt) return 0;
      return a.updatedAt < b.updatedAt ? 1 : -1;
    },
  );
}

// Designer: the whole list DTO, strictly owner-filtered (no public rows),
// so the whole DTO is cached per (app, version, owner, actor, generation).
export async function getCachedDesignerProjects({
  supabaseClient,
  ownerId,
  actorId,
}) {
  const ownerIdentity = ownerId || actorId;
  const generation = await probeListGeneration({
    supabaseClient,
    table: "designer_projects",
    filters: [["owner_id", ownerIdentity]],
  });
  const cachedFetch = unstable_cache(
    async () => {
      const { data, error } = await supabaseClient
        .from("designer_projects")
        .select(DESIGNER_LIST_COLUMNS)
        .eq("owner_id", ownerIdentity)
        .order("updated_at", { ascending: false });
      assertNoQueryError(error);
      return (data || []).map(toDesignerProjectDto);
    },
    [
      "forge-list",
      "designer",
      FORGE_LIST_CACHE_VERSION,
      ownerIdentity,
      actorId,
      generationKeyPart(generation),
    ],
    {
      revalidate: FORGE_LIST_CACHE_TTL_SECONDS,
    },
  );
  return cachedFetch();
}
