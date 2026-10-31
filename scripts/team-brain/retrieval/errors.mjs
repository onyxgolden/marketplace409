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
};
