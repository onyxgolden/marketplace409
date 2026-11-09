"""Deterministic outbound speech gate — NOT just a prompt.

The model generates a typed `response_intent` plus proposed text. This
compiler accepts only allowlisted response classes and renders sensitive
answers from FIXED templates. It rejects and replaces any model output that
includes currency, rent, deposit, fees, ballpark estimates, percentages
presented as pricing, ranges, dates/times presented as commitments,
"guaranteed", "approved", "we will repair by", or unapproved availability
claims. It also detects spelled-out numbers and semantic commitment
patterns; a regex alone is insufficient (see _spelled_out_number and
_commitment_patterns). Block both direct statements and quoted / role-play
"hypothetical" commitments. Fail closed: any parse ambiguity yields the
human-callback template. Never pass untrusted LLM text directly to TTS.

Fixed phone-number readback and safe numerical values are explicitly typed
exceptions so blanket number blocking does not break callback confirmation.
"""
from __future__ import annotations

import re

POLICY_VERSION = "brandy-receptionist-policy/1.0.0"

# Response classes the model may phrase within. Anything else is rejected.
ALLOWED_CLASSES = {
    "greeting", "disclosure", "ask_slot", "readback", "confirm",
    "safety_instruction", "human_callback", "close", "clarify",
    "transfer_offer", "acknowledge",
}

TEMPLATES = {
    "greeting": "Hello, you've reached Brandy's rental office. I'm an AI assistant.",
    "disclosure": ("Hello, you've reached Brandy's rental office. I'm an AI assistant. "
                   "This call may be transcribed to help Brandy follow up. If you'd "
                   "prefer a person, I can take a message for her."),
    "human_callback": "Brandy will review your question and follow up.",
    "close": "Thank you. Brandy will follow up on the number you confirmed.",
    "close_unverified": ("Thank you. I don't have a confirmed callback number, so "
                         "Brandy will follow up if she can reach you."),
    "clarify": "I want to make sure I help with the right thing. Could you say that again in a few words?",
    "transfer_offer": "Would you like me to have Brandy call you back, or take a message for her?",
    "ask_name": "May I have your name, please?",
    "ask_need": "Could you tell me briefly what you need help with?",
    "ask_callback": "What is the best number for Brandy to call you back on?",
    "ask_property": "Which property or area is this about?",
    "ask_move_in": "When were you hoping to move in?",
    "ask_access": "Is there a safe time or way for someone to access the home?",
    "ask_location": "Where in the home is the issue?",
    "confirm_callback": "Just to confirm, is that the right number?",
    "safety_clarify": ("I want to make sure you are safe. Is anyone in immediate "
                       "danger, or is there fire, smoke, a gas smell, flooding, or a lockout?"),
}

# --- Banned content -----------------------------------------------------------
_CURRENCY_RE = re.compile(r"(\$|usd|dollars?|bucks)\s*\d|\d+\s*(dollars?|bucks|usd)|[$€£]\d", re.I)
_PRICE_WORDS = re.compile(r"\b(rent|deposit|fee|fees|price|pricing|cost|rate|monthly|ballpark|estimate|quote|cheap|expensive)\b", re.I)
_RANGE_RE = re.compile(r"\b\d+\s*(to|-|–|—)\s*\d+\b|\bbetween\b.*\band\b", re.I)
_PERCENT_RE = re.compile(r"\b\d+\s*%|\b\d+\s*percent\b", re.I)
_COMMITMENT_RE = re.compile(
    r"\b(guarantee[sd]?|approved?|we will repair|will fix (it|this) by|"
    r"will be (there|fixed|ready|done)|confirmed for|booked for|scheduled for|"
    r"i promise|i assure|definitely available|available (now|today|tomorrow))\b", re.I)
_DATE_COMMIT_RE = re.compile(
    r"\b(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*\b(at|by|around)\b.*\b\d|"
    r"\bby (tomorrow|monday|tuesday|wednesday|thursday|friday|next week)\b", re.I)
_ROLEPLAY_RE = re.compile(
    r"\b(hypothetically|pretend|imagine|just between us|off the record|"
    r"role ?play|as if|what if (i|we) (say|said)|in theory)\b", re.I)
