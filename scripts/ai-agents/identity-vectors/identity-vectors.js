/**
 * identity-vectors.js — Unambiguous operation-identity fixture vectors.
 *
 * FORGE-P-20261021-CHATGPT-IDENTITY-TUPLE-VECTORS (ChatGPT, 2026-10-21;
 * bundle row 15). Three-agent agreement 2026-10-22: ChatGPT AGREE (Muse
 * conditions 1-4 + Claude condition 5 adopted in full); Muse AGREE WITH
 * CONDITIONS; Claude AGREE WITH CONDITIONS. Reaffirmed 10-24 / 10-27;
 * Oct 30 bundle review row 15: AGREE. Jason triaged Nov 22 (build rows
 * 1, 3-28). Doc + fixtures only — no shared runtime encoder, no encoding
 * standard, no migration, no activation, no live data, no spend.
 *
 * Motivation (the real failure): Team Brain #636 retention keys joined
 * with colons collapsed distinct attribution — and even distinct
 * obligations — into a false successful replay. The reviewed fix needs
 * reusable collision cases. Vector V-13 is that failure in miniature.
 *
 * What this pack is: synthetic fixture vectors + a small harness that
 * runs them against ANY encoder function an adopting module supplies.
 * Each adopting module COPIES/ADAPTS this pack into its own harness and
 * never imports it at runtime (same binding as the 2026-10-16
 * budget-sentinel pack). The pack tests identity; it never sets the
 * encoding standard — delimiter-escaping vs length-prefix vs structured
 * encoding stays a per-module, reviewer-adjudicated decision, and each
 * adoption is separately reviewed.
 *
 * Two layers:
 *   1. KEY_VECTORS + checkEncoder(encode): pure key-equality vectors.
 *      Two operation tuples (a, b) and an expectation (SAME for an exact
 *      retry, DISTINCT for everything else). A correct encoder must
 *      produce the same key for the same tuple and different keys for
 *      different tuples.
 *   2. LEDGER_SCENARIOS + checkLedger(encode): behaviour vectors through
 *      OperationLedger, a fixture-only in-memory model of a public
 *      entrypoint (submit -> INSERTED / DUPLICATE / CONFLICT /
 *      TAMPERED_BINDING, with monotonic event versions). This exercises
 *      event/version effects: an exact retry resolves to the original
 *      event version, a changed payload under the same key is refused,
 *      and a tampered stored binding is refused, never silently matched.
 *
 * The ledger binds every stored event to BOTH its key and its canonical
 * payload hash (sha256 of canonical JSON, mirroring the real
 * canonical_payload_sha256 column on team_brain.obligation_events).
 * That dual binding is what makes the tamper case detectable even when
 * the mutation preserves the joined key string (scenario L-04b): the key
 * alone cannot see it, the payload hash can.
 *
 * Node builtins only. No imports from anywhere else in the repo.
 */

import { createHash } from "node:crypto";

/** The bound field set, in canonical order. Encoders read these fields. */
export const BOUND_FIELDS = [
  "obligation",
  "actor",
  "reason",
  "recordedAt",
  "kind",
  "repo",
  "path",
  "head",
  "state",
  "owner",
  "evidence",
];

/** One synthetic, fully-bound operation tuple. All identifiers synthetic. */
export const BASE_TUPLE = Object.freeze({
  obligation: "obl-X1",
  actor: "actor-X",
  reason: "reason-X",
  recordedAt: "2026-10-21T15:00:00.000Z",
  kind: "RETENTION_DECIDED",
  repo: "onyxgolden/marketplace409",
  path: "scripts/team-brain/postgres/repository.mjs",
  head: "05138d862dbf439bc2085428e50292ec1edd9417",
  state: "open",
  owner: "owner-X",
  evidence: "ev-X1",
});

const T = BASE_TUPLE.recordedAt;

/**
 * Key vectors. `expect` is "SAME" only for the exact-retry positive
 * control; every other vector expects DISTINCT. `catches` names the
 * broken encoder class the vector is designed to expose.
 */
