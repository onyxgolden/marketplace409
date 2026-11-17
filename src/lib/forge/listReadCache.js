// FORGE load-times Slice 2 (S2A): hot-read server data cache for exactly
// two authenticated project-list DTOs — Scheduling and Designer.
//
// Safety invariants (scope: results/chatgpt/forge-load-times-slice2-scope-2026-11-16.md):
// - The route authenticates and authorizes EVERY request BEFORE any cache
//   lookup, including hits. Nothing here bypasses getUser, app
//   entitlement, membership, or effective-owner resolution.
// - Cache keys are explicit and stable: app namespace, DTO version,
//   canonical effective owner, actor id. Cached values hold the minimum
//   serializable list DTO only — never cookies, tokens, an auth client, or
//   a service-role credential, in key or value.
// - Errors are never cached: a failed query throws, so the next request
//   retries instead of serving a persisted failure (same rule as
//   src/app/market/_data.js).
// - HTTP responses stay private/non-cacheable (the routes set
//   Cache-Control: private, no-store). The cache is the server data layer
//   only, never a shared HTTP response.
// - TTL is 15s defense-in-depth ONLY. Freshness after a write comes from
//   explicit invalidation (invalidateForgeProjectList), never from the TTL.
// - The shared/public portion of the Scheduling list is NEVER cached: the
//   public example rows are fetched fresh on every GET and merged with the
//   cached owner-scoped rows, so a public row can never linger stale in
//   another actor's cache entry. Designer has no public rows (strictly
//   owner-filtered), so its whole DTO is cached.
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
//   version + effective owner + actor id). The captured client is used ONLY
//   on a cache miss, ONLY for the principal named in the key, and NEVER
//   reused under another principal — a hit never invokes the callback at
//   all. Auth runs before lookup on every request, so a revoked actor never
//   reaches a cached entry.
// - Invalidation: revalidateTag forces an immediate fresh read. Proven from
//   the same runtime: FileSystemCache.get returns null (a miss, NOT stale
//   data) for FETCH entries whose tags were revalidated
//   (node_modules/next/dist/server/lib/incremental-cache/file-system-cache.js:
//   "When revalidate tag is called we don't return stale data so it's
//   updated right away"). Tag revalidation therefore needs no versioned-key
//   bypass in this Next version; time-based staleness (the 15s TTL) is
//   stale-while-revalidate by design and is only the backstop, never the
//   post-write freshness mechanism.

import { revalidateTag, unstable_cache } from "next/cache";

// Bump when either list DTO changes shape, so old entries can never be
// served as the new shape.
export const FORGE_LIST_CACHE_VERSION = "v1";

// Short defense-in-depth TTL (scope suggests 10-15s). Explicit
// invalidation on every write is what keeps post-save reads fresh.
export const FORGE_LIST_CACHE_TTL_SECONDS = 15;

const SCHEDULING_LIST_COLUMNS =
  "id,owner_id,project_name,start_date,end_date,is_public,created_at,updated_at";
const DESIGNER_LIST_COLUMNS =
  "id,owner_id,project_name,created_at,updated_at";

// Tags are owner-scoped AND app-scoped (never actor-scoped, never global):
// invalidating one workspace's tag drops every actor's entry for that
// workspace, so a co-owner's save is visible to the owner immediately too.
export function forgeListCacheTag(app, ownerId) {
  return `forge-list:${app}:owner:${ownerId}`;
}

export function forgeListCacheKeyParts(app, ownerId, actorId) {
  return ["forge-list", app, FORGE_LIST_CACHE_VERSION, ownerId, actorId];
}

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
    forgeListCacheKeyParts("scheduling", ownerIdentity, actorId),
    {
      revalidate: FORGE_LIST_CACHE_TTL_SECONDS,
      tags: [forgeListCacheTag("scheduling", ownerIdentity)],
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

// Merge the cached private rows with the fresh public rows into exactly
// the DTO the pre-S2A single query returned: one list, updated_at desc.
// Private rows come first only as the stable-sort input order; the sort
// itself decides. Equal timestamps keep insertion order (private before
// public), matching the previous single-query result for the seeded data.
export function mergeSchedulingProjectLists(privateProjects, publicProjects) {
  return [...(privateProjects || []), ...(publicProjects || [])].sort(
    (a, b) => {
      if (a.updatedAt === b.updatedAt) return 0;
      return a.updatedAt < b.updatedAt ? 1 : -1;
    },
  );
}

// Designer: the whole list DTO, strictly owner-filtered (no public rows),
// so the whole DTO is cached per (app, version, owner, actor).
export async function getCachedDesignerProjects({
  supabaseClient,
  ownerId,
  actorId,
}) {
  const ownerIdentity = ownerId || actorId;
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
    forgeListCacheKeyParts("designer", ownerIdentity, actorId),
    {
      revalidate: FORGE_LIST_CACHE_TTL_SECONDS,
      tags: [forgeListCacheTag("designer", ownerIdentity)],
    },
  );
  return cachedFetch();
}

// Invalidate one workspace's list entries for one app, after a durable DB
// write succeeds and before the mutation reports success. Callers must
// NOT call this on failed/rejected writes. If the invalidation itself
// throws (a local cache failure, not a DB failure), the write already
// succeeded — report the error visibly in logs and let the 15s TTL bound
// the staleness, rather than failing a mutation that already landed.
export function invalidateForgeProjectList(app, ownerId) {
  try {
    revalidateTag(forgeListCacheTag(app, ownerId), "max");
  } catch (error) {
    console.error(
      `Forge list cache invalidation failed for ${app}/${ownerId}; TTL bounds staleness to ${FORGE_LIST_CACHE_TTL_SECONDS}s`,
      error,
    );
  }
}
