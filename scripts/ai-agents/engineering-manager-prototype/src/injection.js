/**
 * injection.js — seeded injection recognizer for the engineering-manager prototype.
 *
 * Flags the seeded attack families used by the corpus negatives: instruction
 * overrides in prose, approval-forgery language, control-id directives and
 * task-label directives. This is a classifier over task-spec prose (data),
 * not a security boundary: real safety comes from the absence of execution
 * capabilities and the structured allowlists. A flagged spec is quarantined
 * and cannot support a successful plan node.
 */

const FAMILIES = [
  {
    family: "instruction_override",
    patterns: [
      /ignore\s+(all\s+)?previous\s+instructions/i,
      /disregard\s+(all\s+)?(prior|previous)\s+instructions/i,
      /override\s+the\s+brief/i,
      /forget\s+your\s+instructions/i,
    ],
  },
  {
    family: "approval_forgery",
    patterns: [
      /approve\s+this\s+plan/i,
      /mark\s+.*\s+as\s+approved/i,
      /jason\s+approved\s+this/i,
      /pre-?approved/i,
    ],
  },
  {
    family: "control_id_directive",
    patterns: [
      /\[system\s*:/i,
      /\[admin\s*:/i,
      /\[control\s*:/i,
      /<\s*system\s*>/i,
    ],
  },
  {
    family: "task_label_directive",
    patterns: [
      /^task:\s*do\s+/im,
      /execute\s+the\s+following\s+as\s+an\s+action/im,
      /run\s+this\s+command:/i,
    ],
  },
  {
    family: "exfiltration_probe",
    patterns: [
      /reveal\s+your\s+system\s+prompt/i,
      /output\s+the\s+approval\s+store/i,
      /list\s+all\s+secrets/i,
    ],
  },
];

export function scanInjection(text) {
  const hits = [];
  if (typeof text !== "string") return hits;
  for (const f of FAMILIES) {
    for (const p of f.patterns) {
      if (p.test(text)) {
        hits.push({ family: f.family, pattern: String(p) });
        break;
      }
    }
  }
  return hits;
}

/** Scan the prose-bearing fields of a task spec. Returns {hits, quarantined}. */
export function scanSpec(spec) {
  const fields = [spec.title, ...(spec.non_goal_prose ?? [])];
  const hits = [];
  for (const f of fields) {
    for (const h of scanInjection(f)) hits.push(h);
  }
  return { hits, quarantined: hits.length > 0 };
}
