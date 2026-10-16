// Team Brain eng-memory slice 1 — fake in-memory store (synthetic only).
// Repository-adapter-shaped interface: the production Team Brain brief keeps
// pure validation/projection modules usable by both adapters, and this fake
// store stands in for the durable adapter in slice 1. No PGlite, no files,
// no network. Episodes persist pointers and typed coordination metadata
// only — never source bodies.
//
// The store is intentionally append-mostly: episodes are never updated or
// deleted (revocation suppresses retrieval, it does not erase history).

export function createFakeStore() {
  // identityHash -> episode
  const episodes = new Map();
  // insertion order for deterministic iteration
  const order = [];
  const retentionReviews = [];

  return {
    /** Persist an episode. Returns false when the identity already exists. */
    putEpisode(episode) {
      if (episodes.has(episode.identityHash)) return false;
      episodes.set(episode.identityHash, episode);
      order.push(episode.identityHash);
      return true;
    },
    getEpisode(identityHash) {
      return episodes.get(identityHash) || null;
    },
    /** Deterministic iteration: insertion order is stable per run. */
    *episodesInOrder() {
      for (const h of order) yield episodes.get(h);
    },
    episodeCount() {
      return episodes.size;
    },
    /** Record a retention-review request (revocation side effect). */
    addRetentionReview(review) {
      retentionReviews.push(review);
      return review;
    },
    listRetentionReviews() {
      return retentionReviews.slice();
    },
    /** Dump only safe metadata for leakage scanning. */
    dumpForScan() {
      return {
        episodes: order.map((h) => episodes.get(h)),
        retentionReviews: retentionReviews.slice(),
      };
    },
  };
}
