/**
 * fix-round5.test.js — PR #667 fix-round-2 regressions:
 *   Q665-002A.2 (P1) output-directory replacement still permits checkout
 *   overwrite.
 *
 * Atomic temp-file + rename fixed the hard-link truncation (Q665-002A.1),
 * but the destination directory was validated and then used by pathname:
 * renaming the directory aside and replacing it with a symlink to the
 * evidenced checkout between the stat and the temp open/rename smuggled
 * the write into the checkout. The repair anchors the directory to a
 * verified handle identity (O_DIRECTORY|O_NOFOLLOW open, kernel-resolved
 * identity must equal the validated canonical directory) and performs
 * temp creation + rename relative to that handle through
 * /proc/self/fd/<fd>, so a swap after the open cannot redirect the
 * write. Any failure refuses the write (exit 2) instead of writing to
 * an unvalidated location.
 *
 * The race is triggered deterministically with a --require preload that
 * hooks fs.openSync (synced into the ESM namespace) and performs the
 * swap at the exact synchronization point the old code exposed.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../runner/run-job.mjs", import.meta.url));

function git(dir, args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
}

function runCli(args, extraNodeArgs = []) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [...extraNodeArgs, CLI, ...args],
      { encoding: "utf8" },
      (err, stdout, stderr) => {
        resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr });
      }
    );
  });
}

function writeJobFile(t, text) {
  const dir = mkdtempSync(join(tmpdir(), "qa-r5-job-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const p = join(dir, "job.json");
  writeFileSync(p, text);
  return p;
}

/** Minimal clean git checkout (no node_modules at all). */
function makeBareCheckout(t) {
  const dir = mkdtempSync(join(tmpdir(), "qa-r5-bare-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "package.json"), '{"name":"bare"}\n');
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.email=fixture@example.invalid", "-c", "user.name=fixture", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture"]);
  assert.equal(git(dir, ["status", "--porcelain"]), "", "fixture checkout is clean");
  return { dir, head: git(dir, ["rev-parse", "HEAD"]).trim() };
}

/**
 * Preload that performs a filesystem swap at a chosen synchronization
 * point inside the CLI's output installation:
 *   mode "dir-open"   — when the CLI opens the destination directory
 *                       itself (the Q665-002A.2 window): rename the dir
 *                       aside and replace it with a symlink to `swapTo`.
 *   mode "parent-open"— when the CLI opens the destination directory:
 *                       rename the directory's PARENT aside and replace
 *                       it with a symlink to `swapTo` (ancestor swap).
 *   mode "temp-open"  — when the CLI creates the temp file through the
 *                       anchored handle (/proc/self/fd/*.tmp): swap the
 *                       destination directory then (must NOT redirect
 *                       the handle-relative rename).
 */
function writeSwapPreload(t, { dir, swapTo, mode }) {
  const p = join(mkdtempSync(join(tmpdir(), "qa-r5-pre-")), "preload.cjs");
  t.after(() => rmSync(join(p, ".."), { recursive: true, force: true }));
  writeFileSync(
    p,
    `const fs = require("node:fs");
const { O_DIRECTORY, O_NOFOLLOW } = require("node:constants");
const { syncBuiltinESMExports } = require("node:module");
const DEST = ${JSON.stringify(dir)};
const SWAPTO = ${JSON.stringify(swapTo)};
const MODE = ${JSON.stringify(mode)};
const orig = fs.openSync;
let fired = false;
fs.openSync = function (p, flags, modeArg) {
  if (!fired && typeof p === "string") {
    const isDirOpen = p === DEST && typeof flags === "number" && (flags & O_DIRECTORY) && (flags & O_NOFOLLOW);
    const isTempOpen = p.startsWith("/proc/self/fd/") && p.endsWith(".tmp");
    if ((MODE === "dir-open" && isDirOpen) || (MODE === "temp-open" && isTempOpen)) {
      fired = true;
      fs.renameSync(DEST, DEST + ".old");
      fs.symlinkSync(SWAPTO, DEST, "dir");
    } else if (MODE === "parent-open" && isDirOpen) {
      fired = true;
      const parent = require("node:path").dirname(DEST);
      fs.renameSync(parent, parent + ".old");
      fs.symlinkSync(SWAPTO, parent, "dir");
    }
  }
  return orig.call(this, p, flags, modeArg);
};
syncBuiltinESMExports();
`
  );
  return p;
}

