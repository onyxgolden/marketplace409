/**
 * preview.js — pure synthetic preview builder (P1-A).
 *
 * buildPreview() turns a validated job definition + a synthetic
 * fixture corpus into a JobRunReceiptV1 + WorkbenchItemV1 list. It is
 * the ONLY preview path in this slice, and it is deliberately narrow:
 *
 * - No transport, no store, no routes, no UI: it returns data. P1-B
 *   maps these objects onto the P2a private Workbench store; P1-C
 *   renders them. Nothing here writes anywhere.
 * - No live calls: fixture corpora are the only source. A corpus id
 *   outside the job's allowed list, or named in exclusions, refuses
 *   before any item is read.
 * - Budgets are enforced BEFORE each next item is touched: items are
 *   consumed in order, and the first item that would exceed the item
 *   or byte cap refuses the whole preview (no partial receipt, no
 *   totals from a partially consumed corpus, no touch of the tail).
 *   Admission is bounded and per-index: each item is descriptor-gated,
 *   validated, then budget-checked before the next index is read, so
 *   items past a refusal point are never read, hashed, or validated.
 *   The fixture-set hash is computed AFTER the loop from the admitted
 *   normalized items only — never from the raw corpus.
 * - Corpus and item validation is descriptor-safe: Proxies, accessors,
 *   and custom prototypes refuse with a named JobRefusal instead of
 *   invoking a trap, so untrusted fixture input cannot execute code
 *   or throw a non-refusal error through the preview path.
 * - The job stays DISABLED: the receipt carries job_status DISABLED
 *   and invocation mode SYNTHETIC_PREVIEW as separate fields. A
 *   preview never converts a job to scheduled or live.
 * - Empty corpora produce a meaningful empty claim and zero items —
 *   never invented items.
 * - Every item starts PENDING. Accept/reject transitions live in the
 *   P1-B decision adapter, not here: this slice proves item identity
 *   and initial state, not transitions.
 *
 * Item kinds distinguish fact, inference, and proposal, as the brief
 * requires. Citation-byte identity is SHA-256 over the excerpt's UTF-8
 * bytes — the same bytes hashed the same way always give the same id.
 * Pure Node 24 ESM, zero deps.
 */

import { types } from "node:util";
import { canonicalStringify, sha256Hex, sha256Bytes } from "./canonical.js";
import { CODES, refuse } from "./errors.js";
import { validateJobDefinition } from "./jobDefinition.js";
import { RunBudget } from "./budget.js";
import { definitionHash, deriveRunId, itemKey, validateInvocationId } from "./identity.js";

export const ITEM_KINDS = Object.freeze(["fact", "inference", "proposal"]);
const CORPUS_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_EXCERPT_BYTES = 64 * 1024;
const MAX_TEXT_FIELD_BYTES = 4096;
const UTC_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Trap-free plain-data gate, SHALLOW by design: checks this object's own
 * shape (Proxy, prototype, accessors, function/symbol values, symbol
 * keys) without recursing into property values, so gating a container
 * never reads the values it contains. The corpus wrapper is gated this
 * way; the items array gets only its Proxy/prototype checks up front
 * and a per-index descriptor gate inside the loop, so a forbidden tail
 * is never even enumerated. Individual items are gated here before any
 * field is read. Descriptor reads never invoke getters: a Proxy is
 * refused before any descriptor is read, and on a non-proxy object a
 * descriptor read is trap-free.
 */
function assertPlainDataShallow(value, where, code) {
  if (value === null || typeof value !== "object") return;
  if (types.isProxy(value)) refuse(code, `native Proxy at '${where}' is not plain data`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) {
    refuse(code, `unsupported prototype at '${where}'`);
  }
  for (const k of Object.getOwnPropertyNames(value)) {
    const desc = Object.getOwnPropertyDescriptor(value, k);
    if (!desc) continue;
    if (typeof desc.get === "function" || typeof desc.set === "function") {
      refuse(code, `accessor property '${where}.${k}' is not plain data`);
    }
    if (typeof desc.value === "function" || typeof desc.value === "symbol") {
      refuse(code, `non-data property '${where}.${k}' is not plain data`);
    }
  }
  for (const s of Object.getOwnPropertySymbols(value)) {
    refuse(code, `symbol-keyed property at '${where}' is not plain data`);
  }
}

/** Descriptor read: never invokes a getter (accessors refuse outright). */
function fieldValue(obj, key, where) {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (desc === undefined) return undefined;
  if (typeof desc.get === "function" || typeof desc.set === "function") {
    refuse(CODES.BAD_CORPUS, `accessor property '${where}.${key}' is not plain data`);
  }
  return desc.value;
}