export const KEY_VECTORS = [
  {
    id: "V-01",
    name: "delimiter-collision/actor-reason",
    category: "delimiter-collision",
    a: { ...BASE_TUPLE, actor: "actor-A:x", reason: "r-1" },
    b: { ...BASE_TUPLE, actor: "actor-A", reason: "x:r-1" },
    expect: "DISTINCT",
    catches: "bare delimiter join (colon-joined tuples)",
    note: "A colon in the actor plus a colon in the reason re-splits the joined string into the other tuple.",
  },
  {
    id: "V-02",
    name: "delimiter-collision/obligation-actor",
    category: "delimiter-collision",
    a: { ...BASE_TUPLE, obligation: "obl-1:x", actor: "actor-A" },
    b: { ...BASE_TUPLE, obligation: "obl-1", actor: "x:actor-A" },
    expect: "DISTINCT",
    catches: "bare delimiter join (colon-joined tuples)",
    note: "The boundary between obligation and actor moves; the joined string does not.",
  },
  {
    id: "V-03",
    name: "empty-vs-absent/reason",
    category: "empty-absent",
    a: { ...BASE_TUPLE, reason: "" },
    b: { ...BASE_TUPLE, reason: undefined },
    expect: "DISTINCT",
    catches: "encoders that coerce undefined to empty string",
    note: "An explicitly empty reason and a missing reason are different operations.",
  },
  {
    id: "V-04",
    name: "empty-vs-absent/actor",
    category: "empty-absent",
    a: { ...BASE_TUPLE, actor: "" },
    b: { ...BASE_TUPLE, actor: undefined },
    expect: "DISTINCT",
    catches: "encoders that coerce undefined to empty string",
    note: "Same class as V-03, on the actor field.",
  },
  {
    id: "V-05",
    name: "json-hostile/quotes",
    category: "json-hostile",
    a: { ...BASE_TUPLE, reason: 'say "hi"' },
    b: { ...BASE_TUPLE, reason: "say hi" },
    expect: "DISTINCT",
    catches: "encoders that strip or drop quote characters instead of escaping them",
    note: "Quotes are content, not framing. A quote-stripping encoder collapses this pair.",
  },
  {
    id: "V-06",
    name: "json-hostile/newline",
    category: "json-hostile",
    a: { ...BASE_TUPLE, reason: "line1\nline2" },
    b: { ...BASE_TUPLE, reason: "line1line2" },
    expect: "DISTINCT",
    catches: "encoders that strip or normalise newlines before encoding",
    note: "A newline inside a field must survive encoding; a newline-stripping encoder collapses this pair.",
  },
  {
    id: "V-07",
    name: "json-hostile/backslash-colons",
    category: "json-hostile",
    a: { ...BASE_TUPLE, reason: "a\\b:c" },
    b: { ...BASE_TUPLE, reason: "a:b\\c" },
    expect: "DISTINCT",
    catches: "encoders that treat backslash as an escape on decode without a matching escape on encode",
    note: "Backslash plus colons is the classic ambiguous-escaping trap: the two reasons must stay distinct.",
  },
  {
    id: "V-08",
    name: "unicode/non-ascii-fold",
    category: "unicode",
    a: { ...BASE_TUPLE, actor: "actor-café" },
    b: { ...BASE_TUPLE, actor: "actor-cafe" },
    expect: "DISTINCT",
    catches: "encoders that lossy-fold non-ASCII to ASCII",
    note: "Non-ASCII content is distinct content; folding it away creates collisions.",
  },
  {
    id: "V-09",
    name: "unicode/normalization-form",
    category: "unicode",
    a: { ...BASE_TUPLE, actor: "actor-café" }, // U+00E9, composed
    b: { ...BASE_TUPLE, actor: "actor-café" }, // e + U+0301, decomposed
    expect: "DISTINCT",
    catches: "encoders that Unicode-normalise before encoding",
    note: "Byte-distinct inputs. A module with an EXPLICIT, reviewed normalisation policy adapts this vector to SAME and documents the policy; the default expectation is DISTINCT.",
  },
  {
    id: "V-10",
    name: "binding/repo",
    category: "repo-path-head-actor-binding",
    a: { ...BASE_TUPLE },
    b: { ...BASE_TUPLE, repo: "onyxgolden/forge-ai-drop" },
    expect: "DISTINCT",
    catches: "encoders that drop the repo binding",
    note: "The same operation in a different repo is a different operation.",
  },
  {
    id: "V-11",
    name: "binding/head",
    category: "repo-path-head-actor-binding",
    a: { ...BASE_TUPLE },
    b: { ...BASE_TUPLE, head: "9808f5850da3993ca179efc6af67c22e6e678ed7" },
    expect: "DISTINCT",
    catches: "encoders that drop the head binding",
    note: "The same operation at a different reviewed head is a different operation.",
  },
  {
    id: "V-12",
    name: "binding/path",
    category: "repo-path-head-actor-binding",
    a: { ...BASE_TUPLE },
    b: { ...BASE_TUPLE, path: "scripts/team-brain/ledger/repository.mjs" },
    expect: "DISTINCT",
    catches: "encoders that drop the path binding",
    note: "The same operation against a different source path is a different operation.",
  },
  {
    id: "V-13",
    name: "exact-retry/positive-control",
    category: "exact-retry",
    a: { ...BASE_TUPLE },
    b: { ...BASE_TUPLE },
    expect: "SAME",
    catches: "nothing — this is the positive control",
    note: "An identical tuple MUST produce the same key, or legitimate retries break. The pack must not degenerate into refusing everything.",
  },
  {
    id: "V-14",
    name: "changed-payload/reason",
    category: "changed-payload",
    a: { ...BASE_TUPLE, reason: "r-1" },
    b: { ...BASE_TUPLE, reason: "r-2" },
    expect: "DISTINCT",
    catches: "encoders that drop the reason (or any payload field) from the key",
    note: "A changed payload under the same operation identity must be a conflict, never a silent replay.",
  },
  {
    id: "V-15",
    name: "cross-obligation-replay/#636",
    category: "cross-obligation",
    a: { ...BASE_TUPLE, obligation: "obl-1", actor: "actor-A:x", reason: "r-1" },
    b: { ...BASE_TUPLE, obligation: "obl-1:actor-A", actor: "x", reason: "r-1" },
    expect: "DISTINCT",
    catches: "bare delimiter join (colon-joined tuples) — the #636 failure",
    note: "THE motivating case: distinct obligations (obl-1 vs obl-1:actor-A) collapsing into one successful event. Under a colon join both tuples encode to the identical string, so the second operation replays as the first.",
  },
  {
    id: "V-16",
    name: "delimiter-collision/kind-repo",
    category: "delimiter-collision",
    a: { ...BASE_TUPLE, kind: "K:x" },
    b: { ...BASE_TUPLE, kind: "K", repo: "x:onyxgolden/marketplace409" },
    expect: "DISTINCT",
    catches: "bare delimiter join (colon-joined tuples)",
    note: "Extra colons in the kind move the kind/repo boundary (kind and repo are adjacent in the field order); the joined string does not move.",
  },
];

