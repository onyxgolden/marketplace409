/**
 * profiles.mjs — fixed execution profile registry.
 * Profile IDs map to literal executable/argv templates. No shell, no
 * interpolation, no eval, no task-supplied command strings. The only
 * variable parts are validated relative paths inside the disposable /work
 * tree and the deterministic seed — both produced by the host, never by the
 * task or candidate.
 */

import { PROFILES } from "./constants.mjs";

export const NODE_BIN = "/usr/bin/node";
export const NODE_HEAP_FLAG = "--max-old-space-size=512";

/**
 * Build the literal argv for a profile run inside the sandbox (cwd = /work).
 * `oracleRel` is the host-verified oracle script path inside /work
 * (e.g. "oracle/lit.baseline.mjs"). `targetRels` are validated plan paths.
 */
export function profileArgv(profileId, { oracleRel = null, targetRels = [], seed = 0, treeDigest = "" } = {}) {
  switch (profileId) {
    case PROFILES.SYNTAX:
      if (targetRels.length === 0) throw new Error("syntax profile needs targets");
      return [NODE_BIN, NODE_HEAP_FLAG, "--check", ...targetRels.map((t) => `/work/${t}`)];
    case PROFILES.BASELINE:
    case PROFILES.CANDIDATE:
      if (!oracleRel) throw new Error(`${profileId} profile needs an oracle`);
      return [
        NODE_BIN,
        NODE_HEAP_FLAG,
        `/work/${oracleRel}`,
        "--seed",
        String(seed >>> 0),
        "--tree-digest",
        treeDigest,
      ];
    default:
      throw new Error(`unknown profile: ${profileId}`);
  }
}

/** Which profiles a family plan must request (fixed per family). */
export function requiredProfilesForPlan() {
  return [PROFILES.SYNTAX, PROFILES.BASELINE, PROFILES.CANDIDATE];
}
