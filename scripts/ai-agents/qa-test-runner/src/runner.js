/**
 * runner.js — runJob(job, options): the QA test-runner's core.
 *
 * Order of operations is the contract:
 *   1. Validate the job and CHARGE all budgets (schemas.js; admission
 *      in admit.js). An over-budget or malformed job is REFUSED before
 *      anything runs.
 *   2. Verify the operator checkout: HEAD must equal the job's 40-hex
 *      pin exactly AND the working tree must be clean (no modified,
 *      staged or untracked files). A mismatch is REFUSED / HEAD_MISMATCH,
 *      a dirty tree REFUSED / TARGET_NOT_CLEAN — NOTHING executes, and
 *      the operator's checkout is never modified or cleaned by us.
 *      A GO at head X never blesses head Y — or X's dirty bytes.
 *   3. Materialize the execution tree from the pinned commit object
 *      itself (`git archive <pin>`), into a disposable directory
 *      outside the checkout. What executes is the pin's bytes, not
 *      whatever the working tree happens to hold. The checkout's
 *      installed `node_modules` (a dependency of the environment, not
 *      evidence content) is copied into the disposable tree; vitest
 *      cache/report/temp files all live there or in the job scratch
 *      dir, never in the operator checkout.
 *   4. Execute suites sequentially inside the isolation boundary
 *      (isolation.js): network denied by namespace, environment
 *      scrubbed to an allowlist, descendants contained by a pid
 *      namespace, and a supervisor deadline that settles kills
 *      independently of inherited-pipe close. If the host cannot
 *      provide the isolation policy, the job is REFUSED /
 *      ISOLATION_UNAVAILABLE — the policy is never silently claimed.
 *   5. Revalidate the operator checkout after the run (HEAD + clean
 *      tree, byte-identical snapshot). If it changed mid-run, the
 *      report is marked CHECKOUT_CHANGED_DURING_RUN and cannot carry
 *      ALL_SUITES_PASS.
 *   6. Classify each suite from its exit code + parsed JSON report
 *      (reporter bytes charged against the reporter budget BEFORE the
 *      file is read) and emit the deterministic advisory report.
 *
 * If vitest is not resolvable in the execution tree (no
 * node_modules/.bin/vitest), the suite is ERROR — never skipped, never
 * passed, and npx is never allowed to fetch it from the network.
 */

import { spawn, execFile } from "node:child_process";
import { existsSync, statSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateJob, suiteTimeoutMs } from "./schemas.js";
import { parseVitestJson, classifySuiteResult } from "./classify.js";
import { refusalReport, completedReport, emptySuiteEntry } from "./report.js";
import { detectIsolation, buildIsolatedSpawn, scrubbedEnv } from "./isolation.js";

const MAX_MATERIALIZED_BYTES = 512 * 1024 * 1024;
const MAX_STATUS_BYTES = 4 * 1024 * 1024;

/** Resolve a checkout's HEAD via git. Returns the 40-hex string or null. */
export function resolveHead(target) {
  return new Promise((resolve) => {
    execFile("git", ["-C", target, "rev-parse", "HEAD"], { timeout: 15_000 }, (err, stdout) => {
      if (err) return resolve(null);
      const head = String(stdout).trim();
      resolve(/^[0-9a-f]{40}$/.test(head) ? head : null);
    });
  });
}

/**
 * Working-tree snapshot: `git status --porcelain` output ("" when the
 * tree is clean), or null when it cannot be read within the byte bound.
 * Porcelain lists modified, staged and untracked entries; ignored
 * files (node_modules) are not listed.
 */
export function snapshotWorkingTree(target) {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", target, "status", "--porcelain"],
      { timeout: 30_000, maxBuffer: MAX_STATUS_BYTES },
      (err, stdout) => {
        if (err) return resolve(null);
        resolve(String(stdout));
      }
    );
  });
}

/** Vitest is resolvable only as an installed local binary. */
export function vitestResolvable(dir) {
  const bin = process.platform === "win32" ? "vitest.cmd" : "vitest";
  return existsSync(join(dir, "node_modules", ".bin", bin));
}

/**
 * Materialize the pinned commit's tree into destDir via `git archive`.
 * The archive byte stream is counted as it flows; past the cap both
 * processes are killed and materialization fails. Returns null on
 * success or an error string.
 */
