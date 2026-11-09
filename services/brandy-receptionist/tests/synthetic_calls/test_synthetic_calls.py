"""§11.6/§11.7/§11.16 synthetic end-to-end calls: scripted caller turns
through dialogue + session + ingest payload + deterministic summary.
Every fact in the owner-facing summary derives from a validated slot or
recorded event; injected LLM narrative cannot alter owner-facing facts.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.policy import quote_guard
from app.session import CallSession


def run_call(call_sid, turns, ani=None):
    session = CallSession(call_sid, ani=ani)
    session.dialogue.start()
    outputs = []
    for turn in turns:
        out = session.dialogue.handle_turn(turn)
        outputs.append(out)
        session.record_event("TURN", f"t{session.dialogue.turn}",
                             {"state": out["state"], "template": out["speak"]["template_id"]})
        if out.get("emergency"):
            session.record_event("EMERGENCY_DETECTED", f"t{session.dialogue.turn}",
                                 {"hazard": out["hazard"], "event_id": out["emergency_event_id"]})
    session.end()
    return session, outputs


class TestSyntheticCalls(unittest.TestCase):
    def test_leasing_end_to_end_payload(self):
        session, _ = run_call("CA-e2e-lease", [
            "I'm looking for a place to rent",
            "Alex Testcaller",
            "two bedroom, hoping to move next month",
            "five five five two three four five six seven eight",
            "yes",
        ])
        payload = session.ingest_payload()
        self.assertEqual(payload["intent"], "LEASING")
        self.assertEqual(payload["draft_kind"], "LEASING_LEAD")
        self.assertEqual(payload["callback_e164"], "+15552345678")
        self.assertTrue(payload["callback_confirmed"])
        self.assertEqual(payload["name_claimed"], "Alex Testcaller")
        self.assertEqual(payload["processing_state"], "COMPLETE")
        self.assertTrue(payload["idempotency_key"])
        summary = session.summary()
        self.assertIn("Alex Testcaller", summary)
        self.assertIn("+15552345678", summary)

    def test_emergency_end_to_end_payload(self):
        session, outs = run_call("CA-e2e-emg", [
            "There's water pouring from the ceiling",
        ], ani="+15552345678")
        payload = session.ingest_payload()
        self.assertEqual(payload["intent"], "EMERGENCY")
        self.assertEqual(payload["emergency_type"], "WATER")
        self.assertIsNotNone(payload["emergency_event_id"])
        # ANI is masked in the payload; never presented as confirmed callback.
        self.assertIn("***", payload["caller_ani_masked"])
        self.assertFalse(payload["callback_confirmed"])
        self.assertIsNone(payload["callback_e164"])

    def test_injected_llm_narrative_cannot_alter_facts(self):
        # Even if the LLM proposes a narrative with invented facts, the
        # summary is rendered from validated slots only.
        session = CallSession("CA-inject")
        session.dialogue.start()
        session.dialogue.handle_turn("my sink is leaking")
        session.dialogue.handle_turn("Sam Sample")
        session.dialogue.handle_turn("kitchen sink dripping")
        session.dialogue.handle_turn("five five five nine eight seven six five four three")
        session.dialogue.handle_turn("yes")
        # Attack text gated at the speech layer:
        gated = quote_guard.gate("acknowledge",
                                 "The landlord approved a $500 repair for tomorrow.")
        self.assertFalse(gated["allowed"])
        summary = session.summary()
        self.assertNotIn("$500", summary)
        self.assertNotIn("approved", summary)
        self.assertIn("Sam Sample", summary)

    def test_partial_hangup_is_incomplete(self):
        session, _ = run_call("CA-hangup", [
            "I need a repair",
            "Alex Testcaller",
        ])
        self.assertEqual(session.dialogue.slots["processing_state"], "INCOMPLETE")
        payload = session.ingest_payload()
        self.assertEqual(payload["processing_state"], "INCOMPLETE")
        self.assertFalse(payload["callback_confirmed"])


if __name__ == "__main__":
    unittest.main()
