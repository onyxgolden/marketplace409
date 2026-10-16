/**
 * citations.js — verified evidence citations.
 *
 * A Citation binds a claim to the exact UTF-8 bytes that support it:
 *
 *   {
 *     quoted_span: "<exact UTF-8 text>",
 *     span: { start_byte: N, end_byte: M, quoted_text: "<exact UTF-8 text>" },
 *     verification: "VERIFIED" | "UNAVAILABLE",
 *     source_ref: { ... } | null,
 *   }
 *
 * Both quote fields MUST equal the exact byte slice [start_byte, end_byte)
 * of the source fixture bytes. Verification is VERIFIED only when the
 * slice was actually extracted and compared; UNAVAILABLE when the bytes
 * are not retained (with an explicit reason, never silent).
 *
 * Spans are charged via sx.budget.chargeSpan(1) by the caller BEFORE
 * makeCitation is invoked — the charge precedes inspection.
 */

export const VERIFIED = "VERIFIED";
export const UNAVAILABLE = "UNAVAILABLE";

/**
 * copySourceRef(ref) — detached copy of a source identity object.
 *
 * M640-010: makeCitation previously returned `source_ref: sourceRef`
 * directly, so mutating a returned citation's source_ref poisoned the
 * host context (or a previous result). Every source_ref embedded in a
 * citation, diagnostic, or quarantine record is now a detached copy:
 * no mutation of a result object can reach trusted context, and no
 * mutation of context after return can alter an already-returned result.
 * Only own enumerable data-descriptor values are copied (post-snapshot
 * inputs have no accessors); nested values are strings by schema.
 */
export function copySourceRef(ref) {
  if (ref === null || ref === undefined) return null;
  if (typeof ref !== "object") return null;
  const out = {};
  for (const k of Object.keys(ref)) {
    const d = Object.getOwnPropertyDescriptor(ref, k);
    if (d && "value" in d) out[k] = d.value;
  }
  return out;
}

/**
 * Construct a verified citation from retained fixture bytes.
 * Returns a Citation with verification VERIFIED. Throws if the byte
 * range is invalid.
 */
export function makeCitation(bytes, startByte, endByte, sourceRef) {
  if (!Buffer.isBuffer(bytes)) {
    throw new TypeError("makeCitation: bytes must be a Buffer");
  }
  if (!Number.isInteger(startByte) || !Number.isInteger(endByte) ||
      startByte < 0 || endByte < startByte || endByte > bytes.length) {
    throw new RangeError(`makeCitation: invalid byte range [${startByte},${endByte}) for ${bytes.length} bytes`);
  }
  const quoted = bytes.toString("utf8", startByte, endByte);
  return {
    quoted_span: quoted,
    span: { start_byte: startByte, end_byte: endByte, quoted_text: quoted },
    verification: VERIFIED,
    source_ref: copySourceRef(sourceRef),
  };
}

/**
 * Explicit unavailable citation: the bytes supporting this claim are not
 * retained or not verifiable. The reason is always present — a missing
 * citation is never silent.
 */
export function unavailableCitation(reason, sourceRef) {
  return {
    quoted_span: null,
    span: null,
    verification: UNAVAILABLE,
    unavailable_reason: reason,
    source_ref: copySourceRef(sourceRef),
  };
}

/**
 * Verify that a claimed span matches the actual bytes. Returns true iff
 * bytes[start:end] === quoted_text.
 */
export function verifySpan(bytes, startByte, endByte, quotedText) {
  if (!Buffer.isBuffer(bytes)) return false;
  if (!Number.isInteger(startByte) || !Number.isInteger(endByte) ||
      startByte < 0 || endByte < startByte || endByte > bytes.length) {
    return false;
  }
  return bytes.toString("utf8", startByte, endByte) === quotedText;
}

/**
 * citeWrappedRow(w, sx) — build a verified citation for a resolver-wrapped
 * row ({row, fixture_id, source_ref, byte_span}).
 *
 * M640-002: excluded/duplicate/invalid records must carry their actual row
 * citations so derived counts reference the evidence they count. The span
 * is charged (chargeSpan) because the byte range is actually checked by
 * makeCitation. When bytes or spans are unavailable, returns an explicit
 * UNAVAILABLE citation — never silent, never skipped.
 */
export function citeWrappedRow(w, sx) {
  const bytes = sx?.fixtureBytes?.get(w?.fixture_id);
  const span = w?.byte_span;
  if (bytes && Array.isArray(span)) {
    sx.budget.chargeSpan(1);
    try {
      return makeCitation(bytes, span[0], span[1], w.source_ref);
    } catch {
      return unavailableCitation("row bytes not verifiable", w.source_ref);
    }
  }
  return unavailableCitation("row bytes not retained", w?.source_ref ?? null);
}
