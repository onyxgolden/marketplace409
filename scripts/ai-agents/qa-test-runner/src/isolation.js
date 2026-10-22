/**
 * isolation.js — the execution boundary for suite processes.
 *
 * Declared policy (the brief's read-only/offline boundary, made real):
 *   - Suites execute in a DISPOSABLE COPY materialized from the pinned
 *     commit (runner.js), never in the operator checkout.
 *   - Network is DENIED by a network namespace: the child sees no
 *     routes at all (a connect attempt fails ENETUNREACH), not merely
 *     a discouraging environment variable.
 *   - The environment is SCRUBBED to an allowlist (PATH, LANG/LC_ALL,
 *     plus runner-set HOME/TMPDIR/CI/NO_COLOR). No credential, token
 *     or production variable from the operator's environment is
 *     inherited. HOME and TMPDIR point inside the job scratch dir, so
 *     tool caches (npx, vite) land in disposable space.
 *   - Descendants are CONTAINED by a pid namespace whose init is the
 *     suite process: when the boundary dies, the kernel destroys every
 *     process in the namespace — an escaped grandchild holding the
 *     output pipes cannot keep the job alive or keep running.
 *   - The whole filesystem is read-only EXCEPT the job scratch dir
 *     (which contains the execution copy): writes anywhere else fail
 *     EROFS in the kernel. Both mechanisms enforce this — the unshare
 *     fallback remounts the rootfs read-only and re-binds only the
 *     scratch dir writable; it is not a weaker policy.
 *
 * Capability detection PROVES the boundary: detectIsolation() runs the
 * real boundary shape with a benign command and only advertises a
 * mechanism whose probe exits 0. A probe additionally requires a write
 * outside the scratch dir to FAIL and a write inside it to SUCCEED —
 * an installed binary whose namespace creation is denied (or whose
 * read-only remount silently does not apply) is NOT a usable boundary.
 * If neither mechanism proves itself, detectIsolation() returns null
 * and the runner REFUSES (ISOLATION_UNAVAILABLE) BEFORE any
 * materialization — the policy is never silently claimed, and a
 * launch-time failure is reported as a boundary diagnostic
 * (SPAWN_FAILED), never as a test result.
 *
 * Mechanisms, in preference order:
 *   1. "bwrap" — bubblewrap: net + pid namespaces, read-only rootfs
 *      bind, scratch dir bound writable, --die-with-parent.
 *   2. "unshare" — util-linux unshare user/net/pid/mount namespaces;
 *      rootfs remounted read-only over itself, scratch dir re-bound
 *      writable, fresh /proc and /dev. Same scratch-only write
 *      policy as bwrap — never a silent weakening.
 * On non-Linux hosts there is currently no supported mechanism:
 * explicit refusal.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";

let cachedMechanism;
let probed = false;

const PROBE_TIMEOUT_MS = 15_000;

/**
 * Run fn with a fresh disposable probe scratch dir, always cleaned up.
 * The probe dir stands in for the job scratch dir in the boundary
 * shape being proven.
 */
