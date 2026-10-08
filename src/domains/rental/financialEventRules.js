// Shared financial-event eligibility rules for read models.
//
// These rules are intentionally shared by the property ledger and package
// cost summaries: both surfaces must agree about which financial_events are
// safe to treat as ledger activity, and both must recognize the same explicit
// contractor-payment reference. Keeping the definitions here prevents the two
// read models from drifting into contradictory totals.

export const FINANCIAL_EVENT_SAFE_SOURCES = new Set(["manual", "rentec", "rentec_api"]);
export const FINANCIAL_EVENT_EXCLUDED_STATUSES = new Set(["inactive", "deleted"]);

const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Convert a decimal dollar amount to integer cents without binary floating
 * point arithmetic. Numbers are converted through their shortest decimal
 * string representation; strings must be plain decimal notation. More than
 * two fraction digits, non-decimal notation, and safe-integer overflow are
 * rejected instead of being rounded or silently treated as zero.
 */
export function parseDecimalAmountToCents(value) {
  if (typeof value === "bigint") {
    if (value > MAX_SAFE_CENTS || value < -MAX_SAFE_CENTS) {
      return { ok: false, error: "amount exceeds the supported safe-integer range." };
    }
    return { ok: true, cents: Number(value) };
  }

  let text;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { ok: false, error: "amount must be finite." };
    text = String(value);
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    return { ok: false, error: "amount must be a decimal string or number." };
  }

  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return { ok: false, error: "amount must use decimal notation with at most two decimal places." };
  const fraction = match[3] || "";
  if (fraction.length > 2) {
    return { ok: false, error: "amount must use decimal notation with at most two decimal places." };
  }

  const cents = BigInt(match[2]) * 100n + BigInt((fraction || "0").padEnd(2, "0"));
  if (cents > MAX_SAFE_CENTS) {
    return { ok: false, error: "amount exceeds the supported safe-integer range." };
  }
  return { ok: true, cents: Number(match[1] === "-" ? -cents : cents) };
}

/** The explicit contractor-payment id referenced by a financial event, if any. */
export function contractorPaymentIdOf(event) {
  if (!event) return null;
  const PREFIX = "rental_contractor_payment_";
  if (typeof event.source_record_id === "string" && event.source_record_id.startsWith(PREFIX)) {
    return event.source_record_id.slice(PREFIX.length);
  }
  const viaMetadata = event.metadata && typeof event.metadata === "object"
    ? event.metadata.contractor_payment_id
    : null;
  return typeof viaMetadata === "string" && viaMetadata ? viaMetadata : null;
}
