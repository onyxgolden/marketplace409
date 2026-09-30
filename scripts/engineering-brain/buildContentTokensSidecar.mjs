#!/usr/bin/env node
/**
 * buildContentTokensSidecar.mjs — generate engineering-brain/content-tokens.json.
 *
 * The committed index-manifest.json is a point-in-time snapshot that is deliberately NOT
 * regenerated on every extractor change (recommitting the 3.1MB manifest would trigger a
 * zero-gain Vercel deploy; the nightly sync rebuilds the live Supabase index fresh instead).
 * But the local query CLI and the test suite read the committed manifest -- so content tokens
 * for THAT snapshot ship as a small sidecar: path -> bounded token list, mined from the
 * manifest's own commit via git.
 *
 * Deterministic: same manifest commit always yields the same sidecar. Regenerate by hand
 * whenever the manifest snapshot is regenerated:
 *
 *   node scripts/engineering-brain/buildContentTokensSidecar.mjs
 *
 * loadManifest.mjs merges the sidecar into records at load time (commit SHA must match;
 * a stale sidecar is ignored). Fresh indexer runs (buildIndexRecords.mjs) and the nightly
 * Supabase sync carry content_tokens on the records themselves and never need this file.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

import { extractContentTokens } from "./extractContentTokens.mjs";

const MANIFEST_PATH = path.join("engineering-brain", "index-manifest.json");
const SIDECAR_PATH = path.join("engineering-brain", "content-tokens.json");

// Parse `git cat-file --batch` output: "<sha> <type> <size>\n<bytes>\n" per input line.
function fetchContentsBatch(commitSha, paths) {
  const input = paths.map((p) => `${commitSha}:${p}`).join("\n");
  const raw = execFileSync("git", ["cat-file", "--batch"], {
    input,
    maxBuffer: 1024 * 1024 * 1024,
  }).toString("latin1");

  const contents = new Map();
  let pos = 0;
  for (const p of paths) {
    const nl = raw.indexOf("\n", pos);
    if (nl === -1) break;
    const header = raw.slice(pos, nl);
    const parts = header.split(" ");
    if (parts[1] === "missing") {
      pos = nl + 1;
      continue;
    }
    const size = parseInt(parts[2], 10);
    contents.set(p, raw.slice(nl + 1, nl + 1 + size));
    pos = nl + 1 + size + 1;
  }
  return contents;
}

function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const commitSha = manifest.commit_sha;
  if (!commitSha) throw new Error("Manifest has no commit_sha; cannot mine content.");

  const paths = [...new Set((manifest.records || []).map((r) => r.source_path))].sort();
  console.log(`Mining content tokens for ${paths.length} paths at ${commitSha.slice(0, 12)}...`);

  const contents = fetchContentsBatch(commitSha, paths);
  const tokens = {};
  let mined = 0;
  for (const p of paths) {
    const content = contents.get(p);
    if (content === undefined) continue;
    tokens[p] = extractContentTokens(content);
    mined += 1;
  }

  const sidecar = {
    schema_version: "1.0",
    commit_sha: commitSha,
    extractor: "extractContentTokens.mjs",
    generated_at: new Date().toISOString(),
    path_count: mined,
    tokens,
  };
  writeFileSync(SIDECAR_PATH, JSON.stringify(sidecar));
  console.log(`Wrote ${SIDECAR_PATH}: ${mined}/${paths.length} paths.`);
}

main();
