// TEST-ONLY synthetic next/cache for the FORGE list-read cache tests.
//
// Models the contract of Next.js 16.4.1's unstable_cache / revalidateTag
// that src/lib/forge/listReadCache.js depends on — NOT Next's exact
// key-string construction:
// - Same callback source + same keyParts => the same entry; different
//   keyParts (different app/owner/actor) => different entries.
// - A hit returns the stored value WITHOUT invoking the callback.
// - A miss invokes the callback once and stores its resolved value.
// - Errors are never stored (a failed callback is re-run on the next call).
// - After the TTL (options.revalidate seconds) the entry expires (a miss).
// - revalidateTag(tag) makes every entry carrying that tag miss
//   IMMEDIATELY — matching the deployed runtime, where FileSystemCache.get
//   returns null for tag-revalidated FETCH entries ("When revalidate tag is
//   called we don't return stale data so it's updated right away"), instead
//   of serving stale-while-revalidate.
// - TTL uses Date.now(), so tests drive expiry with vi.useFakeTimers().
//
// Test files mock next/cache by spreading the real module and overriding
// only unstable_cache/revalidateTag with these (see listReadCache.test.js),
// so every other next/cache export stays real.

const entries = new Map();
const tagGenerations = new Map();
export const revalidateTagCalls = [];
let nextRevalidateTagFailure = null;

// Test control: make the NEXT revalidateTag call throw (e.g. a local
// cache failure), so a test can prove invalidateForgeProjectList swallows
// it instead of failing a mutation that already landed.
export function failNextRevalidateTagOnce(error) {
  nextRevalidateTagFailure = error;
}

function cacheKey(cb, keyParts, args) {
  return `${cb.toString()}|${JSON.stringify(keyParts)}|${JSON.stringify(args || [])}`;
}

export function unstable_cache(cb, keyParts, options = {}) {
  const tags = [...(options.tags || [])];
  const ttlMs = (options.revalidate ?? 0) * 1000;
  return async (...args) => {
    const key = cacheKey(cb, keyParts, args);
    const now = Date.now();
    const entry = entries.get(key);
    if (entry) {
      const tagInvalidated = entry.tags.some(
        (tag) => (tagGenerations.get(tag) || 0) > entry.tagGenerationAtWrite,
      );
      if (!tagInvalidated && (ttlMs === 0 || now < entry.expiresAtMs)) {
        return entry.value;
      }
    }
    const value = await cb(...args);
    const generationAtWrite = Math.max(
      0,
      ...tags.map((tag) => tagGenerations.get(tag) || 0),
    );
    entries.set(key, {
      value,
      tags,
      tagGenerationAtWrite: generationAtWrite,
      expiresAtMs: ttlMs === 0 ? Number.POSITIVE_INFINITY : now + ttlMs,
    });
    return value;
  };
}

export function revalidateTag(tag, _profile) {
  if (nextRevalidateTagFailure) {
    const failure = nextRevalidateTagFailure;
    nextRevalidateTagFailure = null;
    throw failure;
  }
  revalidateTagCalls.push(tag);
  tagGenerations.set(tag, (tagGenerations.get(tag) || 0) + 1);
}

// Call in beforeEach: tests share one process, so the cache must start
// empty for every test or a previous test's entry would leak across.
export function resetTestIncrementalCache() {
  entries.clear();
  tagGenerations.clear();
  revalidateTagCalls.length = 0;
  nextRevalidateTagFailure = null;
}
