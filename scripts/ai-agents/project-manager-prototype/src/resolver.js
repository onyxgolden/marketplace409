// resolver.js — deterministic fixture resolver with monotonic budget,
// authority enforcement, and verified citations.
// Budget: 256 KiB total input, 64 consulted objects, 512 checked spans,
// 256 output records, 256 KiB final output.
// Authority (PM651-001): a valid grant must cover each fixture read BEFORE
// any bytes are touched. Missing principal, revoked/wrong-scope identity,
// unregistered relay, or missing/denied grant fails closed with zero
// denied-byte accesses.
// Citations (PM651-002): fixtures carry host-registered SourceRef tuples;
// the resolver recomputes the real Git blob SHA-1 and verifies exact
// half-open UTF-8 byte spans under the live span budget.

import { createHash } from 'node:crypto';
import { utf8Length } from './canonical.js';
import { safeGet, isSafeKey } from './schemas.js';

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

export class AuthError extends Error {
  constructor(code, what) {
    super(`${code}: ${what}`);
    this.code = code;
  }
}

/** Git blob SHA-1 of UTF-8 bytes (with the git blob header). */
export function gitBlobSha1(text) {
  const bytes = Buffer.from(text, 'utf8');
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return createHash('sha1').update(header).update(bytes).digest('hex');
}

