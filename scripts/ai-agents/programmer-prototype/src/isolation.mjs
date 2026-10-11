/**
 * isolation.mjs — real OS-enforced isolation adapter (host side).
 *
 * Mechanism (Linux): a Python driver (host/driver.py, no setuid helpers)
 * forks a child that unshares user+mount+net namespaces; the driver, still
 * host-root, writes the child's two-entry uid/gid map (inner 0 -> outer 0
 * for the trusted setup phase, inner 65534 -> outer 65534/nobody for the
 * payload). The child — still pre-exec, therefore holding full namespace
 * capabilities (exec would clear them for a non-zero uid) — then builds the
 * sandbox with direct mount(2) syscalls, but ONLY trusted driver code runs
 * in this setup phase (candidate code is never present):
 *   - mount propagation contained (MS_PRIVATE|MS_REC on /)
 *   - scratch bind-mounted read-write at /work (only writable mount)
 *   - tmpfs over /home, /root, /tmp (no home/credential mounts);
 *     empty tmpfs over /proc (zero host process visibility)
 *   - / remounted read-only (tooling/oracles stay read-only)
 * The child then setuid/setgid's to inner 65534 (-> outer 65534/nobody),
 * which clears every capability, applies rlimits (RLIMIT_AS 2 GiB,
 * RLIMIT_NPROC 64, RLIMIT_FSIZE 64 MiB, RLIMIT_NOFILE 64, no core; JS heap
 * additionally capped by --max-old-space-size=512 in profiles), chdirs to
 * /work, closes stdin, scrubs the env (PATH, HOME=/nonexistent, SANDBOX=1)
 * and execs the payload. Candidate code ONLY ever runs in this fully
 * unprivileged phase: a namespace escape yields outer uid 65534, never root.
 * The launcher kills the whole process group on timeout.
 *
 * A temp dir, mock tool adapter, Node VM, prompt prohibition or subprocess
 * cwd is NOT a security boundary and is never used here. If any part of the
 * mechanism is unavailable, probeIsolation() reports BLOCKED_ISOLATION and
 * runIsolated() refuses to run — candidate code is never executed.
 */

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { REASON, BUDGETS } from "./constants.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DRIVER_PATH = path.resolve(HERE, "..", "host", "driver.py");
export const MECHANISM = "linux-userns-mount-netns+ro-root+tmpfs-hide+rlimits";

const sha256File = (p) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");

