"""Deterministic call taxonomy. Keyword rules only — no model call.

Top-level intents: LEASING, MAINTENANCE, EMERGENCY, OTHER, UNKNOWN.
Emergency (see emergencies.py) is checked FIRST by the dialogue layer and
can override any state. Multiple intents never skip capture: the first
intent opens the flow and the second is recorded as an additional need.
"""
from __future__ import annotations

from .emergencies import detect_hazard, is_ambiguous_high_risk, normalize

LEASING_SIGNALS = [
    "looking for a place", "looking to rent", "apartment", "house for rent",
    "rental", "available", "availability", "move in", "moving in", "lease",
    "tour", "showing", "view the", "interested in renting", "rent a",
    "apply", "application",
]
MAINTENANCE_SIGNALS = [
    "repair", "broken", "not working", "leak", "leaking", "dripping",
    "clogged", "won't turn on", "doesn't work", "fix", "maintenance",
    "air conditioner", "a/c", "ac is", "heater", "toilet", "sink", "faucet",
    "garbage disposal", "oven", "fridge", "refrigerator", "dishwasher",
    "light", "outlet", "door", "window", "mold", "pest", "bug", "roach",
]


def classify(text: str) -> dict:
    """Classify normalized caller text. Deterministic; no LLM.

    Returns {"intent", "hazard", "signals", "ambiguous_high_risk"}.
    EMERGENCY wins over everything. Ambiguous high-risk language with no
    firm hazard yields intent OTHER + ambiguous_high_risk=True, which the
    dialogue layer routes to safety clarification/escalation.
    """
    norm = normalize(text)
    hazard = detect_hazard(text)
    if hazard:
        return {"intent": "EMERGENCY", "hazard": hazard, "signals": [hazard],
                "ambiguous_high_risk": False}
    if is_ambiguous_high_risk(text):
        return {"intent": "OTHER", "hazard": None, "signals": ["AMBIGUOUS_HIGH_RISK"],
                "ambiguous_high_risk": True}
    leasing = [s for s in LEASING_SIGNALS if s in norm]
    maintenance = [s for s in MAINTENANCE_SIGNALS if s in norm]
    if leasing and maintenance:
        return {"intent": "LEASING", "hazard": None,
                "signals": leasing + maintenance, "additional_intent": "MAINTENANCE",
                "ambiguous_high_risk": False}
    if leasing:
        return {"intent": "LEASING", "hazard": None, "signals": leasing,
                "ambiguous_high_risk": False}
    if maintenance:
        return {"intent": "MAINTENANCE", "hazard": None, "signals": maintenance,
                "ambiguous_high_risk": False}
    if not norm.strip():
        return {"intent": "UNKNOWN", "hazard": None, "signals": [],
                "ambiguous_high_risk": False}
    return {"intent": "OTHER", "hazard": None, "signals": [],
            "ambiguous_high_risk": False}