function reqText(obj, key, where, { maxBytes, allowEmpty = false }) {
  const v = fieldValue(obj, key, where);
  if (typeof v !== "string" || (!allowEmpty && v.length === 0)) {
    refuse(CODES.BAD_CORPUS, `'${where}.${key}' must be a ${allowEmpty ? "" : "non-empty "}string`);
  }
  if (Buffer.byteLength(v, "utf8") > maxBytes) {
    refuse(CODES.BAD_CORPUS, `'${where}.${key}' exceeds ${maxBytes} bytes`);
  }
  return v;
}

function optText(obj, key, where, maxBytes) {
  const v = fieldValue(obj, key, where);
  if (v === undefined) return "";
  return reqText(obj, key, where, { maxBytes, allowEmpty: true });
}

/** Validate one fixture item's shape. Returns normalized fields. */
export function validateFixtureItem(raw, where) {
  assertPlainDataShallow(raw, where, CODES.BAD_CORPUS);
  if (!isPlainObject(raw)) refuse(CODES.BAD_CORPUS, `${where} must be an object`);
  for (const k of Object.keys(raw)) {
    if (!["claim", "evidence_excerpt", "kind", "uncertainty", "limitations", "recommendation", "proposed_action"].includes(k)) {
      refuse(CODES.BAD_CORPUS, `unknown fixture item property '${k}' at '${where}'`);
    }
  }
  const claim = reqText(raw, "claim", where, { maxBytes: MAX_TEXT_FIELD_BYTES });
  const evidence_excerpt = reqText(raw, "evidence_excerpt", where, { maxBytes: MAX_EXCERPT_BYTES });
  if (!ITEM_KINDS.includes(raw.kind)) {
    refuse(CODES.BAD_CORPUS, `${where}.kind must be one of ${ITEM_KINDS.join(", ")}`);
  }
  return {
    claim,
    evidence_excerpt,
    kind: raw.kind,
    uncertainty: optText(raw, "uncertainty", where, MAX_TEXT_FIELD_BYTES),
    limitations: optText(raw, "limitations", where, MAX_TEXT_FIELD_BYTES),
    recommendation: optText(raw, "recommendation", where, MAX_TEXT_FIELD_BYTES),
    proposed_action: optText(raw, "proposed_action", where, MAX_TEXT_FIELD_BYTES),
  };
}

/** UTF-8 byte size charged for one normalized item (every string field). */
export function itemByteSize(item) {
  return ["claim", "evidence_excerpt", "kind", "uncertainty", "limitations", "recommendation", "proposed_action"]
    .reduce((n, k) => n + Buffer.byteLength(item[k] ?? "", "utf8"), 0);
}

/**
 * Build a synthetic preview.
 *
 * @param {object} args
 * @param {object} args.definition - JobDefinitionV1 (validated inside).
 * @param {string} args.invocation_id - explicit preview invocation id.
 * @param {string} args.actor - operator running the preview (audit).
 * @param {object} args.corpus - { corpus_id, items: [fixture items] }.
 * @param {string} [args.now] - UTC instant for the receipt (defaults to
 *   current time; tests pass a fixed instant for determinism).
 * @returns {{ receipt: object, items: object[] }}
 */
