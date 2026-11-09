"""P1-3: /alerts/ack accepts only verified acknowledgments.

Fail closed: unsigned, forged, wrong-call, or wrong-digit callbacks change
no alert state. Two verified paths only — Twilio-signed DTMF bound to a
recorded alert attempt, or a Bearer operator token from server env.
"""
import base64
import hashlib
import hmac
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.config import ReceptionistConfig
from app.integrations.alerts import AlertDispatcher, FakeAlertTransport
from app.server import ReceptionistServer
from app.telephony_twilio import twiml_alert_call

TWILIO_TOKEN = "test-twilio-auth-token"
OPERATOR_TOKEN = "test-operator-token-only"
URL = "https://example.test/alerts/ack?emergency_event_id=emg-ack-1"


def sign_twilio(url, params, token=TWILIO_TOKEN):
    data = url + "".join(f"{k}{params[k]}" for k in sorted(params))
    return base64.b64encode(
        hmac.new(token.encode(), data.encode(), hashlib.sha1).digest()).decode()


class AckTestCase(unittest.TestCase):
    def setUp(self):
        self._old_token = os.environ.get("RECEPTIONIST_TWILIO_AUTH_TOKEN")
        os.environ["RECEPTIONIST_TWILIO_AUTH_TOKEN"] = TWILIO_TOKEN
        dispatcher = AlertDispatcher(
            FakeAlertTransport(), ack_timeout_s=30,
            state_path=None, scheduler_enabled=False)
        dispatcher.dispatch_emergency("emg-ack-1", "WATER", "Water emergency.")
        self.dispatcher = dispatcher
        self.voice_sid = next(
            a.provider_sid for a in dispatcher.get("emg-ack-1")["attempts"]
            if a.channel == "VOICE")
        config = ReceptionistConfig(operator_token=OPERATOR_TOKEN)
        self.server = ReceptionistServer(config=config, dispatcher=dispatcher)

    def tearDown(self):
        if self._old_token is None:
            os.environ.pop("RECEPTIONIST_TWILIO_AUTH_TOKEN", None)
        else:
            os.environ["RECEPTIONIST_TWILIO_AUTH_TOKEN"] = self._old_token
        self.server.shutdown()

    def dtmf_params(self, call_sid=None, digits="1", event_id="emg-ack-1"):
        return {"emergency_event_id": event_id, "method": "dtmf",
                "CallSid": call_sid if call_sid is not None else self.voice_sid,
                "Digits": digits}

    def dtmf_headers(self, params, token=TWILIO_TOKEN, url=URL):
        sig = sign_twilio(url, params, token) if token else ""
        return {"X-Twilio-Signature": sig}

    def test_valid_dtmf_ack_resolves(self):
        params = self.dtmf_params()
        result = self.server.handle_alert_ack(params, self.dtmf_headers(params), URL)
        self.assertEqual(result["state"], "ACKNOWLEDGED")
        alert = self.dispatcher.get("emg-ack-1")
        self.assertEqual(alert["ack_method"], "dtmf")
        self.assertEqual(alert["actor_ref"], f"twilio:{self.voice_sid}")
        self.assertIsNotNone(alert["human_ack_at"])

    def test_forged_twilio_signature_rejected(self):
        params = self.dtmf_params()
        headers = self.dtmf_headers(params, token="wrong-token")
        with self.assertRaises(ValueError):
            self.server.handle_alert_ack(params, headers, URL)
        self.assertIsNone(self.dispatcher.get("emg-ack-1")["human_ack_at"])

    def test_unsigned_dtmf_rejected(self):
        params = self.dtmf_params()
        with self.assertRaises(ValueError):
            self.server.handle_alert_ack(params, {"X-Twilio-Signature": ""}, URL)
        self.assertIsNone(self.dispatcher.get("emg-ack-1")["human_ack_at"])

    def test_wrong_call_sid_rejected(self):
        params = self.dtmf_params(call_sid="FAKE-someone-elses-call")
        with self.assertRaises(ValueError):
            self.server.handle_alert_ack(params, self.dtmf_headers(params), URL)
        self.assertIsNone(self.dispatcher.get("emg-ack-1")["human_ack_at"])

    def test_wrong_digit_rejected(self):
        params = self.dtmf_params(digits="2")
        with self.assertRaises(ValueError):
            self.server.handle_alert_ack(params, self.dtmf_headers(params), URL)
        self.assertIsNone(self.dispatcher.get("emg-ack-1")["human_ack_at"])

    def test_unknown_event_is_not_found(self):
        params = self.dtmf_params(event_id="emg-no-such-event")
        url = "https://example.test/alerts/ack?emergency_event_id=emg-no-such-event"
        with self.assertRaises(LookupError):
            self.server.handle_alert_ack(params, self.dtmf_headers(params, url=url), url)

    def test_valid_authenticated_ack_resolves(self):
        params = {"emergency_event_id": "emg-ack-1", "method": "authenticated"}
        headers = {"Authorization": f"Bearer {OPERATOR_TOKEN}"}
        result = self.server.handle_alert_ack(params, headers, URL)
        self.assertEqual(result["state"], "ACKNOWLEDGED")
        self.assertEqual(self.dispatcher.get("emg-ack-1")["ack_method"], "authenticated")
        self.assertEqual(self.dispatcher.get("emg-ack-1")["actor_ref"], "operator")

    def test_wrong_operator_token_rejected(self):
        params = {"emergency_event_id": "emg-ack-1", "method": "authenticated"}
        headers = {"Authorization": "Bearer not-the-token"}
        with self.assertRaises(ValueError):
            self.server.handle_alert_ack(params, headers, URL)
        self.assertIsNone(self.dispatcher.get("emg-ack-1")["human_ack_at"])

    def test_authenticated_ack_disabled_without_token(self):
        config = ReceptionistConfig(operator_token="")
        server = ReceptionistServer(config=config, dispatcher=self.dispatcher)
        params = {"emergency_event_id": "emg-ack-1", "method": "authenticated"}
        headers = {"Authorization": "Bearer anything"}
        with self.assertRaises(ValueError):
            server.handle_alert_ack(params, headers, URL)
        server.shutdown()

    def test_unknown_method_rejected(self):
        params = {"emergency_event_id": "emg-ack-1", "method": "answered_call"}
        with self.assertRaises(ValueError):
            self.server.handle_alert_ack(params, {}, URL)
        self.assertIsNone(self.dispatcher.get("emg-ack-1")["human_ack_at"])

    def test_alert_twiml_binds_event_and_digit(self):
        twiml = twiml_alert_call("https://example.test/alerts/ack",
                                 "emg-ack-1", "Water emergency.", ack_digit="1")
        self.assertIn("emergency_event_id=emg-ack-1", twiml)
        self.assertIn('numDigits="1"', twiml)
        self.assertIn("<Gather", twiml)


if __name__ == "__main__":
    unittest.main()
