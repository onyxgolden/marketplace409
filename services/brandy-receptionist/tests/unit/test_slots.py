"""§11.6 structured capture: phone validation, digit-by-digit readback,
explicit confirmation, invalidation on correction, ANI never substituted.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.policy.slots import (CallbackSlot, digits_spaced, normalize_e164,
                             parse_spoken_number, validate_name, validate_need)


class TestPhoneParsing(unittest.TestCase):
    def test_spoken_digit_words(self):
        self.assertEqual(parse_spoken_number("five five five two three four five six seven eight"), "5552345678")

    def test_double_triple(self):
        self.assertEqual(parse_spoken_number("five five five double zero one two three"), "55500123")

    def test_dashed_digits(self):
        self.assertEqual(parse_spoken_number("555-234-5678"), "5552345678")

    def test_normalize_valid(self):
        self.assertEqual(normalize_e164("5552345678"), "+15552345678")
        self.assertEqual(normalize_e164("(555) 234-5678"), "+15552345678")
        self.assertEqual(normalize_e164("+1 555 234 5678"), "+15552345678")

    def test_normalize_rejects_invalid(self):
        self.assertIsNone(normalize_e164("555010234"))      # too short
        self.assertIsNone(normalize_e164("55523456785"))    # too long
        self.assertIsNone(normalize_e164("0550105678"))     # area code starts 0
        self.assertIsNone(normalize_e164(""))


class TestCallbackSlot(unittest.TestCase):
    def test_happy_path_readback_then_confirm(self):
        slot = CallbackSlot()
        proposed = slot.propose("five five five two three four five six seven eight", "t3")
        self.assertTrue(proposed["ok"])
        self.assertEqual(proposed["e164"], "+15552345678")
        self.assertEqual(digits_spaced("+15552345678"), list("5552345678"))
        confirmed = slot.confirm("yes", "t4")
        self.assertTrue(confirmed["ok"])
        self.assertEqual(slot.status, "CONFIRMED")
        self.assertEqual(slot.confirmation_turn_id, "t4")

    def test_correction_invalidates_prior_confirmation(self):
        slot = CallbackSlot()
        slot.propose("five five five two three four five six seven eight", "t3")
        slot.confirm("yes", "t4")
        self.assertTrue(slot.confirmed)
        slot.propose("five five five nine eight seven six five four three", "t5")
        self.assertFalse(slot.confirmed)
        self.assertIsNone(slot.confirmation_turn_id)
        self.assertEqual(slot.status, "READBACK")  # fresh readback required

    def test_two_failed_attempts_goes_unverified(self):
        slot = CallbackSlot(max_attempts=2)
        slot.propose("not a number", "t3")
        self.assertEqual(slot.status, "MISSING")
        slot.propose("still not a number", "t4")
        self.assertEqual(slot.status, "UNVERIFIED")
        self.assertFalse(slot.confirmed)

    def test_negation_after_readback_restarts_capture(self):
        slot = CallbackSlot()
        slot.propose("five five five two three four five six seven eight", "t3")
        out = slot.confirm("no, that's wrong", "t4")
        self.assertFalse(out["ok"])
        self.assertIsNone(slot.proposed_e164)

    def test_ani_kept_separate_never_confirmed(self):
        slot = CallbackSlot()
        slot.ani_unverified = "+15550109999"
        self.assertFalse(slot.confirmed)
        self.assertIsNone(slot.proposed_e164)
        self.assertEqual(slot.ani_unverified, "+15550109999")

    def test_name_and_need_validation(self):
        self.assertEqual(validate_name("Alex Testcaller"), "Alex Testcaller")
        self.assertIsNone(validate_name(""))
        self.assertIsNone(validate_name("15678"))
        self.assertIsNone(validate_need("x"))
        self.assertEqual(validate_need("sink is leaking"), "sink is leaking")


if __name__ == "__main__":
    unittest.main()