export function buildPreview({ definition, invocation_id, actor, corpus, now }) {
  const def = validateJobDefinition(definition);
  validateInvocationId(invocation_id);
  if (typeof actor !== "string" || actor.length === 0 || Buffer.byteLength(actor, "utf8") > 256) {
    refuse(CODES.BAD_INVOCATION, "actor must be a non-empty string of at most 256 bytes");
  }
  const instant = now === undefined ? new Date().toISOString() : now;
  if (typeof instant !== "string" || !UTC_INSTANT_RE.test(instant) || Number.isNaN(Date.parse(instant))) {
    refuse(CODES.BAD_INVOCATION, "now must be an explicit UTC instant (Zulu)");
  }

  // Corpus admission is bounded and descriptor-safe: the wrapper is
  // shallow-gated (no value reads), the id and items are read via
  // descriptors, and the items array is Proxy/prototype-gated before
  // the loop. Nothing here serializes or traverses the raw corpus.
  assertPlainDataShallow(corpus, "corpus", CODES.BAD_CORPUS);
  if (!isPlainObject(corpus)) refuse(CODES.BAD_CORPUS, "corpus must be an object");
  for (const k of Object.keys(corpus)) {
    if (k !== "corpus_id" && k !== "items") refuse(CODES.BAD_CORPUS, `unknown corpus property '${k}'`);
  }
  const corpusId = fieldValue(corpus, "corpus_id", "corpus");
  if (typeof corpusId !== "string" || !CORPUS_ID_RE.test(corpusId)) {
    refuse(CODES.BAD_CORPUS, "corpus.corpus_id must be a slug");
  }
  if (!def.allowed_source_corpus_ids.includes(corpusId)) {
    refuse(CODES.MISSING_SOURCE_AUTHORIZATION, `corpus '${corpusId}' is not in the job's allowed_source_corpus_ids`);
  }
  if (def.exclusions.includes(corpusId)) {
    refuse(CODES.EXCLUDED_CORPUS, `corpus '${corpusId}' is named in the job's exclusions`);
  }
  const itemsValue = fieldValue(corpus, "items", "corpus");
  if (types.isProxy(itemsValue)) refuse(CODES.BAD_CORPUS, "native Proxy at 'corpus.items' is not plain data");
  if (!Array.isArray(itemsValue)) refuse(CODES.BAD_CORPUS, "corpus.items must be an array");
  const itemsProto = Object.getPrototypeOf(itemsValue);
  if (itemsProto !== Array.prototype && itemsProto !== null) {
    refuse(CODES.BAD_CORPUS, "unsupported prototype at 'corpus.items'");
  }

  const defHash = definitionHash(def);
  const runId = deriveRunId(defHash, invocation_id);
  const budget = new RunBudget(def.budget);

  // Consume in order; the first item that would exceed a cap refuses
  // the whole preview BEFORE that item is included or counted. Items
  // past the refusal point are never read: each index is descriptor-
  // gated, then validated, then budget-checked, and the loop throws
  // before the next index is touched.
  const items = [];
  const admitted = [];
  for (let i = 0; i < itemsValue.length; i++) {
    const desc = Object.getOwnPropertyDescriptor(itemsValue, String(i));
    if (desc === undefined) refuse(CODES.BAD_CORPUS, `corpus.items[${i}] is missing`);
    if (typeof desc.get === "function" || typeof desc.set === "function") {
      refuse(CODES.BAD_CORPUS, `accessor property 'corpus.items[${i}]' is not plain data`);
    }
    if (typeof desc.value === "function" || typeof desc.value === "symbol") {
      refuse(CODES.BAD_CORPUS, `non-data property 'corpus.items[${i}]' is not plain data`);
    }
    const raw = itemsValue[i];
    const item = validateFixtureItem(raw, `corpus.items[${i}]`);
    const bytes = itemByteSize(item);
    if (!budget.fits("items", 1) || !budget.fits("bytes", bytes)) {
      refuse(CODES.BUDGET_EXCEEDED, `item ${i} would exceed the per-run budget (items ${budget.used.items}/${def.budget.max_items_per_run}, bytes ${budget.used.bytes}/${def.budget.max_bytes_per_run})`);
    }
    budget.consumeItem();
    budget.consumeBytes(bytes);
    admitted.push(item);
    const evidenceSha = sha256Bytes(Buffer.from(item.evidence_excerpt, "utf8"));
    items.push({
      item_key: itemKey({ job_id: def.job_id, run_id: runId, claim: item.claim, evidence_sha256: evidenceSha }),
      index: i,
      claim: item.claim,
      evidence_excerpt: item.evidence_excerpt,
      evidence_sha256: evidenceSha,
      kind: item.kind,
      uncertainty: item.uncertainty,
      limitations: item.limitations,
      recommendation: item.recommendation,
      proposed_action: item.proposed_action,
      decision_status: "PENDING",
    });
  }

  // Admitted-only fixture-set hash: corpus id + normalized admitted
  // items, computed after the loop. It is invocation-independent (the
  // same fixture set hashes the same under any invocation) and
  // tail-independent (a refused run produces no receipt at all, and
  // items past a refusal point never reach this hash).
  const fixtureSetHash = sha256Hex(canonicalStringify({ corpus_id: corpusId, items: admitted }));

  const receipt = {
    run_id: runId,
    job_id: def.job_id,
    job_version: def.version,
    definition_hash: defHash,
    fixture_set_hash: fixtureSetHash,
    invocation_id,
    actor,
    mode: "SYNTHETIC_PREVIEW",
    job_status: "DISABLED",
    created_at: instant,
    budget: budget.receipt(),
    item_count: items.length,
    empty_claim: items.length === 0 ? `No synthetic items in corpus '${corpusId}' for this preview.` : null,
  };
  return { receipt, items };
}
