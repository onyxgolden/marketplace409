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
// Post-write freshness — completeness (fix round 3 for PR #822, ChatGPT
// NEEDS CHANGES P1: the digest probe does not prove it saw every row):
// - Fix round 2's probe was a single PostgREST .select() with no
//   pagination, ordering, or completeness check. PostgREST caps rows per
//   response (commonly 1,000 — this repo's SupabaseFinancialEventRepository
//   pages at 1,000 for exactly that reason). Once the visible set exceeds
//   the cap, the unordered probe can hash a different subset from the
//   latest-updated-first list query: a rename to a row in the list but
//   outside the probe's first page leaves the digest unchanged and the
//   next GET serves the pre-write entry. The digest was exact for bounded
//   sets and unproven for oversized ones — and the code claimed it
//   unconditionally.
// - The fix is verdict option 3 (detect the boundary, bypass the cache
//   for unprovably complete results): the probe now asks for
//   { count: "exact" } and is complete ONLY when the exact total equals
//   the rows received. The count is computed by PostgREST over the same
//   filtered set in the same statement as the rows, so the check needs no
//   assumption about what the cap value is — and if the count is missing
//   (a client that did not return one) the probe is treated as
//   incomplete, fail closed. When the probe is incomplete, the GET skips
//   the cache entirely and serves the uncached list read. For Designer
//   that read IS the pre-S2A single query. For Scheduling it is NOT —
//   see the fix-round-4 section below: the private-only bypass plus a
//   fresh public append is a different list from the original single
//   query at the combined cap, and the route orchestrator governs it.
//   The probe and the list read the same row set (same filters, same RLS,
//   same client), so a complete probe proves the list fill is complete
//   too — the list query selects more columns but the cap is on rows.
//   CORRECTION (fix round 4, ChatGPT NEEDS CHANGES P1): the round-3
//   text claimed an incomplete probe costs "exactly the uncached
//   baseline" and oversized lists are "no worse than the baseline".
//   Both are wrong on cost: the bypass path runs the probe AND the list
//   read — two DB requests, plus the probe's row transfer and SHA-256 —
//   against the baseline's one. Semantics are preserved; cost is not
//   identical. See "Honest performance trade-off" below.
// - TOCTOU: a write can still land between the probe and the cache-miss
//   fill. The cached callback recomputes the digest from the rows it
//   actually fetched and throws ForgeListDigestMismatchError instead of
//   publishing newer data under the old generation (or vice versa —
//   publishing under a stale generation is wrong in the revert case too).
//   The getter catches that one error type and retries ONCE with a fresh
//   probe, so a single concurrent write resolves transparently with fresh
//   data; a second mismatch propagates visibly (500, never cached) and
//   the next read retries. Mutations still perform NO cache operation, so
//   there is still no invalidation step that can fail silently.
//
// Combined-list semantics — Scheduling split vs the original single
// query (fix round 4 for PR #822, ChatGPT NEEDS CHANGES P1: the split
// violates the baseline list contract at the global response cap):
// - Pre-S2A, Scheduling GET ran ONE RLS-visible select, order
//   updated_at desc, and the configured PostgREST response cap applied
//   to the COMBINED private + public list. S2A split it into a private
//   select and a separate public select and merged without the combined
//   cap: 1,000 private + 1 public returned 1,001 rows where the original
//   returned at most 1,000, and membership differed (an old public row
//   the original excluded was always included; a newest public row the
//   original let displace an older private row was included alongside
//   it). The round-3 private-probe bypass did not fix this: its fallback
//   was still the private-only query, with public rows appended after.
// - The fix, per the verdict, is a full COMBINED original Scheduling
//   query on the boundary/bypass path, with no cap value assumed:
//   getSchedulingProjects() first runs a combined boundary probe —
//   select id with { count: "exact" }, NO filters, no ORDER BY — over
//   the whole RLS-visible set. PostgREST reports the true total in the
//   same statement while capping the returned ids, so total > ids
//   received proves the combined set is at/over the server-configured
//   cap (and ids received IS the cap in that case, though the code never
//   needs its value), total === ids received proves the whole combined
//   set fits under it, and a missing count fails closed to the boundary
//   path. On the boundary path the GET runs fetchOriginalSchedulingListRows
//   — the exact pre-S2A single query (all list columns, no filters,
//   order updated_at desc) — which PostgREST caps exactly as the
//   original did: same membership, same ordering, same truncation.
//   No public row is dropped and no merged list is truncated: the
//   ordering semantics are the original query's own, demonstrated by
//   the full-route regressions (1,000 private + 1 public, public newest
//   and oldest; private alone over the cap), which compare exact
//   ordered IDs and count against a capped implementation of the
//   original single query.
// - On the bounded path (combined probe complete) the split path runs
//   as before — cached private rows + fresh public rows, merged — and
//   the merged count equals the probed combined total, which is at or
//   under the cap, so the bounded path cannot return a combined result
//   exceeding the original response limit. A write landing BETWEEN the
//   boundary probe and the split reads could still push the total over
//   the cap (the private probe's own bypass would then serve a
//   private-only list with public rows appended); the orchestrator
//   therefore re-checks the merged length against the probed combined
//   total and, if it grew, re-runs the full combined original query
//   for this GET. Deletes and is_public flips cannot grow the merged
//   length past the probed total, so only growth triggers the re-run.
// - Designer is untouched by this: no public rows, no split, its single
//   query already is the original query.
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
// - Correctness now requires probes to read visible rows on every GET.
//   A bounded Scheduling GET costs THREE PostgREST round trips minimum
//   — the combined boundary probe (up to the cap's worth of ids + an
//   exact count), the private digest probe (up to the cap's worth of
//   digest columns + an exact count, plus SHA-256 over them), and the
//   always-fresh public fetch — against the uncached baseline's ONE.
//   The cache saves the wide-column fetch + ORDER BY + DTO mapping/
//   sort/merge on a hit, NOT a round trip. A cache miss adds the
//   private list select on top. The net latency gain is therefore
//   expected to be SMALL, and may be negative on a miss.
// - A boundary/bypass GET costs the combined boundary probe PLUS the
//   full combined list query — TWO round trips and up to a cap's worth
//   of id transfer before the list payload — strictly MORE than the
//   baseline's single query. The round-3 claim that "oversized lists
//   are no worse than the baseline" is incorrect and is retracted here:
//   they pay one extra round trip and the probe transfer, and get no
//   cache benefit. Likewise the incomplete-private-probe path (a write
//   landing between the boundary probe and the split reads) costs the
//   combined probe + the private probe + the private list read + the
//   public fetch, and possibly the combined query on top if the merged
//   length grew past the probed total.
// - Do NOT claim a speed improvement from this cache. The live
//   before/after timing receipt (post-deploy, per the scope) is the
//   judge: if it shows no improvement, record NO IMPROVEMENT and take
//   slice #8 (server-prefetch) next — do not claim improvement from hit
//   counters, which count list selects, not round trips.
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

