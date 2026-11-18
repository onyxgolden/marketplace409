// FCCU fixture loader — DEV ONLY (phone-fixture route).
//
// Loads the real FCCU Plot Plan design for the geometry guard's `fccu`
// case from the committed sanitized snapshot and PROVES it is the
// persisted project before the guard may use it:
//
//   source project design_mwjvt635_lmexii was read read-only from
//   production on 2026-11-17 and its canonical level design is
//   byte-identical to buildFccuPlotPlan() at this head (see
//   fccu-provenance.json: seedEquality). The snapshot
//   (public/phone-fixture/fccu-design-snapshot.json) is that canonical
//   level design; it carries no owner IDs, timestamps, auth data or
//   other identity — only drawing geometry, tags and services (verified
//   by scan at intake; the one "Owner"-matching key, `portOwners`, is
//   pipe-run topology, not a person).
//
//   The snapshot is fetched as exact bytes at runtime (same-origin
//   fetch from public/), NOT imported as a JS/JSON module: the
//   Turbopack dev bundler re-serializes JSON imports and silently
//   alters 130 float values (e.g. 3858.5407999999998 -> 3858.5408,
//   a different double), which breaks the provenance hash and means
//   the fixture would no longer BE the real design. Fetching the
//   committed bytes and parsing them in the browser preserves them
//   exactly. The loader re-verifies the fetched design on every load:
//   canonical SHA-256 + counts. Any mismatch (mutated snapshot,
//   drifted manifest, wrong counts, missing file) throws — the fixture
//   case renders a provenance-error state and the guard fails hard.
//   There is NO silent fallback to a synthetic stand-in: the snapshot
//   IS the verified real design, and if it ever stops being so, the
//   case must fail, not pass on something else.
//
// Canonical JSON matches Python's json.dumps(sort_keys=True,
// separators=(",", ":"), ensure_ascii=False): object keys sorted,
// no whitespace, raw non-ASCII. Numbers use JSON.stringify, which
// agrees with Python repr for every double in this design (verified:
// no integral-valued floats exist, so no 30.0-vs-30 divergence).
import PROVENANCE from "./fccu-provenance.json";

// Same-origin URL of the committed snapshot bytes.
export const FCCU_SNAPSHOT_URL = "/phone-fixture/fccu-design-snapshot.json";

export { PROVENANCE };

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

// Pure-JS SHA-256 (FIPS 180-4), sync so the fixture can verify in the
// browser without a crypto dependency. Unit-tested against the known
// vectors and the manifest hash in fccuFixture.test.js.
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

export function sha256Hex(message) {
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);
  let h0 = 0x6a09e667; let h1 = 0xbb67ae85; let h2 = 0x3c6ef372; let h3 = 0xa54ff53a;
  let h4 = 0x510e527f; let h5 = 0x9b05688c; let h6 = 0x1f83d9ab; let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0; let b = h1; let c = h2; let d = h3;
    let e = h4; let f = h5; let g = h6; let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, "0")).join("");
}

export function countFccuDesign(levelDesign) {
  const symbols = levelDesign.symbols || [];
  return {
    pipes: (levelDesign.pipes || []).length,
    symbols: symbols.length,
    equipment: symbols.filter((s) => s.layer === "equipment").length,
    annotations: (levelDesign.annotations || []).length,
    rooms: (levelDesign.rooms || []).length,
    systems: (levelDesign.systems || []).length,
    walls: (levelDesign.walls || []).length,
    decks: (levelDesign.decks || []).length,
  };
}

// Verify a level design against the provenance manifest. Returns
// { sha, counts } or throws with the exact mismatch — the caller must
// treat a throw as a hard fixture failure, never a fallback.
export function verifyFccuDesign(levelDesign) {
  const sha = sha256Hex(canonicalJson(levelDesign));
  const counts = countFccuDesign(levelDesign);
  const errors = [];
  if (sha !== PROVENANCE.levelDesignSha256) {
    errors.push(`level-design SHA mismatch: got ${sha}, want ${PROVENANCE.levelDesignSha256}`);
  }
  for (const [key, want] of Object.entries(PROVENANCE.counts)) {
    if (counts[key] !== want) errors.push(`count ${key} mismatch: got ${counts[key]}, want ${want}`);
  }
  if (errors.length) {
    throw new Error(`FCCU provenance verification failed: ${errors.join("; ")}`);
  }
  return { sha, counts };
}

// Fetch the verified FCCU level design for the fixture from the
// committed snapshot bytes. Throws on any provenance mismatch or
// missing file — no synthetic fallback.
export async function loadVerifiedFccuLevelDesign() {
  const res = await fetch(FCCU_SNAPSHOT_URL);
  if (!res.ok) {
    throw new Error(
      `FCCU fixture missing: ${FCCU_SNAPSHOT_URL} returned ${res.status} (source ${PROVENANCE.sourceProjectId}, expected SHA ${PROVENANCE.levelDesignSha256})`,
    );
  }
  const design = await res.json();
  const { sha, counts } = verifyFccuDesign(design);
  return { design, sha, counts, sourceProjectId: PROVENANCE.sourceProjectId };
}