/** Sample encoder 1: the DELIBERATELY AMBIGUOUS encoder. Must fail V-01, V-02, V-03, V-04, V-15, V-16. */
export function colonJoinEncoder(fields) {
  return BOUND_FIELDS.map((f) => {
    const v = fields?.[f];
    return v === undefined || v === null ? "" : String(v);
  }).join(":");
}

/** Sample encoder 2: length-prefixed framing. Must pass every key vector. */
export function lengthPrefixEncoder(fields) {
  return BOUND_FIELDS.map((f) => {
    const v = fields?.[f];
    if (v === undefined || v === null) return "#";
    const s = String(v);
    return `${Buffer.byteLength(s, "utf8")}:${s}`;
  }).join("|");
}

/** Canonical JSON: object keys sorted recursively, so equal payloads hash equal. */
export function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(",")}}`;
}

/** sha256 of the canonical payload — the fixture analogue of canonical_payload_sha256. */
export function canonicalPayloadHash(fields) {
  return createHash("sha256").update(canonicalStringify(fields ?? {}), "utf8").digest("hex");
}

/**
 * Run every key vector against `encode(fields) -> string`.
 * An encoder that throws on a vector's input fails that vector (recorded
 * with the error) instead of crashing the run.
 */
export function checkEncoder(encode) {
  const results = KEY_VECTORS.map((v) => {
    let keyA = null;
    let keyB = null;
    let error = null;
    try {
      keyA = encode(v.a);
      keyB = encode(v.b);
    } catch (err) {
      error = String((err && err.message) || err);
    }
    const same = error === null && keyA === keyB;
    const pass = error === null && (v.expect === "SAME" ? same : !same);
    return { id: v.id, name: v.name, category: v.category, expect: v.expect, pass, keyA, keyB, error };
  });
  const passed = results.filter((r) => r.pass).length;
  return { results, passed, failed: results.length - passed, total: results.length };
}

/**
 * OperationLedger — fixture-only in-memory model of a public entrypoint
 * that records operations under an operation-identity key.
 *
 * submit({ fields, idempotencyKey }) -> one of:
 *   INSERTED         — new event recorded (version = monotonic count)
 *   DUPLICATE        — same key AND same payload: exact retry, resolves
 *                      to the ORIGINAL event version, no new event
 *   CONFLICT         — same key, different payload: refused, no new event
 *   TAMPERED_BINDING — the stored row no longer matches its own recorded
 *                      key/payload binding: refused, never silently matched
 *
 * When idempotencyKey is absent the key is derived with the supplied
 * encoder — that is the path the cross-obligation vector exercises.
 * `tamper(key, mutate)` is test-only: it simulates an admin directly
 * mutating one bound field on an already-stored event, WITHOUT
 * recomputing the stored key or payload hash (exactly the mutation the
 * real store would see from a direct DB edit).
 */
export class OperationLedger {
  constructor(encode) {
    if (typeof encode !== "function") throw new Error("OperationLedger needs an encoder function");
    this.encode = encode;
    this.events = [];
    this.byKey = new Map();
  }

  submit(op) {
    const fields = op?.fields ?? {};
    const explicitKey = op?.idempotencyKey ?? null;
    const key = explicitKey ?? this.encode(fields);
    const payloadHash = canonicalPayloadHash(fields);
    const existing = this.byKey.get(key);
    if (existing) {
      // Integrity first: does the stored row still match its own binding?
      // The payload hash always binds the stored fields. The key binds
      // them only when the key was DERIVED from the fields — an explicit
      // caller-supplied key is not a function of the fields, so
      // recomputing the encoder against it would be a false tamper.
      const storedHashNow = canonicalPayloadHash(existing.fields);
      const storedKeyNow = existing.keySource === "derived" ? this.encode(existing.fields) : existing.key;
      if (storedHashNow !== existing.payloadHash || storedKeyNow !== existing.key) {
        return { outcome: "TAMPERED_BINDING", event: existing };
      }
      if (existing.payloadHash === payloadHash) {
        return { outcome: "DUPLICATE", event: existing };
      }
      return { outcome: "CONFLICT", event: existing };
    }
    const event = {
      version: this.events.length + 1,
      key,
      keySource: explicitKey === null ? "derived" : "explicit",
      payloadHash,
      fields: { ...fields },
    };
    this.events.push(event);
    this.byKey.set(key, event);
    return { outcome: "INSERTED", event };
  }

  tamper(key, mutate) {
    const event = this.byKey.get(key);
    if (!event) throw new Error(`no stored event for key ${String(key)}`);
    mutate(event.fields);
    return event;
  }

  get eventCount() {
    return this.events.length;
  }
}

/**
 * Ledger scenarios. Each takes a fresh ledger and returns { id, name,
 * pass, detail }. `expect` is the required outcome (or outcomes) — a
 * scenario passes only when the ledger refuses exactly where it must
 * and accepts exactly where it must.
 */
export const LEDGER_SCENARIOS = [
  {
    id: "L-01",
    name: "exact-retry-resolves-to-original-version",
    run(ledger) {
      const first = ledger.submit({ fields: { ...BASE_TUPLE } });
      const retry = ledger.submit({ fields: { ...BASE_TUPLE } });
      const pass =
        first.outcome === "INSERTED" &&
        first.event.version === 1 &&
        retry.outcome === "DUPLICATE" &&
        retry.event.version === 1 &&
        ledger.eventCount === 1;
      return { pass, detail: `first=${first.outcome} v${first.event.version}, retry=${retry.outcome} v${retry.event.version}, events=${ledger.eventCount}` };
    },
  },
  {
    id: "L-02",
    name: "changed-payload-under-same-key-is-conflict",
    run(ledger) {
      const first = ledger.submit({ idempotencyKey: "op-X1", fields: { ...BASE_TUPLE, reason: "r-1" } });
      const changed = ledger.submit({ idempotencyKey: "op-X1", fields: { ...BASE_TUPLE, reason: "r-2" } });
      const pass = first.outcome === "INSERTED" && changed.outcome === "CONFLICT" && ledger.eventCount === 1;
      return { pass, detail: `first=${first.outcome}, changed=${changed.outcome}, events=${ledger.eventCount}` };
    },
  },
  {
    id: "L-03",
    name: "cross-obligation-replay-never-falsely-succeeds",
    run(ledger) {
      const a = ledger.submit({ fields: { ...BASE_TUPLE, obligation: "obl-1", actor: "actor-A:x", reason: "r-1" } });
      const b = ledger.submit({ fields: { ...BASE_TUPLE, obligation: "obl-1:actor-A", actor: "x", reason: "r-1" } });
      // Safe outcomes only: a distinct key inserts (good encoder), or a
      // colliding key is refused as CONFLICT (ambiguous encoder). A
      // DUPLICATE here would be the #636 false successful replay.
      const pass =
        a.outcome === "INSERTED" &&
        (b.outcome === "INSERTED" || b.outcome === "CONFLICT") &&
        b.outcome !== "DUPLICATE";
      return { pass, detail: `first=${a.outcome}, second=${b.outcome}, events=${ledger.eventCount}` };
    },
  },
  {
    id: "L-04a",
    name: "tampered-stored-binding/plain-mutation-refused",
    run(ledger) {
      const first = ledger.submit({ fields: { ...BASE_TUPLE } });
      ledger.tamper(first.event.key, (fields) => {
        fields.reason = "reason-TAMPERED";
      });
      const replay = ledger.submit({ fields: { ...BASE_TUPLE } });
      const pass = first.outcome === "INSERTED" && replay.outcome === "TAMPERED_BINDING" && ledger.eventCount === 1;
      return { pass, detail: `first=${first.outcome}, replay-after-tamper=${replay.outcome}, events=${ledger.eventCount}` };
    },
  },
  {
    id: "L-04b",
    name: "tampered-stored-binding/key-preserving-mutation-refused",
    run(ledger) {
      // Mutation chosen so the colon-joined key is UNCHANGED
      // (actor "actor-A:x" + reason "r-1" -> actor "actor-A" + reason
      // "x:r-1"): the key alone cannot see it; only the payload hash can.
      const first = ledger.submit({
        fields: { ...BASE_TUPLE, obligation: "obl-1", actor: "actor-A:x", reason: "r-1" },
      });
      ledger.tamper(first.event.key, (fields) => {
        fields.actor = "actor-A";
        fields.reason = "x:r-1";
      });
      const replay = ledger.submit({
        fields: { ...BASE_TUPLE, obligation: "obl-1", actor: "actor-A:x", reason: "r-1" },
      });
      const pass = first.outcome === "INSERTED" && replay.outcome === "TAMPERED_BINDING" && ledger.eventCount === 1;
      return { pass, detail: `first=${first.outcome}, replay-after-tamper=${replay.outcome}, events=${ledger.eventCount}` };
    },
  },
  {
    id: "L-05",
    name: "version-effect/replay-resolves-to-original-not-latest",
    run(ledger) {
      const op1 = { ...BASE_TUPLE, obligation: "obl-1" };
      const op2 = { ...BASE_TUPLE, obligation: "obl-2" };
      const first = ledger.submit({ fields: op1 });
      const second = ledger.submit({ fields: op2 });
      const replay = ledger.submit({ fields: op1 });
      const pass =
        first.event.version === 1 &&
        second.event.version === 2 &&
        replay.outcome === "DUPLICATE" &&
        replay.event.version === 1 &&
        ledger.eventCount === 2;
      return { pass, detail: `v1=${first.event.version}, v2=${second.event.version}, replay=${replay.outcome} v${replay.event.version}, events=${ledger.eventCount}` };
    },
  },
];

/** Run every ledger scenario against a fresh ledger built on `encode`. */
export function checkLedger(encode) {
  const results = LEDGER_SCENARIOS.map((s) => {
    const ledger = new OperationLedger(encode);
    let outcome;
    try {
      outcome = s.run(ledger);
    } catch (err) {
      outcome = { pass: false, detail: `threw: ${String((err && err.message) || err)}` };
    }
    return { id: s.id, name: s.name, pass: outcome.pass, detail: outcome.detail };
  });
  const passed = results.filter((r) => r.pass).length;
  return { results, passed, failed: results.length - passed, total: results.length };
}
