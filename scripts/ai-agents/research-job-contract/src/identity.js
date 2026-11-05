/**
 * identity.js — deterministic identity for P1-A jobs, runs, and items.
 *
 * - definitionHash: SHA-256 of the canonical validated definition. A
 *   version change (or any definition change) changes the hash, which
 *   is how a stale preview is detected: a receipt bound to hash H is
 *   stale for any definition whose hash is not H.
 * - run_id: derived from the definition hash + an explicit preview
 *   invocation id. The same (job version, invocation id) pair always
 *   yields the same run id, so a duplicate invocation cannot
 *   double-create decision items; a new invocation id yields a new run.
 * - item_key: derived from job id, run id, claim text, and citation
 *   byte identity, so identical content in one run has one key and
 *   distinct content has distinct keys. Keys are run-scoped by design:
 *   decisions bind to immutable item/run identity, and a fresh preview
 *   invocation starts a fresh decision set rather than silently
 *   inheriting decisions from an earlier run.
 * Pure Node 24 ESM, zero deps.
 */

import { canonicalStringify, sha256Hex } from "./canonical.js";
import { CODES, refuse } from "./errors.js";
import { validateJobDefinition } from "./jobDefinition.js";

const INVOCATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function validateInvocationId(invocationId) {
  if (typeof invocationId !== "string" || !INVOCATION_ID_RE.test(invocationId)) {
    refuse(CODES.BAD_INVOCATION, "invocation_id must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}");
  }
  return invocationId;
}

/** SHA-256 of the canonical validated definition. */
export function definitionHash(definition) {
  const validated = validateJobDefinition(definition);
  return sha256Hex(canonicalStringify(validated));
}

/** Deterministic run id for one (definition hash, invocation id) pair. */
export function deriveRunId(defHash, invocationId) {
  validateInvocationId(invocationId);
  if (typeof defHash !== "string" || !/^[0-9a-f]{64}$/.test(defHash)) {
    refuse(CODES.BAD_JOB, "definition hash must be a 64-hex SHA-256 digest");
  }
  return `run-${sha256Hex(`${defHash}|${invocationId}`).slice(0, 32)}`;
}

/** Deterministic item key for one item's content within one run. */
export function itemKey({ job_id, run_id, claim, evidence_sha256 }) {
  if (typeof job_id !== "string" || job_id.length === 0) refuse(CODES.BAD_JOB, "itemKey requires job_id");
  if (typeof run_id !== "string" || run_id.length === 0) refuse(CODES.BAD_JOB, "itemKey requires run_id");
  if (typeof claim !== "string" || claim.length === 0) refuse(CODES.BAD_JOB, "itemKey requires a non-empty claim");
  if (typeof evidence_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(evidence_sha256)) {
    refuse(CODES.BAD_JOB, "itemKey requires a 64-hex evidence_sha256");
  }
  return `item-${sha256Hex(canonicalStringify({ job_id, run_id, claim, evidence_sha256 })).slice(0, 32)}`;
}

/** True iff a preview receipt was computed under a different definition than the one given. */
export function isPreviewStale(receipt, definition) {
  if (!receipt || typeof receipt.definition_hash !== "string") return true;
  return receipt.definition_hash !== definitionHash(definition);
}
