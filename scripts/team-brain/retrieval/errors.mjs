// Team Brain P5 — retrieval error codes. Reuses TeamBrainError/fail from
// the ledger so P5 refusals assert exactly like every other slice.

import { CODES, TeamBrainError, fail } from "../ledger/errors.mjs";

export { CODES, TeamBrainError, fail };

export const P5_CODES = {
  ...CODES,
  FORBIDDEN_DOMAIN: "FORBIDDEN_DOMAIN",
  EPISODE_OVERSIZED: "EPISODE_OVERSIZED",
  UNKNOWN_EPISODE: "UNKNOWN_EPISODE",
  UNKNOWN_PIN: "UNKNOWN_PIN",
  PIN_CONFLICT: "PIN_CONFLICT",
  INVALID_SLOT: "INVALID_SLOT",
  INVALID_SEARCH: "INVALID_SEARCH",
  // Fix round 1 (ChatGPT NEEDS CHANGES 2026-10-30, TBP5-001..007).
  // FUTURE_REVISION: a pin or asOf above the admitted high-water mark.
  // ACCESS_DENIED: a working-set displacement (or read) names an episode
  //   the principal may not read. The refusal carries no episode content.
  // REVISION_MISMATCH: a working-set reference names a revision that is
  //   not the episode's actual version.
  // CAPTURE_CONFLICT: reserved for a replay whose consequential capture
  //   metadata differs; current code avoids it by folding that metadata
  //   into the canonical episode identity instead (see computeEpisodeId).
  FUTURE_REVISION: "FUTURE_REVISION",
  ACCESS_DENIED: "ACCESS_DENIED",
  REVISION_MISMATCH: "REVISION_MISMATCH",
  CAPTURE_CONFLICT: "CAPTURE_CONFLICT",
};
