/**
 * sentinel-fixtures.js — reusable fixture helpers for budget-sentinel probes.
 *
 * FORGE-P-20261015-CHATGPT-BUDGET-SENTINELS (bundle row 4). Tests/fixtures/
 * documentation ONLY. Never a shared runtime dependency: no agent runtime
 * code imports this module, and it imports node builtins only. Each agent
 * copies/adapts these helpers under its own authenticated manifest; adoption
 * is separately reviewed (condition 5).
 *
 * The one hard rule these helpers exist to enforce (condition 2): arranging
 * a poisoned fixture must NEVER read a throwing property. Every helper
 * below is descriptor-safe — setup uses Object.defineProperty,
 * Reflect.ownKeys and Object.getOwnPropertyDescriptor only, and never
 * property access, JSON.stringify, spread or structuredClone on a value
 * that may carry a throwing tail. A test that stringifies its poisoned
 * fixture during setup proves nothing: the harness, not the agent, tripped
 * the poison. (Found the hard way while probing: JSON.stringify of a set
 * containing a throwing-getter section threw in setup, before run() ran.)
 *
 * Two tail mechanisms, both required by the row:
 *   - throwing Proxy tails: any property read throws (registry entries,
 *     revisions, grants).
 *   - throwing getter tails: only the named property read throws. A getter
 *     tail is strictly weaker than a Proxy — code that reads only other
 *     fields survives it — so a sentinel that refuses on a getter tail
 *     proves charge-before-inspect on that exact field.
 */

import { createHash } from "node:crypto";

/**
 * A throwing Proxy tail. `touched()` reports whether ANY property was read
 * (closure flag — never a property of the tail itself, so checking it
 * cannot trip the poison). `label` names the tail in the thrown error.
 */
export function makeThrowingProxyTail(label) {
  let touched = false;
  const value = new Proxy(
    {},
    {
      get(_target, prop) {
        touched = true;
        throw new Error(`poisoned tail '${label}' had '${String(prop)}' read — it should have been refused before any field access`);
      },
    },
  );
  return { value, touched: () => touched };
}

/**
 * A throwing getter tail: a plain object whose named properties throw on
 * read. `props` lists the properties that throw. Reading any OTHER property
 * is safe (returns undefined), which is exactly what makes this a sharper
 * probe than a Proxy: only the named fields are poisoned.
 */
export function makeThrowingGetterTail(props, label) {
  let touched = false;
  const value = {};
  for (const prop of props) {
    Object.defineProperty(value, prop, {
      enumerable: true,
      get() {
        touched = true;
        throw new Error(`poisoned tail '${label}' had getter '${String(prop)}' read — it should have been refused before any field access`);
      },
    });
  }
  return { value, touched: () => touched };
}

/** Descriptor-safe key listing: never reads a value. */
export function structuralKeys(value) {
  return Reflect.ownKeys(value);
}

/** Descriptor-safe single-property inspection: never reads the value. */
export function descriptorOf(value, key) {
  return Object.getOwnPropertyDescriptor(value, key);
}

/** True when the named property is an accessor (getter/setter), read safely. */
export function hasAccessor(value, key) {
  const desc = Object.getOwnPropertyDescriptor(value, key);
  return desc !== undefined && ("get" in desc || "set" in desc);
}

/**
 * A raw structural span: byte offsets only, no decoding, no interpretation
 * of any candidate's fields (condition 2). The caller owns the offsets;
 * this helper only validates their shape.
 */
export function rawSpan(startByte, endByte) {
  if (!Number.isInteger(startByte) || startByte < 0) {
    throw new Error(`rawSpan: start_byte must be a nonnegative integer (got ${startByte})`);
  }
  if (!Number.isInteger(endByte) || endByte <= startByte) {
    throw new Error(`rawSpan: end_byte must be an integer greater than start_byte (got ${endByte})`);
  }
  return { start_byte: startByte, end_byte: endByte };
}

/** Deterministic filler-commit id (40-hex), so filler sources sort stably. */
export function fillerCommit(seed) {
  return createHash("sha1").update(Buffer.from(`budget-sentinel-filler|${seed}`, "utf8")).digest("hex");
}

/** A filler text of exactly `bytes` UTF-8 bytes (ASCII, so bytes === chars). */
export function fillerText(bytes, ch = "x") {
  return ch.repeat(bytes);
}
