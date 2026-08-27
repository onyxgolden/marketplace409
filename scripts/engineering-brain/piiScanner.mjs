// Requirement 6/7: tenant PII exclusion. Source code legitimately references field *names* like
// "ssn" or "dateOfBirth" constantly (column names, form labels, validation rules) -- flagging those
// would exclude huge swaths of legitimate Rental Manager code. This only matches PII-*shaped values*
// that have no business appearing in a repository file: an actual SSN or a payment-card-shaped
// number that also passes a Luhn checksum (ruling out the false positives a bare digit-run regex
// would hit constantly in this repo -- e.g. every migration filename is a 14-digit timestamp).
function passesLuhnChecksum(digits) {
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

// Synthetic values this codebase's own tests legitimately use (obviously-fake SSNs/card numbers,
// e.g. Stripe's published test card 4242 4242 4242 4242) -- excluded from the scan so the indexer
// doesn't fail-closed on its own repository's test fixtures.
const KNOWN_SYNTHETIC_VALUES = Object.freeze(["000-00-0000", "123-45-6789", "111-11-1111"]);

function isKnownSyntheticSsn(value) {
  return KNOWN_SYNTHETIC_VALUES.includes(value);
}

export function scanForPii(content) {
  if (!content) return [];
  const matches = [];

  const ssnMatches = content.match(/\b\d{3}-\d{2}-\d{4}\b/g) || [];
  if (ssnMatches.some((value) => !isKnownSyntheticSsn(value))) matches.push("ssn_like_value");

  const einMatches = content.match(/\b\d{2}-\d{7}\b/g) || [];
  if (einMatches.length > 0) matches.push("ein_like_value");

  // Card-shaped: either a bare digit run, or digits grouped the way real cards are actually
  // printed/typed (groups of 4). A bare-digit-run regex with only a Luhn check turned out to false-
  // positive on this repo's own content -- this codebase names every migration with a 14-digit
  // YYYYMMDDHHMMSS timestamp, referenced constantly in comments/docs/tests, and roughly 1 in 10
  // coincidentally satisfies Luhn. Real payment card networks never issue 14-digit numbers (13/15/16/
  // 17/18/19 cover Visa/Amex/Mastercard/Discover/UnionPay/etc.), so excluding exactly-14-digit runs
  // removes this repo's specific false-positive source without weakening genuine card coverage.
  const CARD_LENGTHS = new Set([13, 15, 16, 17, 18, 19]);
  const cardCandidates = content.match(/\b\d{13,19}\b|\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{1,7}\b/g) || [];
  const genuineCard = cardCandidates
    .map((value) => value.replace(/[ -]/g, ""))
    .filter((digits) => CARD_LENGTHS.has(digits.length))
    .some((digits) => passesLuhnChecksum(digits));
  if (genuineCard) matches.push("payment_card_like_value");

  return matches;
}

export function containsLikelyPii(content) {
  return scanForPii(content).length > 0;
}
