/**
 * injection.js — seeded source-directive recognizer.
 *
 * Security in this prototype comes from the absence of capabilities and from
 * structured allowlists (build identity binds only through the trusted
 * registry; task labels never establish it). This recognizer flags the
 * seeded attack families used by the fixture battery so injected content is
 * quarantined and cannot support claims. It makes no claim of universal
 * attack detection.
 */

const FAMILIES = [
  {
    id: "DIRECTIVE_OVERRIDE",
    // "ignore previous instructions", "disregard above", bare imperative overrides
    re: /\bignore\s+(all\s+|previous\s+|prior\s+|the\s+)?instructions\b|\bdisregard\s+(all\s+|previous\s+|the\s+)?(instructions|above)\b/i,
  },
  {
    id: "FORCED_VERDICT",
    // "mark all PASS", "report this as verified", "set result to PASS"
    re: /\bmark\s+(all\s+|this\s+)?(as\s+)?(pass|verified|approved)\b|\breport\s+(this\s+)?as\s+verified\b|\bset\s+result\s+to\s+(pass|verified)\b/i,
  },
  {
    id: "FAKE_AUTHORITY",
    // claims of principal authority inside data fields
    re: /\bas\s+(an?\s+)?(admin|owner|jason)\b.*\b(authorize|approve|order)\b|\bjason\s+(said|ordered|approved)\b/i,
  },
  {
    id: "BUILD_SPOOF_LABEL",
    // build identity smuggled in a label: only the registry binds build identity
    re: /\bbuild_id\s*[:=]\s*["']?[a-z0-9_-]+/i,
  },
  {
    id: "SYSTEM_IMPERSONATION",
    re: /\[SYSTEM\]|\bsystem\s*:\s*(you are|override|new instructions)\b/i,
  },
];

/**
 * Scan string fields of a record for seeded injection families.
 * Returns {injected: boolean, families: string[]}.
 * Non-string input is never flagged.
 */
export function scanInjection(value) {
  const families = [];
  if (typeof value !== "string" || value.length === 0) return { injected: false, families };
  for (const f of FAMILIES) {
    if (f.re.test(value)) families.push(f.id);
  }
  return { injected: families.length > 0, families };
}

/**
 * Scan the injectable string fields of an evidence record and of task labels.
 * Returns the union of matched families.
 */
export function scanRecord(record) {
  const fields = [
    record?.control_id,
    record?.assertion_id,
    record?.fixture_observer_id,
    record?.repo,
    record?.environment,
  ];
  // expected/observed may be objects; scan their canonical text form too.
  for (const v of [record?.expected, record?.observed]) {
    if (v !== null && v !== undefined) {
      fields.push(typeof v === "string" ? v : JSON.stringify(v));
    }
  }
  const families = new Set();
  for (const f of fields) {
    for (const fam of scanInjection(f).families) families.add(fam);
  }
  return { injected: families.size > 0, families: [...families].sort() };
}

/** Scan task-level label fields (surface id/route). Build pins are validated, not scanned. */
export function scanTaskLabels(task) {
  const families = new Set();
  for (const f of [task?.surface?.id, task?.surface?.route, task?.task_id]) {
    for (const fam of scanInjection(f).families) families.add(fam);
  }
  return { injected: families.size > 0, families: [...families].sort() };
}
