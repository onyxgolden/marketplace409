"""Go-live §2: signed activation record — mode comes ONLY from the record.

Covers: sign/verify round-trip, tampered record -> OFF, missing secret ->
OFF, TEST_ONLY requires matching test number, LIVE_APPROVED is
unreachable in this build (no APPROVED disclosure revision), unknown
mode -> OFF, OFF record validates as OFF.
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.activation import load_activation_state, sign_record, validate_record
from app.config import ReceptionistConfig


def _config(tmp, **overrides):
    kwargs = {
        "activation_record_path": os.path.join(tmp, "activation.json"),
        "activation_secret": "test-secret",
        "test_number_sid": "PN-test",
        "test_number_e164": "+15551234567",
    }
    kwargs.update(overrides)
    return ReceptionistConfig(**kwargs)


def _write(path, record):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(record, fh)


class TestActivationRecord(unittest.TestCase):
    def test_sign_verify_round_trip(self):
        record = sign_record({"mode": "TEST_ONLY", "test_number_sid": "PN-test",
                              "test_number_e164": "+15551234567"}, "test-secret")
        result = validate_record(record, "test-secret", "PN-test", "+15551234567")
        self.assertEqual(result["mode"], "TEST_ONLY")
        self.assertTrue(result["valid"])

    def test_tampered_record_is_off(self):
        record = sign_record({"mode": "TEST_ONLY", "test_number_sid": "PN-test",
                              "test_number_e164": "+15551234567"}, "test-secret")
        record["test_number_e164"] = "+15559998888"  # tamper after signing
        result = validate_record(record, "test-secret", "PN-test", "+15551234567")
        self.assertEqual(result["mode"], "OFF")
        self.assertFalse(result["valid"])

    def test_wrong_secret_is_off(self):
        record = sign_record({"mode": "TEST_ONLY", "test_number_sid": "PN-test",
                              "test_number_e164": "+15551234567"}, "test-secret")
        result = validate_record(record, "other-secret", "PN-test", "+15551234567")
        self.assertEqual(result["mode"], "OFF")

    def test_missing_secret_is_off(self):
        record = sign_record({"mode": "TEST_ONLY", "test_number_sid": "PN-test",
                              "test_number_e164": "+15551234567"}, "test-secret")
        result = validate_record(record, "", "PN-test", "+15551234567")
        self.assertEqual(result["mode"], "OFF")

    def test_test_only_number_mismatch_is_off(self):
        record = sign_record({"mode": "TEST_ONLY", "test_number_sid": "PN-other",
                              "test_number_e164": "+15551234567"}, "test-secret")
        result = validate_record(record, "test-secret", "PN-test", "+15551234567")
        self.assertEqual(result["mode"], "OFF")

    def test_test_only_missing_number_is_off(self):
        record = sign_record({"mode": "TEST_ONLY"}, "test-secret")
        result = validate_record(record, "test-secret", "PN-test", "+15551234567")
        self.assertEqual(result["mode"], "OFF")

    def test_off_record_validates_off(self):
        record = sign_record({"mode": "OFF"}, "test-secret")
        result = validate_record(record, "test-secret", "PN-test", "+15551234567")
        self.assertEqual(result["mode"], "OFF")
        self.assertTrue(result["valid"])

    def test_unknown_mode_is_off(self):
        record = sign_record({"mode": "PROD"}, "test-secret")
        result = validate_record(record, "test-secret", "PN-test", "+15551234567")
        self.assertEqual(result["mode"], "OFF")

    def test_live_approved_unreachable_without_attorney_revision(self):
        # Even with owner word + rehearsal receipts, LIVE_APPROVED cannot
        # validate while no disclosure revision is APPROVED.
        record = sign_record({
            "mode": "LIVE_APPROVED", "test_number_sid": "PN-test",
            "test_number_e164": "+15551234567", "owner_word": True,
            "rehearsal_receipts": ["receipt-1"],
            "attorney_disclosure_revision": "draft-2026-11-08",
        }, "test-secret")
        result = validate_record(record, "test-secret", "PN-test", "+15551234567")
        self.assertEqual(result["mode"], "OFF")
        self.assertIn("attorney-approved", result["reason"])

    def test_live_approved_without_owner_word_is_off(self):
        record = sign_record({
            "mode": "LIVE_APPROVED", "test_number_sid": "PN-test",
            "test_number_e164": "+15551234567",
            "rehearsal_receipts": ["receipt-1"],
            "attorney_disclosure_revision": "draft-2026-11-08",
        }, "test-secret")
        result = validate_record(record, "test-secret", "PN-test", "+15551234567")
        self.assertEqual(result["mode"], "OFF")

    def test_load_missing_file_is_off(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            state = load_activation_state(config)
            self.assertEqual(state["mode"], "OFF")
            self.assertFalse(state["valid"])

    def test_load_valid_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            _write(config.activation_record_path, sign_record(
                {"mode": "TEST_ONLY", "test_number_sid": "PN-test",
                 "test_number_e164": "+15551234567"}, "test-secret"))
            state = load_activation_state(config)
            self.assertEqual(state["mode"], "TEST_ONLY")
            self.assertTrue(state["valid"])


if __name__ == "__main__":
    unittest.main()
