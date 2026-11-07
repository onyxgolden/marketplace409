/**
 * mode.js — the OFF-by-default gate for the programmer dry-run slice.
 *
 * The feature ships DISABLED. Nothing in this slice opens an adapter,
 * a store, a fixture, a source record or a worktree while the mode is
 * DISABLED; the preview harness returns before touching any of them.
 * SYNTHETIC_PREVIEW is the only other mode, and it loads synthetic
 * fixtures only — never a real branch, never a live repo.
 */
import { JobRefusal, MODES, resolveMode } from "./jobContracts.js";

export { MODES, resolveMode };

/** The mode the feature is in when the host configures nothing. */
export const DEFAULT_MODE = "DISABLED";

/**
 * Resolve the host mode, defaulting to DISABLED when the host
 * configures nothing. There is no environment-variable or caller
 * override: the host passes its configured value in, and anything
 * else refuses closed through resolveMode.
 */
export function effectiveMode(hostMode) {
  return resolveMode(hostMode === undefined ? DEFAULT_MODE : hostMode, undefined);
}

/**
 * Gate helper for any future entrypoint that would do work: returns
 * the resolved mode, and throws before the caller opens anything
 * unless the mode is exactly SYNTHETIC_PREVIEW. DISABLED is not an
 * error — it is the shipped state — so callers that only need to know
 * "are we off?" use effectiveMode() and check for DISABLED instead.
 */
export function requireSyntheticPreview(hostMode) {
  const mode = effectiveMode(hostMode);
  if (mode !== "SYNTHETIC_PREVIEW") {
    throw new JobRefusal("FEATURE_DISABLED", "programmer dry-run is DISABLED; synthetic preview requires explicit host configuration");
  }
  return mode;
}

/** True only when the feature is in its shipped OFF state. */
export function isDisabled(hostMode) {
  return effectiveMode(hostMode) === "DISABLED";
}