function withProbeScratch(fn) {
  const dir = mkdtempSync(join(tmpdir(), "qa-iso-probe-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Prove bubblewrap: the real bwrap boundary shape with a benign
 * command. Exit 0 proves the binary launches, net+pid namespaces are
 * created, the read-only rootfs bind applies (a write outside scratch
 * fails), and the scratch bind stays writable.
 */
function proveBwrap() {
  return withProbeScratch((scratch) => {
    const r = spawnSync(
      "bwrap",
      [
        "--unshare-net",
        "--unshare-pid",
        "--die-with-parent",
        "--ro-bind", "/", "/",
        "--bind", scratch, scratch,
        "--proc", "/proc",
        "--dev", "/dev",
        "--chdir", scratch,
        "--",
        "sh", "-c",
        "touch /qa-iso-ro-probe 2>/dev/null && exit 1; touch qa-iso-rw-probe 2>/dev/null && exit 0; exit 1",
      ],
      { timeout: PROBE_TIMEOUT_MS, stdio: "ignore" }
    );
    return !r.error && r.status === 0;
  });
}

/**
 * The unshare mount sequence — the SAME script the real spawn path
 * uses. Rootfs goes read-only; only the scratch dir ($1) is re-bound
 * writable; fresh /proc and /dev. Any mount failure exits 97, so a
 * host that cannot provide the full policy never reports success.
 */
function unshareScript() {
  return (
    "mount --make-rprivate / 2>/dev/null; " +
    "mount --bind / / && mount -o remount,ro,bind / || exit 97; " +
    "mount --bind \"$1\" \"$1\" && mount -o remount,rw,bind \"$1\" || exit 97; " +
    "mount -t proc proc /proc 2>/dev/null || exit 97; " +
    "mkdir -p /dev && mount -t tmpfs tmpfs /dev 2>/dev/null || exit 97; "
  );
}

/**
 * Prove the unshare fallback meets the SAME declared guarantees as
 * bwrap: net+pid+mount+user namespaces, read-only rootfs with a
 * writable scratch exception, proven by the mount sequence plus a
 * write-outside/write-inside assertion with a benign command.
 */
function proveUnshare() {
  return withProbeScratch((scratch) => {
    const script =
      unshareScript() +
      "touch /qa-iso-ro-probe 2>/dev/null && exit 1; " +
      "touch \"$1/qa-iso-rw-probe\" 2>/dev/null || exit 1; " +
      "exit 0";
    const r = spawnSync("unshare", ["-Urnpfm", "sh", "-c", script, "qa-iso-probe", scratch], {
      timeout: PROBE_TIMEOUT_MS,
      stdio: "ignore",
    });
    return !r.error && r.status === 0;
  });
}

/**
 * Detect the host's isolation mechanism: "bwrap" | "unshare" | null.
 * Each candidate is PROVEN with the real boundary shape — an installed
 * binary is not capability evidence. The unshare fallback is only
 * tried because it meets the same declared guarantees (proven above);
 * otherwise the runner refuses before preparing any candidate work.
 */
export function detectIsolation() {
  if (probed) return cachedMechanism;
  probed = true;
  cachedMechanism = null;
  if (process.platform !== "linux") return cachedMechanism;
  try {
    if (proveBwrap()) {
      cachedMechanism = "bwrap";
      return cachedMechanism;
    }
  } catch {
    /* a throwing probe is a failed probe */
  }
  try {
    if (proveUnshare()) {
      cachedMechanism = "unshare";
      return cachedMechanism;
    }
  } catch {
    /* a throwing probe is a failed probe */
  }
  return cachedMechanism;
}

/**
 * The scrubbed environment for a suite process. `base` defaults to
 * process.env; only the allowlist survives. HOME/TMPDIR are set by the
 * runner to scratch locations, so they are taken from `scratchDir`,
 * never from the base environment.
 */
export function scrubbedEnv(scratchDir, base = process.env) {
  const env = {};
  if (typeof base.PATH === "string" && base.PATH.length > 0) env.PATH = base.PATH;
  else env.PATH = ["/usr/local/bin", "/usr/bin", "/bin"].join(delimiter);
  if (typeof base.LANG === "string") env.LANG = base.LANG;
  if (typeof base.LC_ALL === "string") env.LC_ALL = base.LC_ALL;
  env.HOME = `${scratchDir}/home`;
  env.TMPDIR = `${scratchDir}/tmp`;
  env.CI = "1";
  env.NO_COLOR = "1";
  return env;
}

/**
 * Build the spawn spec for running `argv` (the runner-constructed
 * vitest invocation) inside the boundary, with cwd = execDir.
 * Returns {command, args}. The caller spawns with shell:false,
 * detached (own process group), env = scrubbedEnv(scratchDir).
 */
export function buildIsolatedSpawn(mechanism, { execDir, scratchDir, originalTarget, argv }) {
  if (mechanism === "bwrap") {
    return {
      command: "bwrap",
      args: [
        "--unshare-net",
        "--unshare-pid",
        "--die-with-parent",
        "--ro-bind", "/", "/",
        "--bind", scratchDir, scratchDir,
        "--proc", "/proc",
        "--dev", "/dev",
        "--chdir", execDir,
        "--",
        ...argv,
      ],
    };
  }
  if (mechanism === "unshare") {
    // Positional parameters only — no string interpolation of paths
    // into shell code. $1 = job scratch dir (the ONLY writable
    // location: the rootfs is remounted read-only and the scratch dir
    // is re-bound writable over itself), $2 = exec dir (cwd, inside
    // the scratch dir), $3.. = the command. The mount sequence is the
    // same one the capability probe proves; the operator checkout needs
    // no separate bind because the whole rootfs is already read-only.
    const script =
      unshareScript() +
      'cd "$2" || exit 97; shift 2; exec "$@"';
    return {
      command: "unshare",
      args: ["-Urnpfm", "sh", "-c", script, "qa-runner-sandbox", scratchDir, execDir, ...argv],
    };
  }
  // No mechanism: the runner refuses before ever reaching this point.
  throw new Error(`no isolation mechanism: ${mechanism}`);
}
