"""§11.1/§11.6 dialogue flows: leasing, maintenance, other, refusal,
nonresponse, interruption, multi-intent, INCOMPLETE accuracy.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.policy.dialogue import CallDialogue
from app.session import CallSession


def drive(dialogue, turns):
    outs = []
    for t in turns:
        outs.append(dialogue.handle_turn(t))
    return outs


class TestDialogueFlows(unittest.TestCase):
    def test_leasing_full_flow(self):
        d = CallDialogue("CA-lease")
        self.assertIn("AI assistant", d.start()["speak"]["text"])
        drive(d, ["I'm looking for a place to rent"])
        self.assertEqual(d.slots["intent"], "LEASING")
        drive(d, ["Alex Testcaller"])
        self.assertEqual(d.slots["caller_name"], "Alex Testcaller")
        drive(d, ["two bedroom, hoping to move next month"])
        drive(d, ["five five five two three four five six seven eight"])
        self.assertEqual(d.state, "READ_BACK_CALLBACK")
        out = d.handle_turn("yes")
        self.assertEqual(d.state, "REVIEW_AND_CLOSE")
        self.assertTrue(d.slots["callback_confirmed"])
        self.assertEqual(d.slots["callback_e164"], "+15552345678")

    def test_maintenance_full_flow(self):
        d = CallDialogue("CA-maint")
        d.start()
        drive(d, ["my sink is broken and leaking"])
        self.assertEqual(d.slots["intent"], "MAINTENANCE")
        drive(d, ["Sam Sample", "the kitchen sink keeps dripping"])
        drive(d, ["555-987-6543"])
        out = d.handle_turn("yes, that's right")
        self.assertTrue(d.slots["callback_confirmed"])
        self.assertEqual(d.slots["callback_e164"], "+15559876543")

    def test_callback_refusal_closes_incomplete(self):
        d = CallDialogue("CA-refuse")
        d.start()
        drive(d, ["I have a question", "Alex Testcaller", "just a general question"])
        out = d.handle_turn("I don't want to give my number")
        self.assertEqual(out["state"], "INCOMPLETE")
        self.assertEqual(out["incomplete_reason"], "callback_refused")
        self.assertFalse(d.slots["callback_confirmed"])

    def test_repeated_nonresponse_closes_incomplete(self):
        d = CallDialogue("CA-silent")
        d.start()
        d.handle_turn("")
        out = d.handle_turn("")
        self.assertEqual(out["state"], "INCOMPLETE")

    def test_recording_refusal_recorded_but_flow_continues(self):
        d = CallDialogue("CA-norecord")
        d.start()
        out = d.handle_turn("I don't want to be recorded, I have a maintenance issue")
        self.assertEqual(d.slots["consent_status"], "recording_refused")

    def test_session_events_are_idempotent(self):
        s = CallSession("CA-idem")
        first = s.record_event("TURN", "t1", {"x": 1})
        second = s.record_event("TURN", "t1", {"x": 1})
        self.assertFalse(first["deduped"])
        self.assertTrue(second["deduped"])
        self.assertEqual(len(s.events), 1)

    def test_draft_kind_mapping(self):
        s = CallSession("CA-kind")
        s.dialogue.slots["intent"] = "LEASING"
        self.assertEqual(s.draft_kind(), "LEASING_LEAD")
        s.dialogue.slots["intent"] = "MAINTENANCE"
        self.assertEqual(s.draft_kind(), "MAINTENANCE_INTAKE")
        s.dialogue.slots["intent"] = "OTHER"
        self.assertEqual(s.draft_kind(), "GENERAL_MESSAGE")

    def test_summary_marks_unknowns(self):
        s = CallSession("CA-summary")
        s.dialogue.slots["intent"] = "LEASING"
        summary = s.summary()
        self.assertIn("not provided", summary)
        self.assertIn("unverified", summary)
        self.assertNotIn("555", summary)  # no invented number in summary


if __name__ == "__main__":
    unittest.main()
