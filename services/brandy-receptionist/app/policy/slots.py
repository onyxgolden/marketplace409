"""Slot validators: phone normalization, digit-word parsing, confirmation.

Rules (brief §6):
- Callback is normalized + validated E.164 (US default +1, 10 digits).
- Caller ID / ANI is NEVER automatically the confirmed callback.
- Spoken numbers are read back digit by digit; explicit caller
  confirmation is required; the confirmation turn id is stored.
- Any caller correction invalidates a previous confirmation and forces
  another readback. After two failed callback attempts the slot is
  CALLBACK_UNVERIFIED and the ANI is preserved separately as unverified.
- No slot is inferred from a property-directory match; names are
  caller-stated and unverified.
"""
from __future__ import annotations

import re

_DIGIT_WORDS = {
    "zero": "0", "oh": "0", "o": "0", "one": "1", "two": "2", "three": "3",
    "four": "4", "five": "5", "six": "6", "seven": "7", "eight": "8",
    "nine": "9", "double": None, "triple": None,
}
_DOUBLE_RE = re.compile(r"\b(double|triple)\s+(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b", re.I)


def parse_spoken_number(text: str) -> str:
    """Extract digits from spoken text: digit words, 'double/triple X',
    and raw digit runs. Returns the digit string (may be empty)."""
    if not text:
        return ""
    work = text.lower()
    # "double five" -> "55", "triple two" -> "222"
    def _expand(m):
        word, digit_word = m.group(1).lower(), m.group(2).lower()
        d = _DIGIT_WORDS[digit_word]
        return d * (2 if word == "double" else 3)
    work = _DOUBLE_RE.sub(_expand, work)
    out = []
    for token in re.split(r"[\s,\-]+", work):
        token = token.strip(".,")
        if not token:
            continue
        if token.isdigit():
            out.append(token)
        elif token in _DIGIT_WORDS and _DIGIT_WORDS[token] is not None:
            out.append(_DIGIT_WORDS[token])
    return "".join(out)


def normalize_e164(raw: str, default_country: str = "1") -> str | None:
    """Normalize to E.164. Returns None when the value is not a valid
    10-digit NANP number (or 11 digits starting with 1)."""
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        return None
    if digits[0] in ("0", "1") or digits[3] in ("0", "1"):
        return None  # NANP area/exchange codes never start 0/1
    return f"+{default_country}{digits}"


def digits_spaced(e164: str) -> list:
    """Digit-by-digit readback tokens for an E.164 number (without '+1')."""
    return list(re.sub(r"\D", "", e164)[1:])


def is_affirmation(text: str) -> bool:
    t = (text or "").strip().lower().strip(".,!?")
    if t in ("yes", "yeah", "yep", "yup", "correct", "right", "ok", "okay", "sure", "confirmed"):
        return True
    if t.startswith(("yes ", "yeah ", "yep ", "yup ", "yes,", "correct ", "right ")):
        return True
    return "that's right" in t or "thats right" in t or "that's correct" in t


def is_negation(text: str) -> bool:
    t = (text or "").strip().lower().strip(".,!?")
    if t in ("no", "nope", "nah", "wrong", "incorrect"):
        return True
    if t.startswith(("no ", "nope ", "nah ", "no,", "wrong ", "incorrect ")):
        return True
    return "that's wrong" in t or "not right" in t or "not correct" in t


class CallbackSlot:
    """State machine for one callback number: proposed -> read back ->
    confirmed, with invalidation on correction and a bounded retry count."""

    def __init__(self, max_attempts: int = 2):
        self.max_attempts = max_attempts
        self.attempts = 0
        self.proposed_e164: str | None = None
        self.confirmed: bool = False
        self.confirmation_turn_id: str | None = None
        self.status: str = "MISSING"  # MISSING | PROPOSED | READBACK | CONFIRMED | UNVERIFIED
        self.ani_unverified: str | None = None  # ANI kept separate, never auto-confirmed

    def propose(self, raw_spoken: str, turn_id: str) -> dict:
        e164 = normalize_e164(parse_spoken_number(raw_spoken) or raw_spoken)
        if e164 is None:
            self.attempts += 1
            if self.attempts >= self.max_attempts:
                self.status = "UNVERIFIED"
            return {"ok": False, "status": self.status, "attempts": self.attempts}
        if self.confirmed and e164 != self.proposed_e164:
            # Caller correction invalidates the previous confirmation.
            self.confirmed = False
            self.confirmation_turn_id = None
        self.proposed_e164 = e164
        self.status = "READBACK"
        return {"ok": True, "e164": e164, "digits": digits_spaced(e164), "turn_id": turn_id}

    def confirm(self, text: str, turn_id: str) -> dict:
        if self.proposed_e164 is None:
            return {"ok": False, "status": self.status}
        if is_affirmation(text):
            self.confirmed = True
            self.confirmation_turn_id = turn_id
            self.status = "CONFIRMED"
            return {"ok": True, "status": "CONFIRMED", "turn_id": turn_id}
        if is_negation(text):
            self.confirmed = False
            self.confirmation_turn_id = None
            self.attempts += 1
            self.proposed_e164 = None
            self.status = "UNVERIFIED" if self.attempts >= self.max_attempts else "MISSING"
            return {"ok": False, "status": self.status, "attempts": self.attempts}
        return {"ok": False, "status": self.status, "needs_clarify": True}


def validate_name(raw: str) -> str | None:
    """Caller-stated name, unverified. Rejects empty / implausibly long /
    digit-heavy values; never invents a name."""
    if not raw:
        return None
    name = " ".join(raw.strip().split())
    if len(name) < 2 or len(name) > 80:
        return None
    if sum(c.isdigit() for c in name) > 0:
        return None
    return name


def validate_need(raw: str, max_len: int = 500) -> str | None:
    """Bounded caller-stated need. Missing need is rejected, not invented."""
    if not raw:
        return None
    need = " ".join(raw.strip().split())
    if len(need) < 3:
        return None
    return need[:max_len]
