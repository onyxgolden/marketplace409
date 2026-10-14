/**
 * runner/launch.js — builtins-only authenticated launcher (CI-006).
 *
 * This is the ONLY official entrypoint for running corpus code. It imports
 * nothing but Node builtins (node:fs, node:crypto, node:child_process,
 * node:path, node:url) and authenticates EVERY corpus byte — verifier,
 * scorer, oracle, test, and runner files alike — BEFORE any corpus import
 * executes. There is no trust anchor exemption: src/trust.js is listed in
 * corpus/manifest.json and is verified like everything else.
 *
 * The approved root digest is TRUSTED HOST INPUT, read from the
 * CI_APPROVED_ROOT_DIGEST environment variable (or --digest <hex>). It is
 * never embedded in the corpus payload. Without a 64-hex host digest the
 * launcher fails closed.
 *
 * Usage:
 *   CI_APPROVED_ROOT_DIGEST=<64-hex> node runner/launch.js [manual|test]
 *     manual  run the manual smoke runner (default)
 *     test    run the full battery via node --test (spawned AFTER auth)
 *
 * Exit codes: 0 = authenticated and the subcommand succeeded; 1 = auth or
 * subcommand failure. No corpus code executes on any failure path.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HEX64 = /^[0-9a-f]{64}$/;
const sha256Hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// Independent canonicalization (duplicated here on purpose: the launcher
// must not import corpus code to verify corpus code).
function canonicalize(v) {
  const isObj = (x) => typeof x === "object" && x !== null && !Array.isArray(x);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  if (isObj(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

function fail(reason, detail = "") {
  console.error(`launcher: authentication failed: ${reason}${detail ? ` — ${detail}` : ""}`);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--digest"));
  let digest = process.env.CI_APPROVED_ROOT_DIGEST || null;
  const digestFlag = process.argv.find((a) => a.startsWith("--digest="));
  if (digestFlag) digest = digestFlag.slice("--digest=".length);
  if (!digest || !HEX64.test(digest)) {
    fail("host_root_required", "CI_APPROVED_ROOT_DIGEST (or --digest=<64-hex>) is trusted host input; it is not in the corpus");
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = process.env.CI_CORPUS_ROOT ? path.resolve(process.env.CI_CORPUS_ROOT) : path.resolve(here, "..");

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(root, "corpus", "manifest.json"), "utf8"));
  } catch (e) {
    fail("manifest_unreadable", String(e && e.message ? e.message : e));
  }
  if (!manifest || typeof manifest !== "object" || !manifest.files || typeof manifest.files !== "object") {
    fail("manifest_malformed");
  }
  const fileDigest = sha256Hex(canonicalize(manifest.files));
  if (fileDigest !== digest) {
    fail("root_digest_mismatch", `host digest does not match corpus/manifest.json (got ${fileDigest})`);
  }
  // Authenticate EVERY listed byte before any import executes.
  let count = 0;
  for (const [p, expected] of Object.entries(manifest.files)) {
    if (typeof expected !== "string" || !HEX64.test(expected)) fail("manifest_malformed", `bad hash for ${p}`);
    const full = path.resolve(root, p);
    if (!full.startsWith(root + path.sep)) fail("manifest_malformed", `path escapes corpus root: ${p}`);
    let content;
    try {
      content = readFileSync(full, "utf8");
    } catch (e) {
      fail("read_failed", p);
    }
    if (sha256Hex(content) !== expected) fail("file_tampered", p);
    count += 1;
  }
  console.error(`launcher: corpus authenticated (${count} files, root ${digest.slice(0, 12)}…) — host digest trusted`);

  // CI-006 round 4: enforce the expected executable file set on BOTH launch
  // paths. Test execution is derived EXCLUSIVELY from authenticated manifest
  // entries — never from disk enumeration. Any .js file under the corpus
  // dirs that is not in the manifest is an unlisted executable and fails
  // closed BEFORE any corpus code runs. This covers additions as well as
  // mutations/deletions.
  const manifestFiles = Object.keys(manifest.files).sort();
  const diskFiles = [];
  for (const dir of ["src", "tests", "runner"]) {
    const dirPath = path.join(root, dir);
    let entries;
    try {
      entries = readdirSync(dirPath);
    } catch (e) {
      fail("corpus_dir_unreadable", dir);
    }
    for (const f of entries.sort()) {
      if (f.endsWith(".js")) diskFiles.push(`${dir}/${f}`);
    }
  }
  diskFiles.sort();
  const manifestSet = new Set(manifestFiles);
  const unlisted = diskFiles.filter((f) => !manifestSet.has(f));
  if (unlisted.length > 0) {
    fail("unlisted_executable", `files on disk but not in the authenticated manifest: ${unlisted.join(", ")}`);
  }
  const missing = manifestFiles.filter((f) => !diskFiles.includes(f));
  if (missing.length > 0) {
    fail("manifest_file_missing", `manifest entries absent from disk: ${missing.join(", ")}`);
  }

  const mode = args[0] || "manual";
  // Mark authentication so runner code can refuse direct (unauthenticated) invocation.
  process.env.CI_CORPUS_AUTHENTICATED = "1";
  if (mode === "manual") {
    const target = path.join(root, "runner", "run-manual.js");
    return import(`file://${target}`).then(
      () => process.exit(0),
      (e) => {
        console.error(`launcher: manual runner failed: ${e && e.message ? e.message : e}`);
        process.exit(1);
      },
    );
  }
  if (mode === "test") {
    const testFiles = manifestFiles
      .filter((f) => f.startsWith("tests/") && f.endsWith(".test.js"))
      .map((f) => path.join(root, f));
    if (testFiles.length === 0) fail("no_tests", "no *.test.js in the authenticated manifest");
    const r = spawnSync(process.execPath, ["--test", ...testFiles], {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    process.exit(r.status === 0 ? 0 : 1);
  }
  fail("unknown_mode", `expected manual|test, got ${mode}`);
}

main();
