// resolver.js — deterministic fixture resolver with a monotonic budget.
// S648-001 lesson (Scheduler fix round): the budget MUST be instantiated
// BEFORE any task/package validation runs, and every candidate object
// (task rows, edges, milestones, capacity windows, nested demands) is
// charged BEFORE its fields are read. Attempt 65 refuses before inspecting
// that candidate or anything later.
// Budget: 256 KiB total input, 64 consulted objects, 512 checked spans,
// 256 output records, 256 KiB final output.

import { createHash } from 'node:crypto';
import { utf8Length } from './canonical.js';

export const LIMITS = {
  maxInputBytes: 256 * 1024,
  maxObjects: 64,
  maxSpans: 512,
  maxOutputRecords: 256,
  maxOutputBytes: 256 * 1024,
  maxDepth: 32,
};

export class BudgetExceeded extends Error {
  constructor(what) {
    super(`BUDGET_EXCEEDED: ${what}`);
    this.code = 'BUDGET_EXCEEDED';
  }
}

export class InputLimit extends Error {
  constructor(what) {
    super(`INPUT_LIMIT: ${what}`);
    this.code = 'INPUT_LIMIT';
  }
}

/** Git blob SHA-1 of UTF-8 bytes (with the git blob header). */
export function gitBlobSha1(text) {
  const bytes = Buffer.from(text, 'utf8');
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return createHash('sha1').update(header).update(bytes).digest('hex');
}

/** SHA-256 hex of UTF-8 bytes. */
export function sha256Hex(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

export class Resolver {
  constructor(store) {
    this.store = store || {};
    this.objectsCharged = 0;
    this.spansCharged = 0;
    this.inputBytesCharged = 0;
    this.outputRecordsCharged = 0;
  }

  /** Charge one consulted object; throws BudgetExceeded at 65. */
  chargeObject() {
    this.objectsCharged += 1;
    if (this.objectsCharged > LIMITS.maxObjects) {
      throw new BudgetExceeded(`object ${this.objectsCharged} exceeds ${LIMITS.maxObjects}`);
    }
  }

  chargeInputBytes(n) {
    this.inputBytesCharged += n;
    if (this.inputBytesCharged > LIMITS.maxInputBytes) {
      throw new InputLimit(`input bytes ${this.inputBytesCharged} exceed ${LIMITS.maxInputBytes}`);
    }
  }

  chargeSpan() {
    this.spansCharged += 1;
    if (this.spansCharged > LIMITS.maxSpans) {
      throw new BudgetExceeded(`span ${this.spansCharged} exceeds ${LIMITS.maxSpans}`);
    }
  }

  chargeOutputRecord() {
    this.outputRecordsCharged += 1;
    if (this.outputRecordsCharged > LIMITS.maxOutputRecords) {
      throw new BudgetExceeded(`output record ${this.outputRecordsCharged} exceeds ${LIMITS.maxOutputRecords}`);
    }
  }

  /**
   * Resolve a fixture ref. Charges the object and its bytes BEFORE
   * inspection; verifies SHA-256 of registered bytes.
   */
  resolve(fixtureId) {
    this.chargeObject();
    const entry = this.store[fixtureId];
    if (!entry) {
      const e = new Error(`READ_DENIED: unknown fixture ${fixtureId}`);
      e.code = 'READ_DENIED';
      throw e;
    }
    this.chargeInputBytes(utf8Length(entry.bytes));
    const actual = sha256Hex(entry.bytes);
    if (actual !== entry.sha256) {
      const e = new Error(`HASH_MISMATCH: fixture ${fixtureId}`);
      e.code = 'HASH_MISMATCH';
      throw e;
    }
    let record;
    try {
      record = JSON.parse(entry.bytes);
    } catch {
      const e = new Error(`INVALID_INPUT: fixture ${fixtureId} is not JSON`);
      e.code = 'INVALID_INPUT';
      throw e;
    }
    checkDepth(record, 0);
    return { fixture_id: fixtureId, record };
  }
}

function checkDepth(v, depth) {
  if (depth > LIMITS.maxDepth) {
    const e = new Error('INVALID_INPUT: nesting depth exceeds 32');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  if (Array.isArray(v)) {
    for (const x of v) checkDepth(x, depth + 1);
  } else if (v !== null && typeof v === 'object') {
    for (const k of Object.keys(v)) checkDepth(v[k], depth + 1);
  }
}

export const SYNTHETIC_COMMIT = '0'.repeat(40);
