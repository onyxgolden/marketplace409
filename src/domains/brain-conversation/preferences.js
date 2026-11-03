// FORGE Brain conversation harness — owner preferences (Q1 icon position,
// Q3 decay window). Pure validation; storage lives in the store layer.

import {
  DEFAULT_INFERRED_DECAY_DAYS,
  MAX_INFERRED_DECAY_DAYS,
  MIN_INFERRED_DECAY_DAYS,
} from "./config.js";

export const PREFERENCE_DEFAULTS = Object.freeze({
  inferred_decay_days: DEFAULT_INFERRED_DECAY_DAYS,
  brain_icon_position: Object.freeze({ x: 92, y: 85, collapsed: true }),
});

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function clampPercent(value) {
  if (!isFiniteNumber(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function clampIconPosition(position) {
  const pos = position ?? {};
  return {
    x: clampPercent(pos.x ?? PREFERENCE_DEFAULTS.brain_icon_position.x),
    y: clampPercent(pos.y ?? PREFERENCE_DEFAULTS.brain_icon_position.y),
    collapsed:
      typeof pos.collapsed === "boolean"
        ? pos.collapsed
        : PREFERENCE_DEFAULTS.brain_icon_position.collapsed,
  };
}

export function validatePreference(key, value) {
  if (key === "inferred_decay_days") {
    if (
      !Number.isInteger(value) ||
      value < MIN_INFERRED_DECAY_DAYS ||
      value > MAX_INFERRED_DECAY_DAYS
    ) {
      throw new Error(
        `inferred_decay_days must be a whole number from ${MIN_INFERRED_DECAY_DAYS} to ${MAX_INFERRED_DECAY_DAYS}.`,
      );
    }
    return value;
  }
  if (key === "brain_icon_position") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("brain_icon_position must be an object with x, y, and collapsed.");
    }
    if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
      throw new Error("brain_icon_position x and y must be numbers.");
    }
    if (typeof value.collapsed !== "boolean") {
      throw new Error("brain_icon_position collapsed must be true or false.");
    }
    return clampIconPosition(value);
  }
  throw new Error(`Unknown Brain preference: ${key}.`);
}
