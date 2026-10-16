/**
 * tokenizer.js — pure-Node GPT-2 byte-level BPE tokenizer.
 *
 * Pinned tokenizer for the dom-distillation slice: `gpt2-bpe/1`.
 * The merge table is vendored at ../tokenizer/vocab.bpe (OpenAI public
 * GPT-2 merges, 50,000 ranks; third-party notice in README.md). No network,
 * no runtime downloads, no native modules, no WASM. The file is loaded
 * once from disk at first use and the rank table is frozen.
 *
 * This tokenizer is a pinned, static, deterministic measurement instrument.
 * It approximates subword segmentation of the target model family; token
 * counts are measured with THIS tokenizer, never with characters and never
 * with a vendor claim. All reduction figures in the benchmark are relative
 * to this same tokenizer on both sides.
 *
 * Pure Node 24 ESM. Deterministic: no randomness, no time, no locale.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const TOKENIZER_ID = "gpt2-bpe/1";
export const TOKENIZER_SOURCE = "vendored ../tokenizer/vocab.bpe (OpenAI GPT-2 merges, 50000 ranks)";

// --- byte <-> unicode bijection (standard GPT-2 encoder table) ---
function bytesToUnicode() {
  const bs = [];
  for (let i = 33; i <= 126; i++) bs.push(i);       // '!'..'~'
  for (let i = 161; i <= 172; i++) bs.push(i);      // '¡'..'¬'
  for (let i = 174; i <= 255; i++) bs.push(i);      // '®'..'ÿ'
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n++;
    }
  }
  const out = new Map();
  for (let i = 0; i < bs.length; i++) out.set(bs[i], String.fromCodePoint(cs[i]));
  return out;
}
const BYTE_TO_UNICODE = bytesToUnicode();

let _ranks = null;   // Map<string, number>
let _cache = new Map();

function loadRanks() {
  if (_ranks) return _ranks;
  const raw = readFileSync(join(HERE, "..", "tokenizer", "vocab.bpe"), "utf8");
  const lines = raw.split("\n");
  const ranks = new Map();
  let rank = 0;
  for (const line of lines) {
    if (!line || line.startsWith("#version")) continue;
    // A merge line is two space-separated tokens; a token may itself be empty
    // only for pathological lines — split on the FIRST space boundary of the
    // two-token form: tokens never contain ASCII spaces in this file.
    const idx = line.indexOf(" ");
    if (idx < 0) continue;
    const a = line.slice(0, idx);
    const b = line.slice(idx + 1);
    ranks.set(a + " " + b, rank);
    rank++;
  }
  if (ranks.size !== 50000) {
    throw new Error(`tokenizer: expected 50000 merge ranks, got ${ranks.size} — vendored file suspect`);
  }
  _ranks = ranks;
  return ranks;
}

function getPairs(word) {
  const pairs = new Set();
  let prev = word[0];
  for (let i = 1; i < word.length; i++) {
    const cur = word[i];
    pairs.add(prev + " " + cur);
    prev = cur;
  }
  return pairs;
}

/** Byte-pair encode one pre-token (already unicode-mapped). */
function bpe(token, ranks) {
  if (_cache.has(token)) return _cache.get(token);
  let word = [...token]; // array of single unicode chars
  if (word.length === 1) {
    _cache.set(token, token);
    return token;
  }
  const merged = [];
  while (true) {
    const pairs = getPairs(word);
    let best = null;
    let bestRank = Infinity;
    for (const p of pairs) {
      const r = ranks.get(p);
      if (r !== undefined && r < bestRank) {
        bestRank = r;
        best = p;
      }
    }
    if (best === null) break;
    const [first, second] = best.split(" ");
    const next = [];
    let i = 0;
    while (i < word.length) {
      const j = word.indexOf(first, i);
      if (j < 0) {
        next.push(...word.slice(i));
        break;
      }
      next.push(...word.slice(i, j));
      if (j < word.length - 1 && word[j + 1] === second) {
        next.push(first + second);
        i = j + 2;
      } else {
        next.push(word[j]);
        i = j + 1;
      }
    }
    word = next;
    if (word.length === 1) break;
  }
  const out = word.join(" ");
  _cache.set(token, out);
  merged.push(out);
  return out;
}

// GPT-2 pre-tokenizer pattern (unicode-aware).
const PAT = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

/** Encode text to a token-count only (we never need ids, only counts). */
export function countTokens(text) {
  const ranks = loadRanks();
  let n = 0;
  PAT.lastIndex = 0;
  let m;
  while ((m = PAT.exec(text)) !== null) {
    const piece = m[0];
    // map UTF-8 bytes through the unicode bijection
    const bytes = Buffer.from(piece, "utf8");
    let mapped = "";
    for (const b of bytes) mapped += BYTE_TO_UNICODE.get(b);
    const enc = bpe(mapped, ranks);
    n += enc === "" ? 0 : enc.split(" ").length;
  }
  return n;
}

/** Encode text to token strings (for debugging/tests). */
export function encode(text) {
  const ranks = loadRanks();
  const out = [];
  PAT.lastIndex = 0;
  let m;
  while ((m = PAT.exec(text)) !== null) {
    const bytes = Buffer.from(m[0], "utf8");
    let mapped = "";
    for (const b of bytes) mapped += BYTE_TO_UNICODE.get(b);
    const enc = bpe(mapped, ranks);
    if (enc !== "") out.push(...enc.split(" "));
  }
  return out;
}

export function tokenizerInfo() {
  loadRanks();
  return {
    id: TOKENIZER_ID,
    source: TOKENIZER_SOURCE,
    ranks: 50000,
    deterministic: true,
    runtime_downloads: false,
  };
}
