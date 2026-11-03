// FORGE Brain conversation harness — configuration.
//
// Ships DISABLED: isBrainHarnessEnabled() is false unless the server env var
// BRAIN_CONVERSATION_HARNESS_ENABLED is exactly "true". Activation happens
// only on Jason's word after P8 passes; nothing in this build turns it on.
//
// Defaults below are build choices, not scope decisions, unless noted:
// - Archive window (90 days) is PROPOSED and UNCONFIRMED: the scope left the
//   window TBD, and this default is flagged in the build report for Jason's
//   confirmation. It is a config value, not a decided rule.
// - Working-set size (8) is a build choice: the team-brain contract's
//   experiment setting was 4 slots for the executive queue, not a chat
//   requirement; chat injection uses 8, still bounded, to keep per-turn
//   token cost small while giving recall headroom.

export const BRAIN_HARNESS_FLAG = "BRAIN_CONVERSATION_HARNESS_ENABLED";

export function isBrainHarnessEnabled(env = process.env) {
  return env?.[BRAIN_HARNESS_FLAG] === "true";
}

// Inferred-decay window (Q3, decided): 7-day default, owner-configurable.
export const DEFAULT_INFERRED_DECAY_DAYS = 7;
export const MIN_INFERRED_DECAY_DAYS = 1;
export const MAX_INFERRED_DECAY_DAYS = 90;

// Episodic archive window (Q2, TBD in scope): PROPOSED default, UNCONFIRMED.
export const DEFAULT_ARCHIVE_WINDOW_DAYS = 90;

// Per-turn working-set size (bounded injection).
export const DEFAULT_WORKING_SET_SIZE = 8;

// Consolidation replay mix (contract §6 experiment setting, starting point).
export const CONSOLIDATION_NEW_FRACTION = 0.7;
export const CONSOLIDATION_CANDIDATE_LIMIT = 50;

export const BRAIN_PREFERENCE_KEYS = Object.freeze([
  "inferred_decay_days",
  "brain_icon_position",
]);

export const BRAIN_SALIENCE_ORDER = Object.freeze({
  owner_stated: 3,
  verified: 2,
  inferred: 1,
});
