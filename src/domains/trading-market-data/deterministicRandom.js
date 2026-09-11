// A small, dependency-free, seeded pseudo-random number generator (mulberry32). Math.random() is
// explicitly NOT used anywhere in this domain -- it cannot be seeded, so two runs would never produce
// provably identical output, which breaks TR-1F-A's core "identical seed + config -> identical
// scenario" requirement. mulberry32 is a well-known, simple, fast 32-bit generator; it is not
// cryptographically secure and must never be used for anything security-sensitive -- it exists here
// purely to make synthetic market bars reproducible.

// seed: any 32-bit unsigned integer. Returns a function that yields floats in [0, 1) on each call,
// advancing its own internal state -- the same seed always produces the same sequence.
export function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Derives a 32-bit integer seed deterministically from a string (e.g. a scenario id + version), so
// callers never have to hand-pick numeric seeds -- the same string always maps to the same seed. This
// is a simple FNV-1a hash, chosen for being tiny, dependency-free, and well-distributed enough for
// this non-cryptographic purpose.
export function seedFromString(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
