"""Constrained dialogue state machine.

The LLM may phrase only within the current state's allowlisted response
class; deterministic transition and emission gates decide what actually
plays. Emergency interrupts at ANY state, including while agent speech is
playing (barge-in). Caller interruptions, multiple intents, nonresponses,
language barriers and refusal to provide a phone number never create
infinite loops: after bounded clarifications the call closes INCOMPLETE.
"""
from __future__ import annotations

import uuid

from . import quote_guard
from .emergencies import detect_hazard, is_ambiguous_high_risk, safety_script
from .intents import classify
from .slots import CallbackSlot, is_affirmation, is_negation, validate_name, validate_need

STATES = (
    "ANSWER", "DISCLOSE_AI_AND_RECORDING", "INTENT", "CAPTURE_NAME",
    "CAPTURE_NEED", "CAPTURE_CALLBACK", "READ_BACK_CALLBACK",
    "CONFIRM_CALLBACK", "REVIEW_AND_CLOSE", "CLARIFY",
    "HUMAN_TRANSFER_REQUEST", "INCOMPLETE", "SAFETY_INSTRUCTION",
    "ALERT_DISPATCH", "EMERGENCY_CAPTURE_WHILE_ALERTING",
    "EMERGENCY_HANDOFF_OR_SAFE_CLOSE", "CLOSED",
)

# Which response class the model may phrase within, per state.
STATE_CLASS = {
    "DISCLOSE_AI_AND_RECORDING": "disclosure",
    "INTENT": "ask_slot",
    "CAPTURE_NAME": "ask_slot",
    "CAPTURE_NEED": "ask_slot",
    "CAPTURE_CALLBACK": "ask_slot",
    "READ_BACK_CALLBACK": "readback",
    "CONFIRM_CALLBACK": "confirm",
    "REVIEW_AND_CLOSE": "close",
    "CLARIFY": "clarify",
    "SAFETY_INSTRUCTION": "safety_instruction",
}

# Fixed template per state (template-only for sensitive classes).
STATE_TEMPLATE = {
    "DISCLOSE_AI_AND_RECORDING": "disclosure",
    "CAPTURE_NAME": "ask_name",
    "CAPTURE_NEED": "ask_need",
    "CAPTURE_CALLBACK": "ask_callback",
    "REVIEW_AND_CLOSE": "close",
    "CLARIFY": "clarify",
}


