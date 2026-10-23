#!/usr/bin/env node
/**
 * run-job.mjs — CLI for the QA test-runner.
 *
 * Usage:
 *   node runner/run-job.mjs <job.json> [--out <report.json>] [--markdown-out <report.md>]
 *
 * Prints the canonical report JSON to stdout. Exit code is 0 only when
 * the advisory verdict is ALL_SUITES_PASS; 1 for any other job outcome
 * (including refusals); 2 for usage / unreadable job file / output
 * write errors.
 *
 * Discipline:
 *   - The job file's size is checked (fstat) BEFORE it is read, and
 *     the read itself is bounded: an oversized file is refused with a
 *     named INPUT_LIMIT report, never parsed unboundedly.
 *   - stdout is written via an awaited, drained write and the exit
 *     status is staged with process.exitCode — process.exit() is never
 *     called after output, so a piped consumer always receives the
 *     complete canonical JSON (a large report used to be truncated at
 *     the pipe buffer when process.exit raced the drain).
 *   - --out / --markdown-out may not name a path inside the job's
 *     target checkout (containment): the runner never writes into the
 *     tree it is evidencing. File-write failures are reported on
 *     stderr with exit code 2.
 */

import { closeSync, fstatSync, fsyncSync, lstatSync, openSync, readlinkSync, realpathSync, readSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { runJob, canonicalJson, reportToMarkdown, BUDGET_LIMITS } from "../src/index.js";

const MAX_JOB_FILE_BYTES = BUDGET_LIMITS.maxJobBytes;

function refusalShell(reasonCode, diagnostics) {
  return {
    schema_version: "1",
    agent: "qa-test-runner",
    advisory: true,
    job_id: null,
    target: null,
    head_pin: null,
    checkout_head: null,
    status: "REFUSED",
    verdict: "REFUSED",
    reason_code: reasonCode,
    diagnostics,
    isolation: null,
    suites: [],
    totals: {
      suites_total: 0,
      suites_passed: 0,
      suites_failed: 0,
      suites_error: 0,
      suites_timeout: 0,
      suites_skipped_budget: 0,
      tests_total: 0,
      tests_passed: 0,
      tests_failed: 0,
      tests_pending: 0,
    },
  };
}

/** Write the full text to stdout and wait until it has drained. */
function writeStdout(text) {
  return new Promise((resolveWrite) => {
    process.stdout.write(text, () => resolveWrite());
  });
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

async function main() {
  const jobPath = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
  if (!jobPath) {
    console.error("usage: node runner/run-job.mjs <job.json> [--out <report.json>] [--markdown-out <report.md>]");
    process.exitCode = 2;
    return;
  }

  // Bounded read: size first (fstat), then at most cap+1 bytes.
  let raw;
  let fd;
  try {
    fd = openSync(jobPath, "r");
    const size = fstatSync(fd).size;
    if (size > MAX_JOB_FILE_BYTES) {
      const report = refusalShell("INPUT_LIMIT", [
        { code: "INPUT_LIMIT", path: "$", message: `job file is ${size} bytes, over the ${MAX_JOB_FILE_BYTES}-byte input limit; not read or parsed` },
      ]);
      await writeStdout(canonicalJson(report) + "\n");
      process.exitCode = 1;
      return;
    }
    const buf = Buffer.alloc(size);
    let off = 0;
    while (off < size) {
      const n = readSync(fd, buf, off, size - off, off);
      if (n <= 0) break;
      off += n;
    }
    raw = buf.toString("utf8", 0, off);
  } catch (e) {
    console.error(`[runner] cannot read job file ${jobPath}: ${e.message}`);
    process.exitCode = 2;
    return;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }

  let job;
  try {
    job = JSON.parse(raw);
  } catch (e) {
    const report = refusalShell("INVALID_JOB", [
      { code: "INVALID_JOB", path: "$", message: `job file is not valid JSON: ${e.message}` },
    ]);
    await writeStdout(canonicalJson(report) + "\n");
    process.exitCode = 1;
    return;
  }

  // Q665-002A: output containment is validated BEFORE the job
  // executes — never after the write already happened. A refused
  // destination is reported on stderr with exit code 2 and never
  // written; the run still proceeds so stdout carries the report.
  const out = argValue("--out");
  const mdOut = argValue("--markdown-out");
  const refusedWrites = new Set();
  for (const [flag, path] of [["--out", out], ["--markdown-out", mdOut]]) {
    if (!path) continue;
    const why = containmentRefusal(job, path);
    if (why) {
      console.error(`[runner] ${flag} ${why}; refusing to write into the evidenced tree`);
      refusedWrites.add(flag);
    }
  }
  let preExit = refusedWrites.size > 0 ? 2 : 0;

  const report = await runJob(job);
  let exitCode = report.verdict === "ALL_SUITES_PASS" ? 0 : 1;
  if (preExit === 2) exitCode = 2;

  // Q665-005A: the final-envelope byte bound is enforced CENTRALLY by
  // runJob (report-bounds.js) against the admitted max_report_bytes —
  // this CLI no longer owns a separate enforcement with different
  // semantics. What remains is a defensive assert: the centrally
  // bounded report always fits the admitted budget (hence the hard
  // cap); if it somehow does not, emit the named OUTPUT_LIMIT refusal
  // rather than streaming unboundedly.
  let finalReport = report;
  let text = canonicalJson(report);
  if (Buffer.byteLength(text, "utf8") > BUDGET_LIMITS.maxReportBytes) {
    finalReport = refusalShell("OUTPUT_LIMIT", [
      { code: "OUTPUT_LIMIT", path: "$", message: `serialized report exceeds the ${BUDGET_LIMITS.maxReportBytes}-byte report budget; the full report was not emitted` },
    ]);
    text = canonicalJson(finalReport);
    exitCode = 1;
  }

  // Output containment (Q665-002A): report files may not land inside
  // the target checkout — the runner never writes into the tree it
  // evidences. Destinations were validated canonically BEFORE the run
  // (see above); this loop only performs the writes that passed.
  const writes = [];
  if (out && !refusedWrites.has("--out")) writes.push(["--out", out, text + "\n"]);
  if (mdOut && !refusedWrites.has("--markdown-out")) writes.push(["--markdown-out", mdOut, reportToMarkdown(finalReport) + "\n"]);
  for (const [flag, path, content] of writes) {
    try {
      // Q665-002A.1: never truncate an existing destination inode.
      installOutputFile(job, path, content);
    } catch (e) {
      console.error(`[runner] cannot write ${flag} file ${path}: ${e.message}`);
      exitCode = 2;
    }
  }

  await writeStdout(text + "\n");
  process.exitCode = exitCode;
}

/**
 * Canonicalize a destination path: resolve symlinks through every
 * existing ancestor AND through the leaf itself — including DANGLING
 * links (readlink does not require the target to exist), which
 * existsSync/realpath would silently skip, letting a dangling
 * destination link launder a write into the target. The non-existent
 * tail stays lexical. Returns null when no ancestor exists to resolve
 * against. Loop-bounded; a symlink loop simply stops resolving (the
 * subsequent write would fail ELOOP anyway).
 */
function canonicalDest(p) {
  let abs = resolve(p);
  for (let i = 0; i < 32; i++) {
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      break;
    }
    if (!st.isSymbolicLink()) break;
    abs = resolve(dirname(abs), readlinkSync(abs));
  }
  let dir = abs;
  const tail = [];
  for (let i = 0; i < 64; i++) {
    let st;
    try {
      st = lstatSync(dir);
    } catch {
      st = null;
    }
    if (st && st.isSymbolicLink()) {
      dir = resolve(dirname(dir), readlinkSync(dir));
      continue;
    }
    if (st) break;
    const parent = dirname(dir);
    if (parent === dir) return null;
    tail.unshift(basename(dir));
    dir = parent;
  }
  let real;
  try {
    real = realpathSync(dir);
  } catch {
    return null;
  }
  return join(real, ...tail);
}

/**
 * Containment refusal reason for a report destination, or null when
 * the destination is allowed. The destination is refused when its
 * canonical form lies inside the job target's canonical form (an
 * alias directory, ancestor alias, or existing destination link
 * pointing into the target is caught); a pure-lexical check runs as a
 * second net for targets that cannot be canonicalized.
 */
function containmentRefusal(job, destPath) {
  const target = job && typeof job === "object" && typeof job.target === "string" ? job.target : null;
  if (!target) return null;
  const targetAbs = resolve(target);
  let targetCanon = null;
  try {
    targetCanon = realpathSync(targetAbs);
  } catch {
    targetCanon = null;
  }
  const canon = canonicalDest(destPath);
  const anchor = targetCanon ?? targetAbs;
  if (canon && (canon === anchor || canon.startsWith(anchor + sep))) {
    return `path ${destPath} canonicalizes inside the target checkout (${canon})`;
  }
  const lex = resolve(destPath);
  if (lex === targetAbs || lex.startsWith(targetAbs + sep)) {
    return `path ${destPath} is inside the target checkout`;
  }
  return null;
}

let installSeq = 0;

/**
 * Install one output file without ever truncating an existing
 * destination inode (Q665-002A.1).
 *
 * Canonical paths resolve symbolic links but NOT hard-link identity,
 * so a destination that is a hard link to a file inside the evidenced
 * checkout passes containment and a plain writeFileSync then mutates
 * the checkout in place through the shared inode (the reviewer probe
 * overwrote the checkout's tracked package.json exactly this way).
 *
 * Instead the content is written to a no-follow temporary file in the
 * canonical destination directory and atomically renamed over the
 * destination: the old directory entry — and any inode it shared —
 * is replaced, never truncated, so the checkout's bytes and Git
 * status cannot change through an output path.
 *
 * Containment is re-checked at write time (validation-to-write
 * TOCTOU): a destination that now canonicalizes inside the target is
 * refused with a thrown error, which the caller reports as exit 2.
 * The destination directory must be an existing real directory; leaf
 * symlinks are installed through their canonical target, exactly the
 * location the containment check validated.
 */
function installOutputFile(job, destPath, content) {
  const why = containmentRefusal(job, destPath);
  if (why) throw new Error(`refusing write into the evidenced tree: ${why}`);
  const canon = canonicalDest(destPath);
  if (!canon) throw new Error(`refusing write: cannot canonicalize destination ${destPath}`);
  const dir = dirname(canon);
  let dirStat;
  try {
    dirStat = statSync(dir);
  } catch (e) {
    throw new Error(`refusing write: destination directory ${dir} is not usable: ${e.message}`);
  }
  if (!dirStat.isDirectory()) {
    throw new Error(`refusing write: destination directory ${dir} is not a directory`);
  }
  const buf = Buffer.from(content, "utf8");
  let lastErr = null;
  for (let attempt = 0; attempt < 100; attempt++) {
    const tmp = join(dir, `.qa-runner-out-${process.pid}-${installSeq++}.tmp`);
    let fd;
    try {
      fd = openSync(tmp, "wx", 0o600);
    } catch (e) {
      if (e && e.code === "EEXIST") {
        lastErr = e;
        continue;
      }
      throw new Error(`cannot create temp output file in ${dir}: ${e.message}`);
    }
    try {
      writeSync(fd, buf, 0, buf.length, null);
      fsyncSync(fd);
      closeSync(fd);
      renameSync(tmp, canon);
      return;
    } catch (e) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
      try {
        unlinkSync(tmp);
      } catch {
        /* best effort */
      }
      throw new Error(`cannot install output file ${destPath}: ${e.message}`);
    }
  }
  throw new Error(`cannot create temp output file in ${dir}: ${lastErr ? lastErr.message : "attempts exhausted"}`);
}

await main();