function materializePinnedTree(target, pin, destDir) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (msg) => {
      if (!settled) {
        settled = true;
        resolve(msg);
      }
    };
    let archive;
    let tar;
    try {
      archive = spawn("git", ["-C", target, "archive", "--format=tar", pin], { stdio: ["ignore", "pipe", "pipe"] });
      tar = spawn("tar", ["-x", "-C", destDir], { stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      done(`could not spawn materialization: ${e?.message ?? e}`);
      return;
    }
    // A dead tar makes writes to its stdin raise EPIPE asynchronously;
    // that is a materialization failure, never an unhandled error.
    tar.stdin.on("error", (e) => done(`tar extraction failed: ${e?.message ?? e}`));
    archive.stdout.on("error", (e) => done(`git archive failed: ${e?.message ?? e}`));
    // Drain both stderr streams (discarding) so a chatty child can
    // never block on a full pipe and hang materialization.
    archive.stderr?.on("data", () => {});
    tar.stderr?.on("data", () => {});
    let bytes = 0;
    let overflow = false;
    archive.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_MATERIALIZED_BYTES && !overflow) {
        overflow = true;
        archive.kill("SIGKILL");
        tar.kill("SIGKILL");
        done(`pinned tree exceeds ${MAX_MATERIALIZED_BYTES} materialized bytes`);
        return;
      }
      if (!overflow) tar.stdin.write(chunk);
    });
    archive.stdout.on("end", () => {
      try {
        tar.stdin.end();
      } catch {
        /* tar already gone */
      }
    });
    archive.on("error", (e) => done(`git archive failed: ${e?.message ?? e}`));
    tar.on("error", (e) => done(`tar extraction failed: ${e?.message ?? e}`));
    let archiveCode = null;
    let tarCode = null;
    const maybeDone = () => {
      if (archiveCode === null || tarCode === null || settled) return;
      if (overflow) return;
      if (archiveCode !== 0) done(`git archive exited ${archiveCode}`);
      else if (tarCode !== 0) done(`tar extraction exited ${tarCode}`);
      else done(null);
    };
    archive.on("close", (code) => {
      archiveCode = code ?? -1;
      maybeDone();
    });
    tar.on("close", (code) => {
      tarCode = code ?? -1;
      maybeDone();
    });
  });
}

/**
 * Copy the operator checkout's installed node_modules into the
 * disposable execution tree. Dependencies are environment, not
 * evidence: the suites' SOURCE all comes from the pinned commit; the
 * dependency tree is what the operator already installed for that pin.
 *
 * Ownership is deliberately NOT preserved (--no-preserve=ownership):
 * it is meaningless inside a disposable tree, and on filesystems that
 * refuse chown a plain `cp -a` emits one warning per file — enough
 * stderr to overflow a naive capture buffer on a real dependency tree
 * (found by the PR #665 exact-head receipt run). stderr is drained
 * into a capped tail buffer, never a maxBuffer kill.
 */
function overlayNodeModules(target, destDir) {
  const src = join(target, "node_modules");
  if (!existsSync(src)) return Promise.resolve(null);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("cp", ["-a", "--no-preserve=ownership", src, join(destDir, "node_modules")], {
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (e) {
      resolve(`node_modules overlay failed: ${e?.message ?? e}`);
      return;
    }
    let tail = "";
    child.stderr?.on("data", (d) => {
      tail = (tail + d.toString("utf8")).slice(-4096);
    });
    const killer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, 600_000);
    child.on("error", (e) => {
      clearTimeout(killer);
      resolve(`node_modules overlay failed: ${e?.message ?? e}`);
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      if (code === 0) resolve(null);
      else resolve(`node_modules overlay exited ${code}: ${tail.trim().split("\n").slice(-3).join("; ")}`);
    });
  });
}

const KILL_GRACE_MS = 2_000;
const KILL_VERIFY_MS = 250;
const HARD_SETTLE_SLACK_MS = 1_000;

/** Supervisor settle bound: deadline + kill grace + verify, always. */
export function settleBoundMs(timeoutMs) {
  return timeoutMs + KILL_GRACE_MS + KILL_VERIFY_MS + HARD_SETTLE_SLACK_MS;
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  // A zombie is dead but still answers kill(pid, 0) until reaped.
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const state = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0];
    if (state === "Z" || state === "X") return false;
  } catch {
    /* no /proc on this host — kill() answer stands */
  }
  return true;
}