// Thrown inside the cached callback when the rows actually fetched hash
// to a different generation than the probe that keyed the entry — a write
// landed between the probe and the fill. The getter catches exactly this
// error for one bounded retry; anything else propagates visibly.
export class ForgeListDigestMismatchError extends Error {
  constructor(message) {
    super(message);
    this.name = "ForgeListDigestMismatchError";
  }
}

// One round trip over exactly the RLS-visible set the list query reads,
// returning the digest of that set plus a PROOF of completeness (not a
// summary of it): every row's digest columns, no ORDER BY, no LIMIT.
// `filters` are the same equality filters the list query applies
// (is_public=false for the Scheduling private set, owner_id for
// Designer) — the probe and the list read the same set, so a write
// visible to the list always moves the digest. The probe is NOT cached:
// it runs on every GET, and a probe failure throws, so the GET fails
// visibly instead of serving a possibly-stale entry.
//
// Completeness (fix round 3): the select asks for { count: "exact" }.
// PostgREST reports the true total over the same filtered set in the
// same statement as the rows, while capping the rows per response — so
// `count === data.length` proves the probe saw every visible row, and
// `count > data.length` proves it did not, with no assumption about the
// cap value. A missing count is treated as incomplete (fail closed).
// The digest of a truncated probe is meaningless and is never used as a
// cache key — the caller bypasses the cache instead.
async function probeListDigest({ supabaseClient, table, columns, filters }) {
  let query = supabaseClient
    .from(table)
    .select(columns.join(","), { count: "exact" });
  for (const [column, value] of filters) {
    query = query.eq(column, value);
  }
  const { data, error, count } = await query;
  assertNoQueryError(error);
  const rows = data || [];
  const complete = typeof count === "number" && count === rows.length;
  return {
    digest: digestListRows(rows, columns),
    complete,
    totalCount: typeof count === "number" ? count : null,
    rowCount: rows.length,
  };
}