function hasBin(name) {
  try {
    execFileSync("sh", ["-c", `command -v ${name}`], { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function makeRunDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pa2-run-"));
  // mkdtemp makes 0700; the sandboxed process maps to host uid 65534
  // (nobody) and must traverse this dir to reach the scratch bind.
  fs.chmodSync(dir, 0o755);
  const scratch = path.join(dir, "scratch");
  fs.mkdirSync(scratch, { recursive: true });
  return { dir, scratch };
}

function writeScratch(scratch, files) {
  for (const [rel, content] of Object.entries(files)) {
    if (rel.includes("\0") || rel.startsWith("/") || rel.split("/").includes("..")) {
      throw new Error(`unsafe scratch relpath: ${rel}`);
    }
    const fp = path.join(scratch, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content, "utf8");
  }
  // Inside the sandbox the process maps to host uid/gid 65534 (nobody);
  // /work must be writable by it.
  execFileSync("chown", ["-R", "65534:65534", scratch], { timeout: 10000 });
}

/**
 * Run argv inside the sandbox. scratchFiles: { relpath -> content }.
 * canaryPaths: absolute host paths that must be unchanged afterwards.
 * Returns a result object; never throws for sandbox-internal failures.
 */
export async function runIsolated({ scratchFiles, argv, timeoutMs = BUDGETS.profileTimeoutMs, canaryPaths = [] }) {
  const probe = await probeIsolation();
  if (!probe.available) {
    return { ok: false, reason: REASON.ISOLATION_BLOCKED, detail: probe.detail, isolation_status: "BLOCKED_ISOLATION" };
  }
  const { dir, scratch } = makeRunDir();
  const canaryBefore = new Map();
  try {
    for (const p of canaryPaths) {
      try {
        canaryBefore.set(p, sha256File(p));
      } catch (e) {
        return { ok: false, reason: REASON.ISOLATION_BLOCKED, detail: `canary-unreadable:${p}`, isolation_status: "BLOCKED_ISOLATION" };
      }
    }
    writeScratch(scratch, scratchFiles);
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: false, reason: REASON.ISOLATION_BLOCKED, detail: `scratch-setup:${e.message}`, isolation_status: "BLOCKED_ISOLATION" };
  }

  const maxOut = BUDGETS.maxCapturedOutputBytes;
  let stdout = "";
  let stderr = "";
  let truncated = false;
  const child = spawn("/usr/bin/python3", [DRIVER_PATH, scratch, ...argv], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const pgid = child.pid;
  child.stdout.on("data", (d) => {
    if (stdout.length + d.length <= maxOut) stdout += d;
    else truncated = true;
  });
  child.stderr.on("data", (d) => {
    if (stderr.length + d.length <= maxOut) stderr += d;
    else truncated = true;
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {}
  }, timeoutMs);
  const exitCode = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", () => resolve(null));
  });
  clearTimeout(timer);
  // Belt and suspenders: make sure nothing lingers.
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {}

  let canaryOk = true;
  let canaryDetail = "all-canaries-unchanged";
  for (const p of canaryPaths) {
    let after = null;
    try {
      after = sha256File(p);
    } catch {}
    if (after !== canaryBefore.get(p)) {
      canaryOk = false;
      canaryDetail = `canary-changed:${p}`;
      break;
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return {
    ok: true,
    exitCode,
    timedOut,
    signaled: exitCode === null,
    stdout,
    stderr,
    truncated,
    canaryOk,
    canaryDetail,
    isolation_status: "ISOLATED",
    mechanism: MECHANISM,
  };
}

let probeCache = null;
/**
 * Empirical availability probe: runs a trivial payload through the FULL
 * sandbox (namespaces, mounts, map write). Any failure -> BLOCKED_ISOLATION.
 */
export async function probeIsolation() {
  if (probeCache) return probeCache;
  const fail = (detail) => ({ available: false, reason: REASON.ISOLATION_BLOCKED, detail });
  if (process.geteuid() !== 0) {
    probeCache = fail("launcher-must-run-as-root-to-write-uid_map");
    return probeCache;
  }
  if (!fs.existsSync(DRIVER_PATH)) {
    probeCache = fail("driver-missing");
    return probeCache;
  }
  for (const b of ["unshare", "python3", "/usr/bin/node"]) {
    if (!hasBin(b === "/usr/bin/node" ? "node" : b)) {
      probeCache = fail(`tool-missing:${b}`);
      return probeCache;
    }
  }
  // Fail closed when the host uses shared mount propagation: without an
  // effective rprivate, sandbox mounts could propagate to the host.
  try {
    const mi = fs.readFileSync("/proc/self/mountinfo", "utf8");
    for (const line of mi.split("\n")) {
      const parts = line.split(" ");
      const mp = parts[4];
      if (["/", "/tmp", "/home", "/root", "/proc"].includes(mp) && line.includes("shared:")) {
        probeCache = fail(`host-mount-shared:${mp}`);
        return probeCache;
      }
    }
  } catch (e) {
    probeCache = fail(`mountinfo-unreadable:${e.message}`);
    return probeCache;
  }
  // Full end-to-end smoke: payload must print PROBE_OK from inside.
  const { dir, scratch } = makeRunDir();
  try {
    writeScratch(scratch, { "probe.mjs": 'console.log("PROBE_OK");\n' });
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    probeCache = fail(`scratch-setup:${e.message}`);
    return probeCache;
  }
  const child = spawn("/usr/bin/python3", [DRIVER_PATH, scratch, "/usr/bin/node", "--max-old-space-size=512", "/work/probe.mjs"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const pgid = child.pid;
  let out = "";
  child.stdout.on("data", (d) => {
    out += d;
  });
  child.stderr.on("data", () => {});
  const timer = setTimeout(() => {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {}
  }, 15000);
  const code = await new Promise((resolve) => {
    child.on("close", (c) => resolve(c));
    child.on("error", () => resolve(null));
  });
  clearTimeout(timer);
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {}
  fs.rmSync(dir, { recursive: true, force: true });
  if (code === 0 && out.includes("PROBE_OK")) {
    probeCache = { available: true, mechanism: MECHANISM, detail: "smoke-run-passed" };
  } else {
    probeCache = fail(`smoke-run-failed:exit=${code}`);
  }
  return probeCache;
}