class CallDialogue:
    def __init__(self, call_sid: str, ani: str | None = None, config=None):
        self.call_sid = call_sid
        self.config = config
        self.state = "ANSWER"
        self.turn = 0
        self.slots: dict = {
            "call_sid": call_sid, "intent": None, "caller_name": None,
            "need_description": None, "callback_e164": None,
            "callback_source": None, "callback_confirmed": False,
            "property_hint": None, "unit_hint": None,
            "desired_move_in_window": None, "maintenance_location": None,
            "access_preference": None, "emergency_type": None,
            "risk_flags": [], "language": "en", "consent_status": "pending",
            "processing_state": "IN_PROGRESS",
        }
        self.callback = CallbackSlot()
        if ani:
            self.callback.ani_unverified = ani  # kept separate; never auto-confirmed
        self.emergency_event_id: str | None = None
        self.clarify_count = 0
        self.nonresponse_count = 0
        self.additional_intents: list = []
        self.refused_callback = False

    # -- speech ----------------------------------------------------------------
    def _speak(self, template_id: str = None, model_text: str = None,
               response_class: str = None, is_readback: bool = False) -> dict:
        """All outbound speech passes through here: templates render fixed
        text; model text passes the deterministic quote guard."""
        if model_text is not None:
            return quote_guard.gate(response_class or "acknowledge", model_text,
                                    is_readback=is_readback)
        return quote_guard.render_template(template_id or "human_callback")

    # -- emergency ---------------------------------------------------------------
    def _enter_emergency(self, hazard: str) -> dict:
        self.slots["emergency_type"] = hazard
        self.slots["intent"] = "EMERGENCY"
        self.slots["risk_flags"].append(f"hazard:{hazard}")
        self.emergency_event_id = f"emg-{uuid.uuid4().hex[:12]}"
        self.state = "SAFETY_INSTRUCTION"
        script = safety_script(hazard)
        # Safety scripts are fixed templates: render via the guard as the
        # safety_instruction class (they contain no price/commitment text).
        gated = quote_guard.gate("safety_instruction", script)
        return {"state": self.state, "emergency": True, "hazard": hazard,
                "emergency_event_id": self.emergency_event_id,
                "speak": gated, "alert": True}

    # -- main turn ---------------------------------------------------------------
    def handle_turn(self, text: str, *, model_text: str = None,
                    stt_failed: bool = False, barge_in: bool = False) -> dict:
        """One caller turn. Returns {state, speak, emergency, ...}.

        `barge_in=True` means the caller interrupted agent speech: queued
        TTS is cancelled by the caller (server layer) and this turn is
        processed immediately, including emergency detection.
        """
        self.turn += 1
        turn_id = f"t{self.turn}"
        raw = (text or "").strip()

        # 1. Emergency overrides EVERYTHING, at any state.
        hazard = detect_hazard(raw) if raw else None
        if hazard:
            return self._enter_emergency(hazard)
        if stt_failed and raw and is_ambiguous_high_risk(raw):
            # STT failure on an apparent hazard fails toward escalation:
            # firm hazard -> emergency; ambiguous -> safety clarification.
            hazard = detect_hazard(raw)
            if hazard:
                return self._enter_emergency(hazard)
            self.slots["risk_flags"].append("ambiguous_high_risk_stt_failure")
            self.state = "CLARIFY"
            return {"state": self.state, "emergency": False,
                    "speak": self._speak("safety_clarify"),
                    "safety_clarify": True}
        if self.state == "SAFETY_INSTRUCTION":
            self.state = "ALERT_DISPATCH"
            return {"state": self.state, "emergency": True,
                    "hazard": self.slots["emergency_type"],
                    "emergency_event_id": self.emergency_event_id,
                    "speak": self._speak("human_callback"),
                    "alert": True}
        if self.state in ("ALERT_DISPATCH", "EMERGENCY_CAPTURE_WHILE_ALERTING"):
            # Keep capturing while alerting; never delay the alert for slots.
            self.state = "EMERGENCY_CAPTURE_WHILE_ALERTING"
            return {"state": self.state, "emergency": True,
                    "hazard": self.slots["emergency_type"],
                    "emergency_event_id": self.emergency_event_id,
                    "speak": self._speak("ask_callback"),
                    "alert": False}

        # 2. Nonresponse / empty turn.
        if not raw:
            self.nonresponse_count += 1
            if self.nonresponse_count >= 2:
                return self._close_incomplete("nonresponse")
            return {"state": "CLARIFY",
                    "speak": self._speak("clarify")}

        # 3. State machine.
        if self.state == "ANSWER":
            self.state = "DISCLOSE_AI_AND_RECORDING"
            return {"state": self.state, "emergency": False,
                    "speak": self._speak("disclosure")}
        if self.state == "DISCLOSE_AI_AND_RECORDING":
            low = raw.lower()
            if any(p in low for p in ("don't want to be recorded", "do not record",
                                      "don't record", "no recording", "don't transcribe")):
                self.slots["consent_status"] = "recording_refused"
                # Recording is off by default anyway; live STT continues only
                # as the conversation itself, with no stored transcript.
                self.state = "INTENT"
                return {"state": self.state, "emergency": False,
                        "speak": self._speak("ask_need")}
            self.slots["consent_status"] = "disclosed"
            self.state = "INTENT"
            return self._handle_intent(raw, turn_id)
        if self.state == "INTENT":
            return self._handle_intent(raw, turn_id)
        if self.state == "CAPTURE_NAME":
            name = validate_name(raw)
            if name:
                self.slots["caller_name"] = name
                self.state = "CAPTURE_NEED"
                return {"state": self.state, "emergency": False,
                        "speak": self._speak("ask_need")}
            return {"state": "CLARIFY", "emergency": False,
                    "speak": self._speak("clarify")}
        if self.state == "CAPTURE_NEED":
            need = validate_need(raw)
            if need:
                self.slots["need_description"] = need
                self.state = "CAPTURE_CALLBACK"
                return {"state": self.state, "emergency": False,
                        "speak": self._speak("ask_callback")}
            return {"state": "CLARIFY", "emergency": False,
                    "speak": self._speak("clarify")}
        if self.state == "CAPTURE_CALLBACK":
            low = raw.lower()
            if any(p in low for p in ("don't want to give", "not giving", "won't give",
                                      "no number", "don't have a number", "rather not")):
                self.refused_callback = True
                return self._close_incomplete("callback_refused")
            result = self.callback.propose(raw, turn_id)
            if not result["ok"]:
                if result["status"] == "UNVERIFIED":
                    return self._close_incomplete("callback_unverified")
                return {"state": "CAPTURE_CALLBACK", "emergency": False,
                        "speak": self._speak("ask_callback")}
            self.slots["callback_e164"] = result["e164"]
            self.slots["callback_source"] = "spoken"
            self.state = "READ_BACK_CALLBACK"
            return {"state": self.state, "emergency": False,
                    "speak": quote_guard.render_template(
                        "readback", digits=result["digits"])}
        if self.state in ("READ_BACK_CALLBACK", "CONFIRM_CALLBACK"):
            result = self.callback.confirm(raw, turn_id)
            if result.get("needs_clarify"):
                return {"state": "CONFIRM_CALLBACK", "emergency": False,
                        "speak": self._speak("confirm_callback")}
            if result["ok"]:
                self.slots["callback_confirmed"] = True
                self.slots["callback_e164"] = self.callback.proposed_e164
                self.state = "REVIEW_AND_CLOSE"
                return {"state": self.state, "emergency": False,
                        "speak": self._speak("close")}
            if result["status"] == "UNVERIFIED":
                return self._close_incomplete("callback_unverified")
            # Caller corrected the number: back to capture for a fresh readback.
            self.slots["callback_e164"] = None
            self.state = "CAPTURE_CALLBACK"
            return {"state": self.state, "emergency": False,
                    "speak": self._speak("ask_callback")}
        if self.state == "CLARIFY":
            self.clarify_count += 1
            if self.clarify_count >= 2:
                return self._close_incomplete("unresolved")
            self.state = "INTENT"
            return self._handle_intent(raw, turn_id)
        if self.state in ("REVIEW_AND_CLOSE", "CLOSED"):
            self.state = "CLOSED"
            self.slots["processing_state"] = "COMPLETE"
            return {"state": "CLOSED", "emergency": False,
                    "speak": self._speak("close")}
        return {"state": self.state, "emergency": False,
                "speak": self._speak("human_callback")}

    def _handle_intent(self, raw: str, turn_id: str) -> dict:
        result = classify(raw)
        if result["ambiguous_high_risk"]:
            self.slots["risk_flags"].append("ambiguous_high_risk")
            self.state = "CLARIFY"
            return {"state": self.state, "emergency": False,
                    "speak": self._speak("safety_clarify"),
                    "safety_clarify": True}
        intent = result["intent"]
        self.slots["intent"] = intent
        if result.get("additional_intent"):
            self.additional_intents.append(result["additional_intent"])
            self.slots["risk_flags"].append(f"additional_intent:{result['additional_intent']}")
        if intent == "LEASING":
            self.slots["need_description"] = validate_need(raw) or raw[:500]
            self.state = "CAPTURE_NAME"
            return {"state": self.state, "emergency": False,
                    "speak": self._speak("ask_property")}
        if intent == "MAINTENANCE":
            self.slots["need_description"] = validate_need(raw) or raw[:500]
            self.state = "CAPTURE_NAME"
            return {"state": self.state, "emergency": False,
                    "speak": self._speak("ask_location")}
        if intent == "OTHER":
            self.slots["need_description"] = validate_need(raw) or raw[:500]
            self.state = "CAPTURE_NAME"
            return {"state": self.state, "emergency": False,
                    "speak": self._speak("ask_name")}
        self.state = "CLARIFY"
        return {"state": self.state, "emergency": False,
                "speak": self._speak("clarify")}

    def _close_incomplete(self, reason: str) -> dict:
        self.state = "INCOMPLETE"
        self.slots["processing_state"] = "INCOMPLETE"
        self.slots["risk_flags"].append(f"incomplete:{reason}")
        if self.callback.status == "UNVERIFIED":
            self.slots["callback_confirmed"] = False
        return {"state": "INCOMPLETE", "emergency": False,
                "incomplete_reason": reason,
                "speak": self._speak("close_unverified")}

    def start(self) -> dict:
        """Opening turn: answer + AI/recording disclosure."""
        self.turn += 1
        self.state = "DISCLOSE_AI_AND_RECORDING"
        return {"state": self.state, "emergency": False,
                "speak": self._speak("disclosure")}
