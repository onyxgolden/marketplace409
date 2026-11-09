"""Deterministic hazard taxonomy + approved safety scripts.

The emergency classifier NEVER depends on the LLM alone: it runs on the
normalized streaming transcript plus explicit high-risk keywords/phrases.
Classifier uncertainty or STT failure on an apparent hazard fails TOWARD
human escalation. Emergency classification can override ANY dialogue state,
including while agent speech is playing.

Hazard synonyms are a reviewed, versioned rule set (POLICY_VERSION).
"""
from __future__ import annotations

import re

# Canonical hazard -> (keywords/phrases, approved safety script, severity)
HAZARDS = {
    "FIRE": (
        ["fire", "smoke", "burning smell", "something burning", "flames",
         "smell smoke", "smells like smoke", "alarm going off"],
        "Leave the building immediately if you can do so safely. From a safe "
        "location, call 911 or your gas utility's emergency number. Do not "
        "operate switches or use flames near a suspected gas leak.",
    ),
    "GAS": (
        ["gas smell", "smell gas", "gas leak", "rotten egg", "rotten eggs",
         "sulfur smell", "gas odor", "smells like gas", "hissing gas"],
        "Leave the building immediately if you can do so safely. From a safe "
        "location, call 911 or your gas utility's emergency number. Do not "
        "operate switches or use flames near a suspected gas leak.",
    ),
    "WATER": (
        ["burst pipe", "pipe burst", "flooding", "flood", "water everywhere",
         "water pouring", "water leaking", "major leak", "ceiling leaking",
         "leak in the ceiling", "water in the ceiling",
         "water coming through", "broken pipe", "water gushing"],
        "If safe, move away from electrical hazards. You may shut off the main "
        "water valve only if you can reach it safely.",
    ),
    "LOCKOUT": (
        ["locked out", "can't get in", "cannot get in", "locked myself out",
         "child locked", "baby locked", "kid locked inside", "stuck outside",
         "key broke", "door won't open"],
        "If a child, vulnerable person, medical emergency, fire, or other "
        "immediate danger is involved, call 911.",
    ),
    "SEWAGE": (
        ["sewage", "sewer backup", "sewage backup", "toilet overflowing",
         "raw sewage", "sewer smell"],
        "Avoid contact with the contamination. I am alerting Brandy now, and "
        "call emergency services if there is immediate danger.",
    ),
    "NO_HEAT_FREEZING": (
        ["no heat", "heat is out", "heater broken", "freezing inside",
         "no heat and freezing", "furnace out", "pipes freezing"],
        "Avoid exposure to the cold. I am alerting Brandy now, and call "
        "emergency services if there is immediate danger.",
    ),
}

# Ambiguous high-risk language: conservatively enter safety clarification /
# escalation rather than discarding it. A bare match here never resolves to a
# routine intent on its own.
# NOTE: bare "leak"/"leaking" and "help" are deliberately NOT here — a
# routine "my sink is leaking" / "I need help with ..." is maintenance,
# not an emergency. Severity words (pouring, everywhere, major, ceiling)
# route major water to the WATER hazard instead.
AMBIGUOUS_HIGH_RISK = [
    "smell", "sparking", "sparks", "alarm", "emergency",
    "urgent", "danger", "trapped", "can't breathe", "carbon monoxide",
    "co alarm", "electrical burning", "hot water heater",
]

_VULNERABLE_LOCKOUT = re.compile(r"\b(child|baby|kid|toddler|elderly|grandma|grandpa|disabled|wheelchair)\b.*\b(locked|inside|alone)\b|\blocked\b.*\b(child|baby|kid|toddler)\b", re.I)


def normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9\s]", " ", (text or "").lower())


def _contains(phrase: str, text: str) -> bool:
    """Match a phrase against normalized text. Single words match on token
    boundaries; multi-word phrases match as an ordered word subsequence,
    so "water is pouring" matches "water pouring" and "I smell gas"
    matches "smell gas"."""
    words = phrase.split()
    if len(words) == 1:
        return f" {phrase} " in f" {text} " or text.startswith(phrase + " ") or text.endswith(" " + phrase)
    tokens = text.split()
    idx = 0
    for word in words:
        try:
            idx = tokens.index(word, idx) + 1
        except ValueError:
            return False
    return True


def detect_hazard(text: str) -> str | None:
    """Return the hazard key for normalized text, or None.

    Multi-word phrases match before single words; FIRE/GAS outrank WATER
    when both appear (leave-the-building wins). Vulnerable-person lockout
    is always LOCKOUT.
    """
    norm = normalize(text)
    if not norm.strip():
        return None
    for hazard in ("FIRE", "GAS", "WATER", "SEWAGE", "NO_HEAT_FREEZING", "LOCKOUT"):
        phrases, _ = HAZARDS[hazard]
        if any(_contains(p, norm) for p in phrases):
            return hazard
    if _VULNERABLE_LOCKOUT.search(norm):
        return "LOCKOUT"
    return None


def is_ambiguous_high_risk(text: str) -> bool:
    """True when the text carries high-risk language without a firm hazard.

    Callers in this bucket get safety clarification and human escalation,
    never a routine slot flow.
    """
    norm = normalize(text)
    return any(_contains(w, norm) for w in AMBIGUOUS_HIGH_RISK)


def safety_script(hazard: str) -> str:
    return HAZARDS[hazard][1]


def all_hazard_keywords() -> list:
    out = []
    for phrases, _ in HAZARDS.values():
        out.extend(phrases)
    return out
