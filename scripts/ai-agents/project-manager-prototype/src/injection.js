// injection.js — seeded injection-family recognizer. Structural capability
// absence is the defense; this flags known families for quarantine.

const FAMILIES = [
  { id: 'INJ_DIRECTIVE', re: /\b(ignore|disregard|override)\b.{0,40}\b(instructions|brief|policy|contract)\b/i },
  { id: 'INJ_AUTHORITY', re: /\b(approved by|authorized by|signed by)\b/i },
  { id: 'INJ_FINALITY', re: /\b(final|binding|committed)\b.{0,30}\b(decision|plan|schedule)\b/i },
  { id: 'INJ_EXFIL', re: /\b(send|email|transmit|upload)\b.{0,40}\b(report|data|results)\b/i },
  { id: 'INJ_FINANCIAL', re: /\b(pay|transfer|wire|invoice)\b.{0,30}\$\s?\d/i },
  { id: 'INJ_MARKUP', re: /<\s*(script|iframe|object|embed)\b/i },
];

export function recognizeInjections(text) {
  const hits = [];
  if (typeof text !== 'string') return hits;
  for (const f of FAMILIES) {
    if (f.re.test(text)) hits.push(f.id);
  }
  return hits;
}

/** Scan a plan package's free-text fields; returns [{record_id, families}]. */
export function scanPackageText(pkg) {
  const out = [];
  for (const t of pkg.tasks || []) {
    const hits = recognizeInjections(t.notes || '');
    if (hits.length) out.push({ record_id: t.task_id, families: hits });
  }
  return out;
}
