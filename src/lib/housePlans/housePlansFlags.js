// HOUSE PLANS (HP-L0) feature flag.
//
// The entire HOUSE PLANS reference layer in Room Designer sits behind this
// flag. It is OFF by default: nothing renders, no panel toggle appears, and
// no HOUSE PLANS code path runs unless NEXT_PUBLIC_HOUSE_PLANS_ENABLED is
// explicitly set to "true" at build time.
//
// Mirrors the src/lib/analytics/config.js pattern: a pure reader over an env
// bag (easy to unit test) plus a browser helper that snapshots process.env.

export const HOUSE_PLANS_FLAG_KEY = "NEXT_PUBLIC_HOUSE_PLANS_ENABLED";

export function readHousePlansConfig(env = {}) {
  const enabled = env[HOUSE_PLANS_FLAG_KEY] === "true";
  return Object.freeze({ enabled });
}

export function browserHousePlansEnvironment() {
  return { [HOUSE_PLANS_FLAG_KEY]: process.env[HOUSE_PLANS_FLAG_KEY] };
}

export function isHousePlansEnabled() {
  return readHousePlansConfig(browserHousePlansEnvironment()).enabled;
}