// The raw list reads, exactly the pre-S2A single queries (per subset):
// used inside the cached callback and on the private-probe-incomplete
// fallback inside getCachedProjectList. For Designer that fallback IS
// the original single query. For Scheduling it is NOT the served list
// on its own — the route orchestrator (getSchedulingProjects) re-checks
// the merged length against the combined boundary probe and falls back
// to the full combined original query, so a private-only fallback
// result is never served past the original response limit.
async function fetchSchedulingPrivateListRows({ supabaseClient }) {
  const { data, error } = await supabaseClient
    .from("forge_scheduling_projects")
    .select(SCHEDULING_LIST_COLUMNS)
    .eq("is_public", false)
    .order("updated_at", { ascending: false });
  assertNoQueryError(error);
  return data || [];
}

async function fetchDesignerListRows({ supabaseClient, ownerIdentity }) {
  const { data, error } = await supabaseClient
    .from("designer_projects")
    .select(DESIGNER_LIST_COLUMNS)
    .eq("owner_id", ownerIdentity)
    .order("updated_at", { ascending: false });
  assertNoQueryError(error);
  return data || [];
}

// Shared cached-list read: probe → (complete ? cached : bypass).
// `fetchRawRows` is the single-query list read above; `toDto` maps raw
// rows to the list DTO. The cached callback re-checks the generation
// against the rows it actually fetched (TOCTOU, fix round 3) and the
// getter retries a mismatch exactly once with a fresh probe.
async function getCachedProjectList({
  supabaseClient,
  app,
  ownerIdentity,
  actorId,
  table,
  columns,
  filters,
  fetchRawRows,
  toDto,
}) {
  const attempt = async (digest) => {
    const cachedFetch = unstable_cache(
      async () => {
        const rows = await fetchRawRows();
        // TOCTOU re-check: the fetched rows must hash to the generation
        // this entry is filed under. If a write landed between the probe
        // and this fill, throw instead of publishing newer data under the
        // old generation (or vice versa — see the header).
        if (digestListRows(rows, columns) !== digest) {
          throw new ForgeListDigestMismatchError(
            `Forge list cache generation mismatch for ${app}/${ownerIdentity}: the rows fetched under generation ${digest} hash differently — a write landed between the probe and the fill; refusing to publish under a stale generation.`,
          );
        }
        return rows.map(toDto);
      },
      [
        "forge-list",
        app,
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
  };
  const probe = await probeListDigest({
    supabaseClient,
    table,
    columns,
    filters,
  });
  if (!probe.complete) {
    // Unprovably complete: bypass the cache entirely. The digest of a
    // truncated probe must never key a cached entry.
    const rows = await fetchRawRows();
    return rows.map(toDto);
  }
  try {
    return await attempt(probe.digest);
  } catch (error) {
    if (
      error instanceof ForgeListDigestMismatchError ||
      error?.name === "ForgeListDigestMismatchError"
    ) {
      // One bounded retry with a fresh probe: a single concurrent write
      // resolves transparently with fresh data. A second mismatch
      // propagates visibly (500, never cached) and the next read retries.
      // The write is never retried.
      const freshProbe = await probeListDigest({
        supabaseClient,
        table,
        columns,
        filters,
      });
      if (!freshProbe.complete) {
        const rows = await fetchRawRows();
        return rows.map(toDto);
      }
      return await attempt(freshProbe.digest);
    }
    throw error;
  }
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
  return getCachedProjectList({
    supabaseClient,
    app: "scheduling",
    ownerIdentity,
    actorId,
    table: "forge_scheduling_projects",
    columns: SCHEDULING_DIGEST_COLUMNS,
    filters: [["is_public", false]],
    fetchRawRows: () => fetchSchedulingPrivateListRows({ supabaseClient }),
    toDto: (row) => toSchedulingProjectDto(row, effectiveOwnerId),
  });
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

// Scheduling combined boundary probe (fix round 4): one round trip
// over the WHOLE RLS-visible set — no is_public filter, no ORDER BY,
// id only — asking for { count: "exact" }. PostgREST reports the true
// total in the same statement while capping the returned ids at the
// server-configured response cap, so `totalCount > rowCount` proves the
// combined set is at/over that cap (and rowCount IS the cap then,
// though the code never needs its value), while
// `totalCount === rowCount` proves the whole combined set fits under
// it. A missing count fails closed to the boundary path. No cap value
// is assumed anywhere: the 1,000-row figure in the tests is the fake's
// model of a server-configured cap, not a number the implementation
// knows. This probe is id-only so its transfer is minimal; it is NOT a
// generation — it only decides boundary vs bounded, never freshness.
async function probeSchedulingCombinedBoundary({ supabaseClient }) {
  const { data, error, count } = await supabaseClient
    .from("forge_scheduling_projects")
    .select("id", { count: "exact" });
  assertNoQueryError(error);
  const rows = data || [];
  const complete = typeof count === "number" && count === rows.length;
  return {
    complete,
    totalCount: typeof count === "number" ? count : null,
    rowCount: rows.length,
  };
}

// The exact pre-S2A Scheduling list query: one select over the whole
// RLS-visible set, no is_public filter, order updated_at desc.
// PostgREST caps it at the server-configured response cap exactly as
// the original did — same membership, same ordering, same truncation.
// This is the boundary/bypass path's list read: no public row is
// dropped and no merged list is truncated, because the ordering
// semantics are the original query's own.
export async function fetchOriginalSchedulingListRows({ supabaseClient }) {
  const { data, error } = await supabaseClient
    .from("forge_scheduling_projects")
    .select(SCHEDULING_LIST_COLUMNS)
    .order("updated_at", { ascending: false });
  assertNoQueryError(error);
  return data || [];
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

// Scheduling list GET — the route-level read (fix round 4). The
// combined boundary probe decides the path; the split path is only ever
// taken when the whole combined set provably fits under the
// server-configured response cap, so the bounded path cannot return a
// combined result exceeding the original response limit. A write landing
// between the boundary probe and the split reads is caught by the
// merged-length re-check: if the merged list grew past the probed
// combined total, this GET re-runs the full combined original query,
// which is the exact original semantics at read time.
export async function getSchedulingProjects({
  supabaseClient,
  effectiveOwnerId,
  actorId,
}) {
  const boundary = await probeSchedulingCombinedBoundary({ supabaseClient });
  if (!boundary.complete) {
    const rows = await fetchOriginalSchedulingListRows({ supabaseClient });
    return rows.map((row) => toSchedulingProjectDto(row, effectiveOwnerId));
  }
  const privateProjects = await getCachedSchedulingPrivateProjects({
    supabaseClient,
    effectiveOwnerId,
    actorId,
  });
  const publicProjects = await fetchFreshPublicSchedulingProjects({
    supabaseClient,
    effectiveOwnerId,
  });
  const merged = mergeSchedulingProjectLists(privateProjects, publicProjects);
  if (merged.length > boundary.totalCount) {
    // A write landed between the boundary probe and the split reads and
    // pushed the combined set past the probed total — possibly past the
    // response cap. Serve the exact original query instead of a merged
    // list that could exceed it.
    const rows = await fetchOriginalSchedulingListRows({ supabaseClient });
    return rows.map((row) => toSchedulingProjectDto(row, effectiveOwnerId));
  }
  return merged;
}

// Designer: the whole list DTO, strictly owner-filtered (no public rows),
// so the whole DTO is cached per (app, version, owner, actor, generation).
export async function getCachedDesignerProjects({
  supabaseClient,
  ownerId,
  actorId,
}) {
  const ownerIdentity = ownerId || actorId;
  return getCachedProjectList({
    supabaseClient,
    app: "designer",
    ownerIdentity,
    actorId,
    table: "designer_projects",
    columns: DESIGNER_DIGEST_COLUMNS,
    filters: [["owner_id", ownerIdentity]],
    fetchRawRows: () =>
      fetchDesignerListRows({ supabaseClient, ownerIdentity }),
    toDto: toDesignerProjectDto,
  });
}