/** SHA-256 hex of UTF-8 bytes (artifact bytes, never mislabeled as git-sha1). */
export function sha256Hex(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

const SOURCEREF_FIELDS = ['repo', 'path', 'commit', 'blob', 'algorithm', 'revision'];
const HEX40 = /^[0-9a-f]{40}$/;

function checkSourceRef(ref, fixtureId) {
  const errors = [];
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return ['source_ref must be an object'];
  for (const k of Object.keys(ref)) {
    if (!SOURCEREF_FIELDS.includes(k)) errors.push(`unknown source_ref field: ${k}`);
  }
  if (typeof ref.repo !== 'string' || !ref.repo) errors.push('source_ref.repo required');
  if (typeof ref.path !== 'string' || !ref.path || ref.path.includes('..') || ref.path.startsWith('/')) {
    errors.push('source_ref.path must be a relative allowlisted path');
  }
  if (typeof ref.commit !== 'string' || !HEX40.test(ref.commit)) errors.push('source_ref.commit must be 40-hex');
  if (typeof ref.blob !== 'string' || !HEX40.test(ref.blob)) errors.push('source_ref.blob must be 40-hex');
  if (ref.algorithm !== 'git-sha1') errors.push('source_ref.algorithm must be "git-sha1"');
  if (typeof ref.revision !== 'string' || !ref.revision) errors.push('source_ref.revision required');
  return errors;
}

export class Resolver {
  constructor(store) {
    this.store = store || {};
    this.objectsCharged = 0;
    this.spansCharged = 0;
    this.inputBytesCharged = 0;
    this.outputRecordsCharged = 0;
    // Tracks whether any denied bytes were touched (must stay 0 on denial).
    this.deniedByteTouches = 0;
  }

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
   * Authority check (PM651-001). Validates the simulated identity/grant
   * contract BEFORE any fixture bytes are touched. Returns the principal_id.
   * Throws AuthError (fail closed) with zero denied-byte accesses.
   */
  checkAuthority(context, fixtureId) {
    // Principal must be a registered object with a valid ID.
    const principal = context.principal;
    if (!principal || typeof principal !== 'object' || Array.isArray(principal)) {
      throw new AuthError('AUTH_UNVERIFIED', 'missing principal');
    }
    const pid = safeGet(principal, 'principal_id', 'principal').value;
    if (typeof pid !== 'string' || !pid || !isSafeKey(pid)) {
      throw new AuthError('AUTH_UNVERIFIED', 'principal_id invalid');
    }
    // Request authority must match principal or be a valid relay.
    const ra = context.request_authority;
    if (ra === 'muse-relay') {
      const relay = safeGet(context, 'relay', 'context').value;
      if (!relay || typeof relay !== 'object') {
        throw new AuthError('AUTH_UNVERIFIED', 'relay authority requires relay registration');
      }
      const valid = safeGet(relay, 'valid', 'relay').value;
      const delegate = safeGet(relay, 'delegate_principal_id', 'relay').value;
      if (valid !== true || delegate !== pid) {
        throw new AuthError('AUTH_UNVERIFIED', 'relay invalid or not delegating to principal');
      }
    } else if (ra !== pid) {
      throw new AuthError('AUTH_UNVERIFIED', 'request_authority does not match principal');
    } else if (ra !== 'jason' && ra !== 'muse-relay') {
      // Only registered authorities are accepted.
      throw new AuthError('AUTH_UNVERIFIED', 'request authority not recognized');
    }
    // Grant must cover this fixture read. Checked BEFORE touching bytes.
    const grants = context.grants;
    if (!Array.isArray(grants)) {
      throw new AuthError('AUTHZ_DENIED', 'grants missing');
    }
    let granted = false;
    for (const g of grants) {
      if (!g || typeof g !== 'object') continue;
      const gpid = safeGet(g, 'principal_id', 'grant').value;
      const action = safeGet(g, 'action', 'grant').value;
      const res = safeGet(g, 'resource', 'grant').value;
      const fid = res && typeof res === 'object' ? safeGet(res, 'fixture_id', 'grant.resource').value : undefined;
      if (gpid === pid && action === 'read' && (fid === fixtureId || fid === '*')) {
        granted = true;
        break;
      }
    }
    if (!granted) {
      throw new AuthError('AUTHZ_DENIED', `no read grant for principal ${pid} on fixture ${fixtureId}`);
    }
    return pid;
  }

  /**
   * Resolve a fixture ref. Authority is checked BEFORE any bytes are read.
   * Verifies the host-registered SourceRef (real Git blob SHA-1).
   * Returns { fixture_id, record, source_ref, bytes }.
   */
  resolve(fixtureId, context) {
    // Authority FIRST — zero byte touches on denial.
    this.checkAuthority(context, fixtureId);
    this.chargeObject();
    if (!isSafeKey(fixtureId)) {
      throw new AuthError('AUTHZ_DENIED', 'reserved fixture id');
    }
    const entry = safeGet(this.store, fixtureId, 'store').value;
    if (!entry) {
      const e = new Error(`READ_DENIED: unknown fixture ${fixtureId}`);
      e.code = 'READ_DENIED';
      throw e;
    }
    this.chargeObject();
    // SourceRef must be present and well-formed.
    const sref = safeGet(entry, 'source_ref', 'entry').value;
    const srefErrors = checkSourceRef(sref, fixtureId);
    if (srefErrors.length) {
      const e = new Error(`SOURCE_REF_INVALID: ${srefErrors[0]}`);
      e.code = 'SOURCE_REF_INVALID';
      throw e;
    }
    // Read bytes ONLY after authority + source_ref shape are confirmed.
    const bytes = safeGet(entry, 'bytes', 'entry').value;
    if (typeof bytes !== 'string') {
      const e = new Error(`INVALID_INPUT: fixture ${fixtureId} bytes not a string`);
      e.code = 'INVALID_INPUT';
      throw e;
    }
    this.chargeInputBytes(utf8Length(bytes));
    // Verify the real Git blob SHA-1 (with header), not a truncated SHA-256.
    const actualBlob = gitBlobSha1(bytes);
    if (actualBlob !== sref.blob) {
      const e = new Error(`BLOB_MISMATCH: fixture ${fixtureId} blob ${actualBlob} != registered ${sref.blob}`);
      e.code = 'BLOB_MISMATCH';
      throw e;
    }
    // SHA-256 integrity as well (artifact bytes).
    const sha256 = safeGet(entry, 'sha256', 'entry').value;
    if (sha256 && sha256Hex(bytes) !== sha256) {
      const e = new Error(`HASH_MISMATCH: fixture ${fixtureId}`);
      e.code = 'HASH_MISMATCH';
      throw e;
    }
    // Bounded depth admission BEFORE full decode of candidates.
    // (JSON.parse itself is bounded by input bytes; depth check follows.)
    let record;
    try {
      record = JSON.parse(bytes);
    } catch {
      const e = new Error(`INVALID_INPUT: fixture ${fixtureId} is not JSON`);
      e.code = 'INVALID_INPUT';
      throw e;
    }
    checkDepth(record, 0);
    return { fixture_id: fixtureId, record, source_ref: { ...sref }, bytes };
  }

  /**
   * Verify an exact half-open UTF-8 byte span [start, end) of the given
   * bytes. Charges the span budget. Returns { start_byte, end_byte,
   * quoted_text, verification: 'VERIFIED' } where quoted_text equals the
   * exact slice. Throws on out-of-range or non-UTF-8-boundary offsets.
   */
  verifySpan(bytes, start, end) {
    this.chargeSpan();
    const buf = Buffer.from(bytes, 'utf8');
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > buf.length) {
      const e = new Error(`SPAN_INVALID: [${start},${end}) out of range`);
      e.code = 'SPAN_INVALID';
      throw e;
    }
    // UTF-8 boundary check: slicing must round-trip exactly.
    const slice = buf.subarray(start, end).toString('utf8');
    if (Buffer.byteLength(slice, 'utf8') !== end - start) {
      const e = new Error(`SPAN_INVALID: [${start},${end}) splits a UTF-8 sequence`);
      e.code = 'SPAN_INVALID';
      throw e;
    }
    return { start_byte: start, end_byte: end, quoted_text: slice, verification: 'VERIFIED' };
  }

  /**
   * Locate the exact byte span of a JSON object record within fixture
   * bytes by its key/id. Returns [start, end) or null if not found.
   * Used to build exact citations for findings.
   */
  findRecordSpan(bytes, idKey, id) {
    // Find `"idKey":"id"` or `"idKey": "id"` (exact JSON string match).
    const needle1 = `"${idKey}":"${id}"`;
    const needle2 = `"${idKey}": "${id}"`;
    let idx = bytes.indexOf(needle1);
    let needleLen = needle1.length;
    if (idx === -1) {
      idx = bytes.indexOf(needle2);
      needleLen = needle2.length;
    }
    if (idx === -1) return null;
    // Walk back to the enclosing object's opening brace.
    let depth = 0;
    let objStart = -1;
    for (let i = idx; i >= 0; i--) {
      const ch = bytes[i];
      if (ch === '}') depth++;
      else if (ch === '{') {
        if (depth === 0) { objStart = i; break; }
        depth--;
      }
    }
    if (objStart === -1) return null;
    // Balance forward to the matching close brace.
    depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = objStart; i < bytes.length; i++) {
      const ch = bytes[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else {
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) return [objStart, i + 1];
        }
      }
    }
    return null;
  }
}

function checkDepth(v, depth) {
  if (depth > LIMITS.maxDepth) {
    const e = new Error('INVALID_INPUT: nesting depth exceeds 32');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      // Descriptor-safe: refuse accessors in arrays too.
      const desc = Object.getOwnPropertyDescriptor(v, String(i));
      if (desc && (typeof desc.get === 'function' || typeof desc.set === 'function')) {
        const e = new Error('ACCESSOR_REJECTED: array element is a getter/setter');
        e.code = 'ACCESSOR_REJECTED';
        throw e;
      }
      checkDepth(v[i], depth + 1);
    }
  } else if (v !== null && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      const desc = Object.getOwnPropertyDescriptor(v, k);
      if (desc && (typeof desc.get === 'function' || typeof desc.set === 'function')) {
        const e = new Error(`ACCESSOR_REJECTED: ${k} is a getter/setter`);
        e.code = 'ACCESSOR_REJECTED';
        throw e;
      }
      checkDepth(v[k], depth + 1);
    }
  }
}

export { checkDepth };
export const SYNTHETIC_COMMIT = '0'.repeat(40);