function jobFor(fx) {
  return JSON.stringify({ target: fx.dir, head_pin: fx.head, suites: [{ id: "one", patterns: ["x"] }] });
}

describe("Q665-002A.2: output-directory swaps cannot redirect the write into the checkout", () => {
  it("reviewer race: directory swapped for a checkout symlink between validation and temp creation refuses the write", async (t) => {
    const fx = makeBareCheckout(t);
    const ext = mkdtempSync(join(tmpdir(), "qa-r5-race-"));
    t.after(() => rmSync(ext, { recursive: true, force: true }));
    const destDir = join(ext, "out");
    mkdirSync(destDir);
    const dest = join(destDir, "package.json");
    const before = readFileSync(join(fx.dir, "package.json"), "utf8");
    const preload = writeSwapPreload(t, { dir: destDir, swapTo: fx.dir, mode: "dir-open" });
    const jobPath = writeJobFile(t, jobFor(fx));
    const r = await runCli([jobPath, "--out", dest], ["--require", preload]);
    assert.equal(r.code, 2, "write refusal exits 2");
    assert.match(r.stderr, /cannot write --out/, "write refusal reported");
    assert.match(r.stderr, /cannot anchor output directory/, "refusal names the anchor failure");
    assert.equal(readFileSync(join(fx.dir, "package.json"), "utf8"), before, "checkout package.json byte-identical");
    assert.equal(git(fx.dir, ["status", "--porcelain"]), "", "git status still clean");
  });

  it("reviewer race via --markdown-out: same swap refuses the write", async (t) => {
    const fx = makeBareCheckout(t);
    const ext = mkdtempSync(join(tmpdir(), "qa-r5-racemd-"));
    t.after(() => rmSync(ext, { recursive: true, force: true }));
    const destDir = join(ext, "out");
    mkdirSync(destDir);
    const dest = join(destDir, "report.md");
    const before = readFileSync(join(fx.dir, "package.json"), "utf8");
    const preload = writeSwapPreload(t, { dir: destDir, swapTo: fx.dir, mode: "dir-open" });
    const jobPath = writeJobFile(t, jobFor(fx));
    const r = await runCli([jobPath, "--markdown-out", dest], ["--require", preload]);
    assert.equal(r.code, 2, "write refusal exits 2");
    assert.match(r.stderr, /cannot write --markdown-out/, "write refusal reported");
    assert.equal(readFileSync(join(fx.dir, "package.json"), "utf8"), before, "checkout package.json byte-identical");
    assert.equal(git(fx.dir, ["status", "--porcelain"]), "", "git status still clean");
  });

  it("ancestor swap: parent replaced by a checkout symlink refuses via the identity check", async (t) => {
    const fx = makeBareCheckout(t);
    // The checkout contains a real "out" directory so the swapped open
    // succeeds and the failure must come from the identity check.
    mkdirSync(join(fx.dir, "out"));
    writeFileSync(join(fx.dir, "out", "marker.txt"), "marker\n");
    const ext = mkdtempSync(join(tmpdir(), "qa-r5-anc-"));
    t.after(() => rmSync(ext, { recursive: true, force: true }));
    const destDir = join(ext, "out");
    mkdirSync(destDir);
    const dest = join(destDir, "report.json");
    const before = readFileSync(join(fx.dir, "package.json"), "utf8");
    const preload = writeSwapPreload(t, { dir: destDir, swapTo: fx.dir, mode: "parent-open" });
    const jobPath = writeJobFile(t, jobFor(fx));
    const r = await runCli([jobPath, "--out", dest], ["--require", preload]);
    assert.equal(r.code, 2, "write refusal exits 2");
    assert.match(r.stderr, /cannot write --out/, "write refusal reported");
    assert.match(r.stderr, /identity changed/, "refusal names the identity mismatch");
    assert.equal(readFileSync(join(fx.dir, "package.json"), "utf8"), before, "checkout package.json byte-identical");
    assert.deepEqual(
      readdirSync(join(fx.dir, "out")).sort(),
      ["marker.txt"],
      "no report or temp files landed in the checkout"
    );
  });

  it("swap after temp creation: handle-relative rename still lands in the anchored directory", async (t) => {
    const fx = makeBareCheckout(t);
    const ext = mkdtempSync(join(tmpdir(), "qa-r5-mid-"));
    t.after(() => rmSync(ext, { recursive: true, force: true }));
    const destDir = join(ext, "out");
    mkdirSync(destDir);
    const dest = join(destDir, "report.json");
    const before = readFileSync(join(fx.dir, "package.json"), "utf8");
    const preload = writeSwapPreload(t, { dir: destDir, swapTo: fx.dir, mode: "temp-open" });
    const jobPath = writeJobFile(t, jobFor(fx));
    const r = await runCli([jobPath, "--out", dest], ["--require", preload]);
    // The write itself must succeed: it is anchored to the handle opened
    // before the swap. (The job outcome is REFUSED/ISOLATION_UNAVAILABLE
    // in this sandbox, so exit is 1, not 0 — but there is no write error.)
    assert.doesNotMatch(r.stderr, /cannot write --out/, "no write refusal: the handle anchored the write");
    const landed = join(destDir + ".old", "report.json");
    assert.ok(existsSync(landed), "report landed in the anchored (renamed) directory");
    assert.equal(JSON.parse(readFileSync(landed, "utf8")).agent, "qa-test-runner");
    assert.equal(readFileSync(join(fx.dir, "package.json"), "utf8"), before, "checkout package.json byte-identical");
    assert.equal(git(fx.dir, ["status", "--porcelain"]), "", "git status still clean");
  });

  it("static symlink destination directory is refused before any write", async (t) => {
    const fx = makeBareCheckout(t);
    const ext = mkdtempSync(join(tmpdir(), "qa-r5-sym-"));
    t.after(() => rmSync(ext, { recursive: true, force: true }));
    const linkDir = join(ext, "outlink");
    symlinkSync(fx.dir, linkDir, "dir");
    const before = readFileSync(join(fx.dir, "package.json"), "utf8");
    const jobPath = writeJobFile(t, jobFor(fx));
    const r = await runCli([jobPath, "--out", join(linkDir, "report.json")]);
    assert.equal(r.code, 2, "containment refusal exits 2");
    assert.match(r.stderr, /refusing to write into the evidenced tree/, "refusal reported");
    assert.equal(readFileSync(join(fx.dir, "package.json"), "utf8"), before, "checkout package.json byte-identical");
    assert.equal(git(fx.dir, ["status", "--porcelain"]), "", "git status still clean");
    assert.ok(!existsSync(join(fx.dir, "report.json")), "no report file created in the checkout");
  });

  it("ordinary external overwrite still works for --out and --markdown-out", async (t) => {
    const fx = makeBareCheckout(t);
    const ext = mkdtempSync(join(tmpdir(), "qa-r5-ok-"));
    t.after(() => rmSync(ext, { recursive: true, force: true }));
    const jsonDest = join(ext, "report.json");
    const mdDest = join(ext, "report.md");
    writeFileSync(jsonDest, '{"stale":true}\n');
    const jobPath = writeJobFile(t, jobFor(fx));
    const r = await runCli([jobPath, "--out", jsonDest, "--markdown-out", mdDest]);
    assert.doesNotMatch(r.stderr, /cannot write/, "no write refusal");
    assert.equal(JSON.parse(readFileSync(jsonDest, "utf8")).agent, "qa-test-runner", "report JSON produced");
    assert.match(readFileSync(mdDest, "utf8"), /test-runner report/i, "markdown report produced");
    const before = '{"name":"bare"}\n';
    assert.equal(readFileSync(join(fx.dir, "package.json"), "utf8"), before, "checkout package.json byte-identical");
    assert.equal(git(fx.dir, ["status", "--porcelain"]), "", "git status still clean");
  });
});
