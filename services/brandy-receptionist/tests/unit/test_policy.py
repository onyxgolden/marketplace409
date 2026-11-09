"""§11.1 taxonomy + §11.2/§11.4 emergency interrupt + ambiguous escalation."""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.policy.dialogue import CallDialogue
from app.policy.emergencies import detect_hazard, is_ambiguous_high_risk
from app.policy.intents import classify

FIXTURES = json.load(open(os.path.join(os.path.dirname(__file__), "..", "fixtures", "synthetic_turns.json")))


class TestTaxonomy(unittest.TestCase):
    def test_fixture_turns_classify(self):
        for turn in FIXTURES["turns"]:
            result = classify(turn["text"])
            if "expect_intent" in turn:
                self.assertEqual(result["intent"], turn["expect_intent"], turn["text"])
            if "expect_hazard" in turn:
                self.assertEqual(result["hazard"], turn["expect_hazard"], turn["text"])
            if turn.get("expect_ambiguous_high_risk"):
                self.assertTrue(result["ambiguous_high_risk"], turn["text"])

    def test_multiple_intents_do_not_skip_capture(self):
        d = CallDialogue("CA-test-multi")
        d.start()
        out = d.handle_turn("I want to rent a place and also my sink is broken")
        self.assertEqual(d.slots["intent"], "LEASING")
        self.assertIn("MAINTENANCE", d.additional_intents)
        self.assertEqual(d.state, "CAPTURE_NAME")  # capture still required

    def test_empty_and_unknown_go_to_capture(self):
        # Unknown/other speech is captured (need + callback) and routed to
        # Brandy's review inbox — never discarded, never looped.
        d = CallDialogue("CA-test-unknown")
        d.start()
        out = d.handle_turn("blorp glorp")
        self.assertEqual(d.slots["intent"], "OTHER")
        self.assertEqual(out["state"], "CAPTURE_NAME")


class TestEmergencyInterrupt(unittest.TestCase):
    HAZARD_TEXTS = {
        "WATER": "water is pouring from the ceiling",
        "FIRE": "I smell smoke",
        "GAS": "I smell gas",
        "LOCKOUT": "I'm locked out and my baby is inside",
        "SEWAGE": "sewage is coming up in the bathtub",
        "NO_HEAT_FREEZING": "no heat and it's freezing inside",
    }

    def test_each_hazard_interrupts_at_every_state(self):
        # Drive the dialogue to each capturable state, then inject a hazard.
        for hazard, text in self.HAZARD_TEXTS.items():
            for prefix in ([], ["looking to rent a place"], ["looking to rent a place", "Alex Testcaller"]):
                d = CallDialogue(f"CA-{hazard}-{len(prefix)}")
                d.start()
                for turn in prefix:
                    d.handle_turn(turn)
                out = d.handle_turn(text)
                self.assertTrue(out["emergency"], f"{hazard} at state after {prefix}")
                self.assertEqual(out["hazard"], hazard)
                self.assertEqual(out["state"], "SAFETY_INSTRUCTION")
                self.assertTrue(out["alert"])
                self.assertIsNotNone(d.emergency_event_id)
                # Safety script plays FIRST and always directs to emergency
                # services / safe action.
                self.assertTrue("911" in out["speak"]["text"]
                                or "safely" in out["speak"]["text"]
                                or "emergency services" in out["speak"]["text"])

    def test_emergency_interrupts_during_agent_speech_barge_in(self):
        d = CallDialogue("CA-barge")
        d.start()
        d.handle_turn("looking to rent a place")
        out = d.handle_turn("wait, I smell gas", barge_in=True)
        self.assertTrue(out["emergency"])
        self.assertEqual(out["hazard"], "GAS")

    def test_ambiguous_high_risk_goes_to_safety_clarification(self):
        d = CallDialogue("CA-ambig")
        d.start()
        out = d.handle_turn("there's a weird smell")
        self.assertFalse(out.get("emergency", False))
        self.assertTrue(out.get("safety_clarify"))
        self.assertEqual(d.state, "CLARIFY")

    def test_stt_failure_on_apparent_hazard_escalates(self):
        d = CallDialogue("CA-sttfail")
        d.start()
        out = d.handle_turn("there's a leak and sparks", stt_failed=True)
        self.assertTrue(out.get("safety_clarify") or out.get("emergency"))

    def test_no_hazard_keyword(self):
        self.assertIsNone(detect_hazard("hello, I have a question"))
        self.assertFalse(is_ambiguous_high_risk("hello, I have a question"))


if __name__ == "__main__":
    unittest.main()
