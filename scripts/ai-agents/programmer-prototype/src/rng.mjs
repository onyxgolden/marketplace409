/**
 * rng.mjs — deterministic PRNG (xmur3 seed hash + mulberry32 stream).
 * Pure module: no I/O. Used for the deterministic seed generator so the
 * 1,000-ticket corpus is byte-identical across runs from CORPUS_SEED.
 */

export function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export function mulberry32(seedUint32) {
  let a = seedUint32 >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic RNG stream for an arbitrary string seed. */
export function rngFromString(seedStr) {
  return mulberry32(xmur3(seedStr)());
}

/** Deterministic uint32 seed for a ticket id (recorded in results). */
export function seedForTicket(corpusSeed, ticketId) {
  return xmur3(`${corpusSeed}:${ticketId}`)();
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function intBelow(rng, n) {
  return Math.floor(rng() * n);
}
