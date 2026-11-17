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
// Post-write freshness — full-row digest generation (fix round 2 for
// PR #822, ChatGPT NEEDS CHANGES P1: {count, max(updated_at)} is not a
// generation):
// - Fix round 1 keyed the cache on {count, max(updated_at)}. That misses
//   the ordinary edit the round-2 verdict names: rename an older row to a
//   timestamp still earlier than the newest row's, and neither the count
//   nor the maximum moves — the next GET serves the pre-write entry. A
//   one-row probe cannot establish freshness; only a generation that
//   changes on EVERY visible-list mutation can.
// - The generation is now a SHA-256 digest of EVERY DTO-determining field
//   of every RLS-visible row (see SCHEDULING/DESIGNER_DIGEST_COLUMNS):
//   id, owner_id, project_name, start/end dates, created_at, updated_at
//   (Scheduling) and id, project_name, created_at, updated_at (Designer).
//   Rows are JSON-encoded per row and sorted by id, so the digest is a
//   deterministic function of exactly the state the DTO is built from:
//   any insert, delete, rename, date change, or updated_at bump changes
//   the digest, and a delete+create preserving count and max still
//   changes it (the id set changes). A timestamp-preserving update is
//   caught too, because project_name / dates are digest fields — the
//   digest does not lean on updated_at alone. is_public flips change set
//   membership (the row leaves/enters the private probe set) and the
//   public rows are fetched fresh anyway. board/design JSONB columns are
//   NOT digest fields — they are not in the DTO, so a change to them alone
//   correctly leaves the list generation alone (in practice their saves
//   bump updated_at anyway: the Scheduling RPC and the Designer PUT both
//   set updated_at = now()).
// - The only remaining alias is a SHA-256 collision (negligible) — there
//   is no writer invariant left to lean on and no timestamp window left
//   to alias through. Mutations still perform NO cache operation, so a
//   committed write can never be reported as fresh-when-it-isn't, and
//   there is no invalidation step that can fail silently (P1-2, closed by
//   removal in fix round 1): if the probe or the list read fails, the GET
//   fails visibly with a 500 and the error is never cached, so the next
//   read retries.
// - P1-3 is closed by the probe itself, as before. The Scheduling private
//   probe is computed over the whole RLS-visible set (is_public = false,
//   no owner predicate — the same visibility the list query reads), so a
//   co-owner's write to a B-owned row changes the digest for every actor
//   who can see B, regardless of which owner key the entry was filed
//   under. No visibility is narrowed: the private list still returns
//   every row RLS shows the actor, exactly as before.
//
// Why NOT revalidateTag again (rejected alternatives, verified against
// the installed Next.js 16.4.1 source — the deployed runtime):
// - Plain revalidateTag(tag) with no profile DOES expire immediately
//   (revalidation-utils.js: no durations → immediate expiration in the
//   cache handler), but it is DEPRECATED in 16.4.1
//   (server/web/spec-extension/revalidate.js warns: add "max" or use
//   updateTag). Building the freshness contract on deprecated behavior
//   is not a supported path.
// - revalidateTag(tag, {expire: 0}) would be an undocumented evasion of
//   the documented Server-Actions-only updateTag restriction, and it
//   reopens P1-2: in production, end-of-request revalidation runs via
//   pendingWaitUntil (route-modules/app-route/module.js
//   resolvePendingRevalidations assigns executeRevalidates to
//   pendingWaitUntil — it is NOT awaited before the response is sent),
//   so a failed revalidation is silent BY FRAMEWORK DESIGN and the
//   mutation would report success over a stale cache, with no safe
//   fresh-read path behind it. The generation-keyed design has no such
//   step to fail.
// - A durable owner/visibility-scoped revision counter changed atomically
//   with every writer would also be correct, but it needs schema —
//   separately scoped approval the verdict explicitly withholds.
//
// Honest performance trade-off (read this before claiming a win):
// - Correctness now requires the probe to read every visible row on
//   every GET — the same row set as the list query, fewer columns, no
//   ORDER BY. The cache saves the wide-column fetch + ORDER BY + DTO
//   mapping/sort/merge, NOT a round trip: a repeat GET still costs one
//   PostgREST round trip (the probe) plus, for Scheduling, the always-
//   fresh public fetch. The net latency gain is therefore expected to be
//   SMALL, and a cache miss now costs probe + list (one round trip MORE
//   than the uncached baseline). The live before/after timing receipt
//   (post-deploy, per the scope) is the judge: if it shows no
//   improvement, record NO IMPROVEMENT and take slice #8
//   (server-prefetch) next — do not claim improvement from hit counters,
//   which count list selects, not round trips.
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

import { createHash } from "node:crypto";
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

// Digest columns: EVERY field the list DTO is built from, per app.
// is_public is deliberately absent from the Scheduling digest — the probe
// filters is_public = false, so a flip moves the row between the private
// probe set and the always-fresh public fetch and the digest changes via
// set membership. owner_id is present for Scheduling because the private
// set spans workspaces (RLS-visible, no owner predicate) and isOwner in
// the DTO is derived from it; for Designer the probe already filters
// owner_id, so it is constant across the probed rows. created_at is
// present even though no app writer changes it post-insert — the digest
// then covers the DTO with no writer invariant at all.
export const SCHEDULING_DIGEST_COLUMNS = [
  "id",
  "owner_id",
  "project_name",
  "start_date",
  "end_date",
  "created_at",
  "updated_at",
];
export const DESIGNER_DIGEST_COLUMNS = [
  "id",
  "project_name",
  "created_at",
  "updated_at",
];

// Deterministic digest of the visible rows: each row JSON-encoded (so no
// separator can ever make two different field tuples collide) and sorted
// by id, then SHA-256. A different visible state hashes differently, up
// to hash collision; an identical visible state hashes identically, so a
// cache hit under this generation is a correct hit by construction.
export function digestListRows(rows, fields) {
  const lines = (rows || [])
    .map((row) => JSON.stringify(fields.map((field) => row[field] ?? null)))
    .sort();
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

// One round trip over exactly the RLS-visible set the list query reads,
// returning the digest of that set (not a summary of it): every row's
// digest columns, no ORDER BY, no LIMIT. `filters` are the same equality
// filters the list query applies (is_public=false for the Scheduling
// private set, owner_id for Designer) — the probe and the list read the
// same set, so a write visible to the list always moves the digest. The
// probe is NOT cached: it runs on every GET, and a probe failure throws,
// so the GET fails visibly instead of serving a possibly-stale entry.
async function probeListDigest({ supabaseClient, table, columns, filters }) {
  let query = supabaseClient.from(table).select(columns.join(","));
  for (const [column, value] of filters) {
    query = query.eq(column, value);
  }
  const { data, error } = await query;
  assertNoQueryError(error);
  return digestListRows(data || [], columns);
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
  const digest = await probeListDigest({
    supabaseClient,
    table: "forge_scheduling_projects",
    columns: SCHEDULING_DIGEST_COLUMNS,
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
      digest,
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
  const digest = await probeListDigest({
    supabaseClient,
    table: "designer_projects",
    columns: DESIGNER_DIGEST_COLUMNS,
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
      digest,
    ],
    {
      revalidate: FORGE_LIST_CACHE_TTL_SECONDS,
    },
  );
  return cachedFetch();
}
