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
    source_ref: sourceRef ?? null,
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
    source_ref: sourceRef ?? null,
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
