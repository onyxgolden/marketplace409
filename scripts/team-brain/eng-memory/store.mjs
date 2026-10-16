// Team Brain eng-memory slice 1 — fake in-memory store (synthetic only).
// Repository-adapter-shaped interface: the production Team Brain brief keeps
// pure validation/projection modules usable by both adapters, and this fake
// store stands in for the durable adapter in slice 1. No PGlite, no files,
// no network. Episodes persist pointers and typed coordination metadata
// only — never source bodies.
//
// The store is intentionally append-mostly: episodes are never updated or
// deleted (revocation suppresses retrieval, it does not erase history).
//
// Adapter boundary rule (EMEM-005): every episode and review is DETACHED on
// insertion and on every outward-facing read. Callers receive plain-data
// copies; mutating a returned object can never alter stored evidence, and
// mutating caller input after capture can never affect the store.

/** Deep-detach plain data. Episodes/reviews are JSON-safe by construction. */
function detach(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createFakeStore() {
  // identityHash -> episode
  const episodes = new Map();
  // insertion order for deterministic iteration
  const order = [];
  // reviewId -> retention review
  const retentionReviews = new Map();
  const reviewOrder = [];

  return {
    /** Persist an episode (detached). Returns false when the identity already exists. */
    putEpisode(episode) {
      if (episodes.has(episode.identityHash)) return false;
      const copy = detach(episode);
      episodes.set(copy.identityHash, copy);
      order.push(copy.identityHash);
      return true;
    },
    /** Detached copy; mutating it cannot affect stored evidence. */
    getEpisode(identityHash) {
      const ep = episodes.get(identityHash);
      return ep ? detach(ep) : null;
    },
    /** Deterministic iteration: insertion order is stable per run. Detached. */
    *episodesInOrder() {
      for (const h of order) yield detach(episodes.get(h));
    },
    episodeCount() {
      return episodes.size;
    },
    /**
     * Idempotent retention-review write, keyed by reviewId. Denial and
     * revocation each derive a deterministic reviewId from (trigger,
     * source), so retries, crash replays, and repeated capture attempts on
     * a revoked source converge on ONE review record instead of pushing
     * duplicates. Returns {created, review} with a detached review.
     */
    ensureRetentionReview(review) {
      const existing = retentionReviews.get(review.reviewId);
      if (existing) return { created: false, review: detach(existing) };
      const copy = detach(review);
      retentionReviews.set(copy.reviewId, copy);
      reviewOrder.push(copy.reviewId);
      return { created: true, review: detach(copy) };
    },
    /** Detached copies in insertion order. */
    listRetentionReviews() {
      return reviewOrder.map((id) => detach(retentionReviews.get(id)));
    },
    /** Dump only safe detached metadata for leakage scanning. */
    dumpForScan() {
      return {
        episodes: order.map((h) => detach(episodes.get(h))),
        retentionReviews: reviewOrder.map((id) => detach(retentionReviews.get(id))),
      };
    },
  };
}
