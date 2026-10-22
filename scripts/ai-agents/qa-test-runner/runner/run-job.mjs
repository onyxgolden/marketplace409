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

import { closeSync, fstatSync, openSync, readSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
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

  const report = await runJob(job);
  let exitCode = report.verdict === "ALL_SUITES_PASS" ? 0 : 1;

  // Bounded final output: the report's own byte budget (extraction is
  // capped upstream; this is the last-line guard). An over-limit
  // report is replaced by a small named OUTPUT_LIMIT refusal rather
  // than streamed unboundedly — and the same bounded body is what
  // --out receives, so stdout and file can never disagree.
  let finalReport = report;
  let text = canonicalJson(report);
  const reportLimit =
    job && typeof job === "object" && job.budgets && Number.isInteger(job.budgets.max_report_bytes)
      ? Math.min(job.budgets.max_report_bytes, BUDGET_LIMITS.maxReportBytes)
      : BUDGET_LIMITS.maxReportBytes;
  if (Buffer.byteLength(text, "utf8") > reportLimit) {
    finalReport = refusalShell("OUTPUT_LIMIT", [
      { code: "OUTPUT_LIMIT", path: "$", message: `serialized report exceeds the ${reportLimit}-byte report budget; the full report was not emitted` },
    ]);
    text = canonicalJson(finalReport);
    exitCode = 1;
  }

  // Output containment: report files may not land inside the target
  // checkout — the runner never writes into the tree it evidences.
  const out = argValue("--out");
  const mdOut = argValue("--markdown-out");
  const targetAbs = typeof job?.target === "string" ? resolve(job.target) : null;
  const insideTarget = (p) => {
    if (!targetAbs) return false;
    const rp = resolve(p);
    return rp === targetAbs || rp.startsWith(targetAbs + sep);
  };
  const writes = [];
  if (out) writes.push(["--out", out, text + "\n"]);
  if (mdOut) writes.push(["--markdown-out", mdOut, reportToMarkdown(finalReport) + "\n"]);
  for (const [flag, path, content] of writes) {
    if (insideTarget(path)) {
      console.error(`[runner] ${flag} path ${path} is inside the target checkout; refusing to write into the evidenced tree`);
      exitCode = 2;
      continue;
    }
    try {
      writeFileSync(path, content);
    } catch (e) {
      console.error(`[runner] cannot write ${flag} file ${path}: ${e.message}`);
      exitCode = 2;
    }
  }

  await writeStdout(text + "\n");
  process.exitCode = exitCode;
}

await main();
