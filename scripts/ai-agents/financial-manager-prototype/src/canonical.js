/**
 * canonical.js — deterministic JSON canonicalization (sorted keys, no
 * whitespace). Used for fixture blob hashing (Git blob SHA-1 over the
 * canonical bytes) and determinism checks. Builtins only.
 *
 * FM-005: canonicalize() is recursive, so unbounded input depth would throw
 * RangeError (stack exhaustion) instead of producing the contract's named
 * refusal. Callers MUST run measureDepth() first and refuse deep input
 * with INPUT_TOO_DEEP before any recursive traversal.
 */

/** Maximum container nesting depth accepted before recursive traversal. */
export const MAX_INPUT_DEPTH = 64;
/** Backstop on total visited nodes (cycle/abuse guard for the pre-scan). */
export const MAX_PRESCAN_NODES = 1000000;

/**
 * Iteratively measure the container nesting depth of a JSON-like value.
 * No recursion: an explicit stack, so adversarial depth cannot exhaust
 * the call stack. Returns {ok:true, maxDepth} or {ok:false, reason}.
 * Cyclic structures are refused (they are not valid fixture content).
 */
export function measureDepth(value) {
  let maxDepth = 0;
  let visited = 0;
  // stack entries: {node, depth, keys, index, ancestors}
  // ancestors = Set of object identities on the current path (cycle check)
  const rootIsContainer = value !== null && typeof value === "object";
  const stack = rootIsContainer
    ? [{ node: value, depth: 1, keys: null, index: 0, ancestors: new Set() }]
    : [];
  // initialize keys lazily per frame
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.keys === null) {
      if (frame.ancestors.has(frame.node)) {
        return { ok: false, reason: "cyclic input structure" };
      }
      frame.ancestors.add(frame.node);
      frame.keys = Array.isArray(frame.node) ? frame.node : Object.values(frame.node);
      if (frame.depth > maxDepth) maxDepth = frame.depth;
      if (maxDepth > MAX_INPUT_DEPTH) {
        return { ok: false, reason: `input depth ${maxDepth} exceeds limit ${MAX_INPUT_DEPTH}` };
      }
    }
    if (frame.index >= frame.keys.length) {
      frame.ancestors.delete(frame.node);
      stack.pop();
      continue;
    }
    const child = frame.keys[frame.index++];
    visited++;
    if (visited > MAX_PRESCAN_NODES) {
      return { ok: false, reason: `input exceeds ${MAX_PRESCAN_NODES} visited nodes` };
    }
    if (child !== null && typeof child === "object") {
      stack.push({ node: child, depth: frame.depth + 1, keys: null, index: 0, ancestors: frame.ancestors });
    }
  }
  return { ok: true, maxDepth };
}

export function canonicalize(value) {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "number" || t === "boolean") return JSON.stringify(value);
  if (t === "string") return JSON.stringify(value);
  if (t === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalize(v)).join(",") + "]";
  }
  if (t === "object") {
    const keys = Object.keys(value).sort();
    return (
      "{" +
      keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") +
      "}"
    );
  }
  throw new Error("canonicalize: unsupported value type " + t);
}

export function canonicalBytes(value) {
  return Buffer.from(canonicalize(value), "utf8");
}
