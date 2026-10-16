/**
 * injection.js — untrusted-instruction detection for config text.
 * Original code. Pure Node 24 ESM, no imports.
 *
 * Configuration exports are DATA. Any agent-directed instruction text
 * embedded in a config value is treated as a hostile/accidental injection:
 * the export is refused, never followed. Classification references Skill
 * Spectre's PROMPT_INJECTION class semantics (report, never execute).
 */

const INSTRUCTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /new\s+system\s+prompt/i,
  /reveal\s+(your|the)\s+(system|secret|private)/i,
  /exfiltrate|send\s+.*\s+to\s+https?:\/\//i,
  /do\s+not\s+tell\s+(the\s+)?user/i,
  /override\s+(the\s+)?(security|audit|safety)\s+(checks?|policy)/i,
];

/**
 * Scan a string value for instruction-override patterns.
 * Returns the first matching pattern source, or null.
 */
export function detectInstructionText(value) {
  if (typeof value !== "string") return null;
  for (const p of INSTRUCTION_PATTERNS) {
    if (p.test(value)) return p.source;
  }
  return null;
}

/**
 * Walk own string leaves of a config object (bounded by budget) and
 * return the first {pointer, pattern} injection hit, or null.
 * Uses ownRead only — never invokes accessors.
 */
export function findInjection(config, charge, maxLeaves = 64) {
  const stack = [{ value: config, pointer: "$.config" }];
  let leaves = 0;
  while (stack.length) {
    const { value, pointer } = stack.pop();
    if (typeof value === "string") {
      leaves++;
      if (leaves > maxLeaves) return null;
      const hit = detectInstructionText(value);
      if (hit) return { pointer, pattern: hit, excerpt: value.slice(0, 120) };
      continue;
    }
    if (value !== null && typeof value === "object") {
      const keys = Object.keys(value);
      for (let i = keys.length - 1; i >= 0; i--) {
        const k = keys[i];
        const d = Object.getOwnPropertyDescriptor(value, k);
        if (!d || !("value" in d)) continue;
        charge(`injection-scan:${pointer}.${k}`);
        stack.push({ value: d.value, pointer: `${pointer}.${k}` });
      }
    }
  }
  return null;
}
