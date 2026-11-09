"""§11.12/§11.15 compliance + security: Twilio signature, short-lived
stream tokens bound to call SID + operation, disabled-by-default live
features, no raw PII in logs.
"""
import base64
import hashlib
import hmac
import os
import sys
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.config import DisabledError, ReceptionistConfig
from app.session import CallSession, mask_e164
from app.telephony_twilio import (sign_stream_token, verify_stream_token,
                                 verify_twilio_signature)


class TestTwilioSignature(unittest.TestCase):
    def test_valid_signature(self):
        token, url = "test-auth-token", "https://example.test/twilio/voice"
        params = {"CallSid": "CA123", "From": "+15552345678"}
        data = url + "".join(f"{k}{params[k]}" for k in sorted(params))
        sig = base64.b64encode(hmac.new(token.encode(), data.encode(), hashlib.sha1).digest()).decode()
        self.assertTrue(verify_twilio_signature(token, url, params, sig))

    def test_tampered_param_rejected(self):
        token, url = "test-auth-token", "https://example.test/twilio/voice"
        params = {"CallSid": "CA123"}
        data = url + "CallSidCA123"
        sig = base64.b64encode(hmac.new(token.encode(), data.encode(), hashlib.sha1).digest()).decode()
        self.assertFalse(verify_twilio_signature(token, url, {"CallSid": "CA999"}, sig))
        self.assertFalse(verify_twilio_signature(token, url, params, ""))
        self.assertFalse(verify_twilio_signature("", url, params, sig))


class TestStreamToken(unittest.TestCase):
    def test_valid_token_bound_to_call_and_operation(self):
        token = sign_stream_token("secret", "CA123", "brandy-rental-office")
        self.assertTrue(verify_stream_token("secret", token, "CA123", "brandy-rental-office"))

    def test_wrong_call_sid_rejected(self):
        token = sign_stream_token("secret", "CA123", "brandy-rental-office")
        self.assertFalse(verify_stream_token("secret", token, "CA999", "brandy-rental-office"))

    def test_expired_token_rejected(self):
        token = sign_stream_token("secret", "CA123", "brandy-rental-office",
                                  issued_at=int(time.time()) - 600)
        self.assertFalse(verify_stream_token("secret", token, "CA123", "brandy-rental-office"))

    def test_tampered_token_rejected(self):
        token = sign_stream_token("secret", "CA123", "brandy-rental-office")
        self.assertFalse(verify_stream_token("secret", token + "x", "CA123", "brandy-rental-office"))


class TestDisabledByDefault(unittest.TestCase):
    def test_all_live_features_off_without_env(self):
        for var in ("RECEPTIONIST_TELEPHONY_ENABLED", "RECEPTIONIST_OUTBOUND_ALERTS_ENABLED",
                    "RECEPTIONIST_RECORDING_ENABLED", "RECEPTIONIST_TRANSCRIPT_STORAGE_ENABLED",
                    "RECEPTIONIST_LIVE_TENANT_SYNC_ENABLED"):
            os.environ.pop(var, None)
        config = ReceptionistConfig()
        self.assertFalse(config.telephony_enabled)
        self.assertFalse(config.outbound_alerts_enabled)
        self.assertFalse(config.recording_enabled)
        self.assertFalse(config.transcript_storage_enabled)
        self.assertFalse(config.live_tenant_sync_enabled)
        for feature in ("telephony", "outbound_alerts", "recording", "transcript_storage", "live_tenant_sync"):
            with self.assertRaises(DisabledError, msg=feature):
                config.require_live(feature)

    def test_opening_disclosure_precedes_substantive_content(self):
        session = CallSession("CA-disclose")
        opening = session.dialogue.start()
        text = opening["speak"]["text"]
        self.assertIn("AI assistant", text)
        self.assertIn("transcribed", text)


class TestNoPiiInLogs(unittest.TestCase):
    def test_masked_number_in_log_record(self):
        session = CallSession("CA-mask", ani="+15552345678")
        record = session.log("call started", ani="+15552345678", callback_e164="+15552345678")
        dumped = str(record)
        self.assertNotIn("5552345678", dumped)
        self.assertIn("5678", dumped)  # last-4 only

    def test_mask_helper(self):
        self.assertEqual(mask_e164("+15552345678"), "+1-***-***-5678")
        self.assertIsNone(mask_e164(None))


if __name__ == "__main__":
    unittest.main()