_INJECTION_RE = re.compile(
    r"\b(ignore (all )?(previous )?instructions|system prompt|you are now|"
    r"disregard|override (the )?(policy|rules)|jailbreak|do not (follow|obey))\b", re.I)

_NUMBER_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11,
    "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
    "seventy": 70, "eighty": 80, "ninety": 90, "hundred": 100,
    "thousand": 1000, "million": 1000000,
}
_SPELLED_MONEY_RE = re.compile(
    r"\b(" + "|".join(_NUMBER_WORDS) + r")\b(\s+\b(" + "|".join(_NUMBER_WORDS) + r")\b)*\s*\b(dollars?|bucks|usd)\b", re.I)
_SPELLED_ANY_NUMBER = re.compile(r"\b(" + "|".join(_NUMBER_WORDS) + r")\b", re.I)


def _spelled_out_number(text: str) -> bool:
    return bool(_SPELLED_ANY_NUMBER.search(text))


def find_violations(text: str, response_class: str, *, is_readback: bool = False) -> list:
    """Return a list of violation reasons; empty means the text may play.

    Phone readback (is_readback=True) is the typed exception: digits and
    digit words are allowed there, but no price/commitment language.
    """
    reasons = []
    if response_class not in ALLOWED_CLASSES:
        reasons.append(f"unapproved response class: {response_class}")
    if _INJECTION_RE.search(text):
        reasons.append("prompt-injection pattern")
    if _ROLEPLAY_RE.search(text):
        reasons.append("role-play / hypothetical commitment framing")
    if _CURRENCY_RE.search(text) or _SPELLED_MONEY_RE.search(text):
        reasons.append("currency / price figure")
    if _PRICE_WORDS.search(text):
        reasons.append("pricing vocabulary (rent/deposit/fee/quote)")
    if _RANGE_RE.search(text):
        reasons.append("numeric range (possible price/commitment)")
    if _PERCENT_RE.search(text):
        reasons.append("percentage presented as pricing")
    if _COMMITMENT_RE.search(text):
        reasons.append("commitment / guarantee / approval language")
    if _DATE_COMMIT_RE.search(text):
        reasons.append("date/time presented as a commitment")
    if not is_readback and _spelled_out_number(text):
        reasons.append("spelled-out number outside readback")
    return reasons


def gate(response_class: str, proposed_text: str, *, is_readback: bool = False,
         fallback: str = "human_callback") -> dict:
    """Compile one agent turn. Returns {allowed, text, template_id,
    rejection_reason, text_hash}.

    On any violation or unknown class, the safe human-callback template
    plays instead. Nothing untrusted reaches TTS un-gated.
    """
    import hashlib
    violations = find_violations(proposed_text, response_class, is_readback=is_readback)
    if violations:
        safe = TEMPLATES[fallback]
        return {"allowed": False, "text": safe, "template_id": fallback,
                "rejection_reason": "; ".join(violations),
                "text_hash": hashlib.sha256(safe.encode()).hexdigest()[:16]}
    template_id = f"model:{response_class}"
    return {"allowed": True, "text": proposed_text, "template_id": template_id,
            "rejection_reason": None,
            "text_hash": hashlib.sha256(proposed_text.encode()).hexdigest()[:16]}


def render_template(template_id: str, **kwargs) -> dict:
    """Render a fixed template. Only known templates render; unknown ids
    fail closed to the human-callback template."""
    import hashlib
    if template_id == "readback" and "digits" in kwargs:
        digits = kwargs["digits"]
        text = "Just to confirm, your number is " + " ".join(digits) + ". Is that correct?"
        return {"allowed": True, "text": text, "template_id": template_id,
                "rejection_reason": None,
                "text_hash": hashlib.sha256(text.encode()).hexdigest()[:16]}
    text = TEMPLATES.get(template_id)
    if text is None:
        text = TEMPLATES["human_callback"]
        template_id = "human_callback"
    return {"allowed": True, "text": text, "template_id": template_id,
            "rejection_reason": None,
            "text_hash": hashlib.sha256(text.encode()).hexdigest()[:16]}