function killGroup(child, sig) {
  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, sig);
      return;
    }
    child.kill(sig);
  } catch {
    try {
      child.kill(sig);
    } catch {
      /* already gone */
    }
  }
}

/**
 * Run one suite process under the isolation boundary with a supervisor
 * deadline. The returned promise settles on child close — OR, once a
 * kill is in flight (timeout / output cap), on the supervisor's own
 * schedule: SIGTERM at the deadline, SIGKILL after the grace, settle
 * after a liveness verify — whether or not an escaped descendant is
 * still holding the inherited output pipes open. Descendants are
 * contained by the pid namespace (isolation.js), so killing the
 * boundary process collapses the whole tree; `cleanupFailed` reports
 * honestly when the boundary process is still alive after SIGKILL.
 */
function runSuiteProcess({ mechanism, execDir, scratchDir, originalTarget, suite, timeoutMs, maxCapturedBytes, outFile }) {
  return new Promise((resolve) => {
    const argv = ["npx", "vitest", "run", ...suite.patterns, "--reporter=json", "--outputFile", outFile];
    const spec = buildIsolatedSpawn(mechanism, { execDir, scratchDir, originalTarget, argv });
    let child;
    try {
      child = spawn(spec.command, spec.args, {
        cwd: execDir,
        shell: false,
        // Own process group: the kill must reach the isolation boundary
        // (and, through its pid namespace, everything inside it).
        detached: process.platform !== "win32",
        env: scrubbedEnv(scratchDir),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      resolve({ exitCode: null, signal: null, timedOut: false, outputExceeded: false, spawnError: String(e?.message ?? e), cleanupFailed: false });
      return;
    }

    let settled = false;
    let timedOut = false;
    let outputExceeded = false;
    let spawnError = null;
    let exitCode = null;
    let exitSignal = null;
    let captured = 0;
    const timers = [];
    const later = (ms, fn) => {
      const t = setTimeout(fn, ms);
      timers.push(t);
      return t;
    };
    const settle = () => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      try {
        child.stdout?.destroy();
      } catch { /* ignore */ }
      try {
        child.stderr?.destroy();
      } catch { /* ignore */ }
      const cleanupFailed = (timedOut || outputExceeded) && pidAlive(child.pid);
      resolve({ exitCode, signal: exitSignal, timedOut, outputExceeded, spawnError, cleanupFailed });
    };
    const beginKill = (sig) => {
      killGroup(child, sig);
      later(KILL_GRACE_MS, () => killGroup(child, "SIGKILL"));
      later(KILL_GRACE_MS + KILL_VERIFY_MS, settle);
    };

    later(timeoutMs, () => {
      if (settled) return;
      timedOut = true;
      beginKill("SIGTERM");
    });
    // Absolute supervisor bound: even if every other path stalls, the
    // promise settles here. Cleanup/grace live INSIDE the job budget
    // accounting (the caller's wall clock charges actual elapsed).
    later(settleBoundMs(timeoutMs), settle);

    const onData = (chunk) => {
      captured += chunk.length;
      if (captured > maxCapturedBytes && !outputExceeded && !settled) {
        outputExceeded = true;
        try {
          child.stdout?.destroy();
        } catch { /* ignore */ }
        try {
          child.stderr?.destroy();
        } catch { /* ignore */ }
        killGroup(child, "SIGKILL");
        later(KILL_VERIFY_MS + HARD_SETTLE_SLACK_MS, settle);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (e) => {
      spawnError = String(e?.message ?? e);
      settle();
    });
    child.on("close", (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      // On a kill path, close only means the boundary process died;
      // the supervisor still verifies liveness before settling.
      if (!timedOut && !outputExceeded) settle();
    });
  });
}

async function executeSuite({ execDir, scratchDir, originalTarget, mechanism, suite, timeoutMs, budgets, index }) {
  const base = {
    id: suite.id,
    patterns: [...suite.patterns],
    timeout_ms: timeoutMs,
    exit_code: null,
    signal: null,
    reason_code: null,
    reason: null,
    test_counts: { total: 0, passed: 0, failed: 0, pending: 0 },
    failing_tests: [],
    failing_tests_total: 0,
    failing_tests_truncated: false,
    cleanup_failed: false,
  };
  if (!vitestResolvable(execDir)) {
    return {
      ...base,
      status: "ERROR",
      reason_code: "VITEST_NOT_RESOLVABLE",
      reason: "vitest is not resolvable in the execution tree (node_modules/.bin/vitest missing); suite not run and never counted as a pass",
    };
  }
  const safeId = suite.id.replace(/[^a-zA-Z0-9._-]/g, "_");
  const outFile = join(scratchDir, "reports", `suite-${index}-${safeId}.json`);
  const raw = await runSuiteProcess({
    mechanism,
    execDir,
    scratchDir,
    originalTarget,
    suite,
    timeoutMs,
    maxCapturedBytes: budgets.maxCapturedBytesPerSuite,
    outFile,
  });
  // Reporter bytes are charged BEFORE the file is read or parsed:
  // stat first, refuse over-budget files unread.
  let json = null;
  let reporterExceeded = false;
  try {
    const st = statSync(outFile);
    if (st.isFile()) {
      if (st.size > budgets.maxReporterBytesPerSuite) reporterExceeded = true;
      else json = parseVitestJson(readFileSync(outFile, "utf8"));
    }
  } catch {
    json = null;
  }
  const cls = classifySuiteResult({ ...raw, json, reporterExceeded });
  const entry = {
    ...base,
    status: cls.status,
    exit_code: raw.exitCode,
    signal: raw.signal,
    reason_code: cls.reason_code,
    reason: cls.reason,
    test_counts: cls.test_counts,
    failing_tests: cls.failing_tests,
    failing_tests_total: cls.failing_tests_total,
    failing_tests_truncated: cls.failing_tests_truncated,
    cleanup_failed: raw.cleanupFailed === true,
  };
  if (raw.cleanupFailed) {
    // Live work may remain: never let the suite read as a healthy
    // outcome, whatever the classifier made of the partial evidence.
    entry.status = "ERROR";
    entry.reason_code = "CLEANUP_FAILED";
    entry.reason = "the isolation boundary could not be confirmed dead after the kill; contained work may still be running";
  }
  return entry;
}

/**
 * Run a validated job end to end. Always resolves with a report object;
 * refusals are reports, not exceptions.
 * options.tmpRoot: parent directory for the per-job scratch dir
 *   (defaults to os.tmpdir()).
 * options.isolation: force a mechanism ("bwrap" | "unshare" | null) —
 *   a test/embedding seam; the default is host auto-detection, and a
 *   forced null means "no mechanism", i.e. REFUSED, never a fallback
 *   to unisolated execution.
 * options.keepJobTmp: keep the scratch dir after the run (debugging
 *   and test evidence); default false.
 */
export async function runJob(job, options = {}) {
  const v = validateJob(job);
  // Refusals are built ONLY from the admitted (detached) copy. When
  // admission itself refused, v.job is null and the refusal is built
  // from an empty shell — never from the raw, possibly executable
  // input (reading its fields could invoke the very getters admission
  // refused to touch).
  const admitted = v.job ?? {};
  if (!v.ok) {
    if (v.budgetExceeded) {
      return refusalReport(admitted, "BUDGET_EXCEEDED", v.errors);
    }
    return refusalReport(
      admitted,
      "INVALID_JOB",
      v.errors.map((e) => ({ code: e.code, path: e.path, message: e.message }))
    );
  }
  const budgets = v.budgets;
  const spec = v.job;

  const target = spec.target;
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    return refusalReport(spec, "TARGET_NOT_FOUND", [
      { code: "TARGET_NOT_FOUND", path: "$.target", message: `target checkout "${target}" does not exist or is not a directory` },
    ]);
  }

  const head = await resolveHead(target);
  if (head === null) {
    return refusalReport(spec, "HEAD_UNRESOLVABLE", [
      { code: "HEAD_UNRESOLVABLE", path: "$.target", message: "could not resolve HEAD via `git rev-parse HEAD` in the target checkout" },
    ]);
  }
  if (head !== spec.head_pin) {
    return refusalReport(
      spec,
      "HEAD_MISMATCH",
      [
        {
          code: "HEAD_MISMATCH",
          path: "$.head_pin",
          message: `checkout HEAD ${head} does not equal job pin ${spec.head_pin}; nothing executed`,
        },
      ],
      head
    );
  }

  // The pin names a commit; the evidence must be about that commit's
  // bytes. A dirty tree means the checkout does not represent the pin,
  // so refuse — without touching the operator's files.
  const statusBefore = await snapshotWorkingTree(target);
  if (statusBefore === null) {
    return refusalReport(
      spec,
      "TARGET_STATUS_UNREADABLE",
      [{ code: "TARGET_STATUS_UNREADABLE", path: "$.target", message: "could not read the target working-tree status" }],
      head
    );
  }
  if (statusBefore !== "") {
    const lines = statusBefore.split("\n").filter(Boolean).slice(0, 5);
    return refusalReport(
      spec,
      "TARGET_NOT_CLEAN",
      [
        {
          code: "TARGET_NOT_CLEAN",
          path: "$.target",
          message: `target working tree is not clean (${lines.join("; ")}${statusBefore.split("\n").filter(Boolean).length > 5 ? "; …" : ""}); execution binds to the pinned commit's bytes, so modified/staged/untracked content is refused, never cleaned`,
        },
      ],
      head
    );
  }

  const mechanism = options.isolation !== undefined ? options.isolation : detectIsolation();
  if (!mechanism) {
    return refusalReport(
      spec,
      "ISOLATION_UNAVAILABLE",
      [
        {
          code: "ISOLATION_UNAVAILABLE",
          path: "$.target",
          message:
            "this host provides no supported isolation mechanism (bubblewrap or util-linux unshare with user/net/pid namespaces); the runner will not execute suites without network denial, a scrubbed environment and descendant containment",
        },
      ],
      head
    );
  }

  const scratchDir = mkdtempSync(join(options.tmpRoot ?? tmpdir(), "qa-test-runner-"));
  const execDir = join(scratchDir, "exec");
  try {
    mkdirSync(execDir, { recursive: true });
    mkdirSync(join(scratchDir, "reports"), { recursive: true });
    mkdirSync(join(scratchDir, "home"), { recursive: true });
    mkdirSync(join(scratchDir, "tmp"), { recursive: true });

    const materializeError = await materializePinnedTree(target, spec.head_pin, execDir);
    if (materializeError) {
      return refusalReport(
        spec,
        "MATERIALIZATION_FAILED",
        [{ code: "MATERIALIZATION_FAILED", path: "$.target", message: materializeError }],
        head
      );
    }
    const overlayError = await overlayNodeModules(target, execDir);
    if (overlayError) {
      return refusalReport(
        spec,
        "MATERIALIZATION_FAILED",
        [{ code: "MATERIALIZATION_FAILED", path: "$.target", message: overlayError }],
        head
      );
    }

    const entries = [];
    const jobStart = Date.now();
    let jobBudgetExhausted = false;
    for (const [i, suite] of spec.suites.entries()) {
      const elapsed = Date.now() - jobStart;
      const remaining = budgets.perJobTimeoutMs - elapsed;
      if (jobBudgetExhausted || remaining <= 0) {
        jobBudgetExhausted = true;
        entries.push({
          ...emptySuiteEntry(suite, "SKIPPED_BUDGET", "JOB_TIMEOUT_EXHAUSTED", "per-job timeout budget exhausted before this suite started; not executed"),
          timeout_ms: suiteTimeoutMs(spec, suite, budgets),
        });
        continue;
      }
      const timeoutMs = Math.min(suiteTimeoutMs(spec, suite, budgets), remaining);
      entries.push(await executeSuite({ execDir, scratchDir, originalTarget: target, mechanism, suite, timeoutMs, budgets, index: i }));
    }

    const isolation = {
      mechanism,
      network: "denied (namespace)",
      environment: "scrubbed allowlist",
      execution_tree: "disposable copy materialized from the pinned commit (git archive)",
      original_checkout: "untouched",
    };
    const report = completedReport(spec, head, entries, isolation);

    // Post-run revalidation: if the operator checkout moved while the
    // suites ran, the evidence no longer binds cleanly to the pin.
    const headAfter = await resolveHead(target);
    const statusAfter = await snapshotWorkingTree(target);
    if (headAfter !== head || statusAfter !== statusBefore) {
      report.verdict = "SUITES_FAILED";
      report.reason_code = "CHECKOUT_CHANGED_DURING_RUN";
      report.diagnostics = [
        {
          code: "CHECKOUT_CHANGED_DURING_RUN",
          path: "$.target",
          message:
            "the target checkout changed while suites executed (HEAD or working tree differs from the pre-run snapshot); this report cannot bless the pin",
        },
      ];
    }
    return report;
  } finally {
    if (!options.keepJobTmp) {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  }
}

// Re-exported for tests and embedders that probe host capability.
export function isolationAvailable() {
  return detectIsolation() !== null;
}
