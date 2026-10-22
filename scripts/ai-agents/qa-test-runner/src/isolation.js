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
 *   - With bubblewrap, the whole filesystem is additionally read-only
 *     except the job scratch dir (which contains the execution copy):
 *     writes anywhere else fail EROFS in the kernel.
 *
 * Mechanisms, in preference order:
 *   1. "bwrap" — bubblewrap: net + pid namespaces, read-only rootfs
 *      bind, scratch dir bound writable, --die-with-parent.
 *   2. "unshare" — util-linux unshare user/net/pid/mount namespaces;
 *      the operator checkout is bind-mounted read-only over itself
 *      inside the namespace (defense in depth — execution already
 *      happens in the disposable copy).
 * If neither mechanism is available on the host, detectIsolation()
 * returns null and the runner REFUSES (ISOLATION_UNAVAILABLE) rather
 * than executing unisolated while claiming a boundary. On non-Linux
 * hosts there is currently no supported mechanism: explicit refusal.
 */

import { spawnSync } from "node:child_process";
import { delimiter } from "node:path";

let cachedMechanism;
let probed = false;

/** Detect the host's isolation mechanism: "bwrap" | "unshare" | null. */
export function detectIsolation() {
  if (probed) return cachedMechanism;
  probed = true;
  cachedMechanism = null;
  if (process.platform !== "linux") return cachedMechanism;
  try {
    const b = spawnSync("bwrap", ["--version"], { timeout: 5_000, stdio: "ignore" });
    if (!b.error && b.status === 0) {
      cachedMechanism = "bwrap";
      return cachedMechanism;
    }
  } catch {
    /* fall through */
  }
  try {
    const u = spawnSync("unshare", ["-Urnpfm", "true"], { timeout: 5_000, stdio: "ignore" });
    if (!u.error && u.status === 0) {
      cachedMechanism = "unshare";
      return cachedMechanism;
    }
  } catch {
    /* fall through */
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
    // into shell code. $1 = original target (bound read-only over
    // itself), $2 = exec dir (cwd), $3.. = the command.
    const script =
      'mount --make-rprivate / 2>/dev/null; ' +
      'if [ -n "$1" ]; then mount --bind "$1" "$1" && mount -o remount,ro,bind "$1" || exit 97; fi; ' +
      'cd "$2" || exit 97; shift 2; exec "$@"';
    return {
      command: "unshare",
      args: ["-Urnpfm", "sh", "-c", script, "qa-runner-sandbox", originalTarget ?? "", execDir, ...argv],
    };
  }
  // No mechanism: the runner refuses before ever reaching this point.
  throw new Error(`no isolation mechanism: ${mechanism}`);
}
