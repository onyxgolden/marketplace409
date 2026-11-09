"""Go-live §2/§3/§5/§8: the server's fail-closed gates — voice webhook
signature + mode + kill + number checks, health/operator status, kill
ending live sessions, make_pipeline key behavior, end_live_session
cost + REFUSED-alert attach, outbox delivery gates.

Signature computation mirrors app.telephony_twilio.verify_twilio_signature
(HMAC-SHA1 over url + sorted params, base64). All numbers are the
fictional 555 test numbers; no vendor is contacted.
"""
import base64
import hashlib
import hmac
import json
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.activation import sign_record
from app.config import ReceptionistConfig
from app.providers import ProviderAuthError
from app.server import ReceptionistServer
from app.session import CallSession

TOKEN = "fake-twilio-auth-token"
URL = "https://worker.example.com/twilio/voice"


def _config(tmp, **overrides):
    kwargs = dict(
        activation_record_path=os.path.join(tmp, "activation.json"),
        activation_secret="test-secret",
        test_number_sid="PN-test",
        test_number_e164="+15551234567",
        kill_switch_path=os.path.join(tmp, "kill.json"),
        cost_ledger_path=os.path.join(tmp, "ledger.json"),
        alert_state_path=os.path.join(tmp, "alerts.json"),
        delivery_outbox_path=os.path.join(tmp, "outbox.json"),
        stream_token_secret="stream-secret",
        worker_public_url="https://worker.example.com",
        fallback_forward_e164="+15559876543",
        telephony_enabled=True,
        outbound_alerts_enabled=False)
    kwargs.update(overrides)
    return ReceptionistConfig(**kwargs)


def _sig(params, url=URL, token=TOKEN):
    data = url + "".join(f"{k}{params[k]}" for k in sorted(params))
    return base64.b64encode(
        hmac.new(token.encode(), data.encode(), hashlib.sha1).digest()).decode()


def _write_test_only_record(config):
    with open(config.activation_record_path, "w", encoding="utf-8") as fh:
        json.dump(sign_record({
            "mode": "TEST_ONLY", "test_number_sid": "PN-test",
            "test_number_e164": "+15551234567"}, "test-secret"), fh)


def _params(to="+15551234567"):
    return {"CallSid": "CA-web-1", "To": to, "From": "+15551112222"}


class TestVoiceWebhook(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._env = mock.patch.dict(os.environ, {"RECEPTIONIST_TWILIO_AUTH_TOKEN": TOKEN})
        self._env.start()
        self.addCleanup(self._env.stop)

    def _server(self, **overrides):
        server = ReceptionistServer(_config(self._tmp.name, **overrides))
        self.addCleanup(server.shutdown)
        return server

    def test_bad_signature_is_403(self):
        server = self._server()
        status, ctype, body = server.handle_voice_webhook(_params(), URL, "bogus")
        self.assertEqual(status, 403)
        self.assertEqual(ctype, "application/json")
        self.assertIn("invalid Twilio signature", body)

    def test_telephony_disabled_is_503(self):
        server = self._server(telephony_enabled=False)
        params = _params()
        status, _, body = server.handle_voice_webhook(params, URL, _sig(params))
        self.assertEqual(status, 503)
        self.assertIn("telephony", body.lower())

    def test_off_mode_serves_human_fallback(self):
        server = self._server()
        params = _params()
        status, ctype, body = server.handle_voice_webhook(params, URL, _sig(params))
        self.assertEqual(status, 200)
        self.assertEqual(ctype, "text/xml")
        self.assertIn("<Response>", body)
        # Fix round 1, P2-2: the OFF fallback must not record — no
        # <Record>, and no promise of a message it cannot take.
        self.assertIn("call back later", body)
        self.assertNotIn("leave a message", body)
        self.assertNotIn("<Record", body)
        self.assertNotIn("<Stream", body)

    def test_test_only_correct_number_serves_stream_twiml(self):
        server = self._server()
        _write_test_only_record(server.config)
        params = _params()
        status, _, body = server.handle_voice_webhook(params, URL, _sig(params))
        self.assertEqual(status, 200)
        self.assertIn("<Stream", body)
        self.assertIn("wss://worker.example.com:8765", body)
        self.assertIn("you've reached Brandy's rental office", body)
        self.assertIn('name="token"', body)

    def test_test_only_wrong_number_serves_fallback(self):
        server = self._server()
        _write_test_only_record(server.config)
        params = _params(to="+15550009999")
        status, _, body = server.handle_voice_webhook(params, URL, _sig(params))
        self.assertEqual(status, 200)
        self.assertNotIn("<Stream", body)
        # Fix round 1, P2-2: the wrong-number fallback records nothing.
        self.assertIn("call back later", body)
        self.assertNotIn("<Record", body)

    def test_kill_serves_fallback_with_forward(self):
        server = self._server()
        _write_test_only_record(server.config)
        server.handle_kill(reason="drill", set_by="test")
        params = _params()
        status, _, body = server.handle_voice_webhook(params, URL, _sig(params))
        self.assertEqual(status, 200)
        self.assertNotIn("<Stream", body)
        self.assertIn("<Dial", body)
        self.assertIn("+15559876543", body)
        # Fix round 1, P2-2: even the kill fallback with a forward
        # destination records nothing without an approved policy.
        self.assertNotIn("<Record", body)


class TestVoicemailRecording(unittest.TestCase):
    """Fix round 1, P2-2: a <Record> in the fallback is a recording
    (transcribe="false" disables transcription, NOT recording), so the
    fallback records only when the operator enabled it AND an
    attorney-APPROVED voicemail disclosure exists. Either gate missing
    means no <Record> — OFF, kill, and worker-unreachable fallbacks
    never create unapproved recordings."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._env = mock.patch.dict(os.environ, {"RECEPTIONIST_TWILIO_AUTH_TOKEN": TOKEN})
        self._env.start()
        self.addCleanup(self._env.stop)

    def _server(self, **overrides):
        server = ReceptionistServer(_config(self._tmp.name, **overrides))
        self.addCleanup(server.shutdown)
        return server

    def _off_fallback(self, server):
        params = _params()
        status, _, body = server.handle_voice_webhook(params, URL, _sig(params))
        self.assertEqual(status, 200)
        return body

    def test_flag_on_without_approved_policy_still_does_not_record(self):
        import app.policy.disclosure as disc
        self.assertEqual(disc.VOICEMAIL_RECORDING_POLICY["status"], "UNAPPROVED")
        server = self._server(voicemail_recording_enabled=True)
        body = self._off_fallback(server)
        self.assertNotIn("<Record", body)
        self.assertIn("call back later", body)

    def test_approved_policy_plus_flag_records_with_disclosure(self):
        import app.policy.disclosure as disc
        original = disc.VOICEMAIL_RECORDING_POLICY["status"]
        try:
            disc.VOICEMAIL_RECORDING_POLICY["status"] = "APPROVED"
            server = self._server(voicemail_recording_enabled=True)
            body = self._off_fallback(server)
            self.assertIn("<Record", body)
            # The approved voicemail disclosure is spoken first.
            self.assertIn("recorded as a voicemail", body)
        finally:
            disc.VOICEMAIL_RECORDING_POLICY["status"] = original

    def test_flag_off_with_approved_policy_does_not_record(self):
        import app.policy.disclosure as disc
        original = disc.VOICEMAIL_RECORDING_POLICY["status"]
        try:
            disc.VOICEMAIL_RECORDING_POLICY["status"] = "APPROVED"
            server = self._server(voicemail_recording_enabled=False)
            body = self._off_fallback(server)
            self.assertNotIn("<Record", body)
        finally:
            disc.VOICEMAIL_RECORDING_POLICY["status"] = original

    def test_health_reports_voicemail_recording_state(self):
        server = self._server()
        health = server.health()
        self.assertEqual(health["voicemail_recording"], {
            "enabled": False, "policy_approved": False, "records": False})


class TestHealthAndOperatorStatus(unittest.TestCase):
    def test_health_reports_gates_without_secrets(self):
        with tempfile.TemporaryDirectory() as tmp:
            server = ReceptionistServer(_config(tmp))
            try:
                health = server.health()
            finally:
                server.shutdown()
            self.assertEqual(health["activation_mode"], "OFF")
            self.assertFalse(health["kill_switch"]["killed"])
            self.assertEqual(health["disclosure_revision"]["status"], "UNAPPROVED")
            self.assertIn("cost_total_usd", health)
            self.assertIn("cost_per_call_ceiling_usd", health)
            self.assertIn("alert_persistence", health)
            blob = json.dumps(health)
            self.assertNotIn("test-secret", blob)
            self.assertNotIn(TOKEN, blob)
            self.assertNotIn("stream-secret", blob)
            for key in health:
                self.assertNotIn("auth_token", key.lower())
                self.assertNotIn("secret", key.lower())

    def test_operator_status_extends_health(self):
        with tempfile.TemporaryDirectory() as tmp:
            server = ReceptionistServer(_config(tmp))
            try:
                status = server.operator_status()
            finally:
                server.shutdown()
            self.assertEqual(status["cost_by_source"], {"TEST": 0, "LIVE": 0, "SYNTHETIC": 0})
            self.assertEqual(status["alerts_unresolved"], 0)
            self.assertEqual(status["live_sessions"], [])


class TestMakePipeline(unittest.TestCase):
    def test_telephony_enabled_without_keys_raises_auth(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp, telephony_enabled=True)
            _write_test_only_record(config)
            server = ReceptionistServer(config)
            try:
                env = {"DEEPGRAM_API_KEY": "", "OPENAI_API_KEY": "",
                       "CARTESIA_API_KEY": "", "CARTESIA_VOICE_ID": ""}
                with mock.patch.dict(os.environ, env):
                    with self.assertRaises(ProviderAuthError):
                        server.make_pipeline("CA-k-1", source="TEST",
                                             dialogue=CallSession("CA-k-1").dialogue)
            finally:
                server.shutdown()

    def test_telephony_disabled_uses_fakes(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp, telephony_enabled=False)
            _write_test_only_record(config)
            server = ReceptionistServer(config)
            try:
                pipe = server.make_pipeline("CA-f-1", source="TEST",
                                            dialogue=CallSession("CA-f-1").dialogue)
            finally:
                server.shutdown()
            self.assertEqual(type(pipe.stt).__name__, "FakeSTT")
            self.assertEqual(type(pipe.llm).__name__, "FakeLLM")
            self.assertEqual(type(pipe.tts).__name__, "FakeTTS")
            self.assertEqual(pipe.activation_mode, "TEST_ONLY")

    def test_off_mode_refuses_pipeline(self):
        with tempfile.TemporaryDirectory() as tmp:
            server = ReceptionistServer(_config(tmp, telephony_enabled=False))
            try:
                with self.assertRaises(Exception):
                    server.make_pipeline("CA-o-1", source="TEST",
                                         dialogue=CallSession("CA-o-1").dialogue)
            finally:
                server.shutdown()


class TestKillAndEndLiveSession(unittest.TestCase):
    def _live_server(self, tmp):
        config = _config(tmp, telephony_enabled=False)
        _write_test_only_record(config)
        server = ReceptionistServer(config)
        session = CallSession("CA-srv-1", config=config, source="TEST")
        pipeline = server.make_pipeline("CA-srv-1", source="TEST",
                                        dialogue=session.dialogue)
        server.live_sessions["CA-srv-1"] = {
            "session": session, "pipeline": pipeline,
            "source": "TEST", "stream_sid": "MZ-srv-1"}
        return server, session

    def test_kill_ends_live_sessions_immediately(self):
        with tempfile.TemporaryDirectory() as tmp:
            server, _ = self._live_server(tmp)
            try:
                result = server.handle_kill(reason="drill", set_by="test")
                self.assertTrue(result["killed"])
                self.assertEqual(result["sessions_ended"], ["CA-srv-1"])
                self.assertEqual(server.live_sessions, {})
                self.assertTrue(server.health()["kill_switch"]["killed"])
                cleared = server.handle_unkill(reason="drill done", set_by="test")
                self.assertFalse(cleared["killed"])
            finally:
                server.shutdown()

    def test_end_live_session_charges_cost_and_attaches_refused_alert(self):
        with tempfile.TemporaryDirectory() as tmp:
            server, session = self._live_server(tmp)
            try:
                # Emergency detected on the call; outbound alerts are
                # disabled in this config, so the dispatch is REFUSED.
                session.dialogue.handle_turn("water is flooding my kitchen")
                self.assertEqual(session.dialogue.slots.get("emergency_type"), "WATER")
                alert = server.dispatch_emergency_for_session("CA-srv-1")
                self.assertEqual(alert["state"], "REFUSED")
                payload = server.end_live_session("CA-srv-1", "completed")
                self.assertIsNotNone(payload)
                self.assertEqual(payload["source"], "TEST")
                self.assertIn("cost_estimate_usd", payload)
                self.assertGreaterEqual(payload["cost_estimate_usd"], 0)
                self.assertEqual(payload["alert"]["resolution_state"], "REFUSED")
                self.assertIn("outbound alerts disabled", payload["alert"]["refused_reason"])
                # Idempotent: a second end returns None.
                self.assertIsNone(server.end_live_session("CA-srv-1", "completed"))
                # The record reached the outbox (no FORGE URL configured).
                self.assertEqual(server.outbox.pending_count(), 1)
            finally:
                server.shutdown()

    def test_end_live_session_settles_extended_session_minutes(self):
        # Fix round 3, P1: the gateway extends the session reservation
        # one blended minute per elapsed minute; the close settles all
        # of them into one final priced on actual elapsed duration,
        # and the total never exceeds the reserved headroom.
        with tempfile.TemporaryDirectory() as tmp:
            server, session = self._live_server(tmp)
            try:
                # Three session minutes reserved, as the gateway's
                # extension would hold for a ~3-minute call.
                for _ in range(3):
                    server.cost_ledger.reserve(
                        call_sid="CA-srv-1", source="TEST", purpose="session",
                        projected_usd=0.04, max_per_call_usd=0.50,
                        max_campaign_usd=10.0)
                session.started_at = time.time() - 150
                payload = server.end_live_session("CA-srv-1", "completed")
                self.assertIsNotNone(payload)
                self.assertEqual(
                    [e for e in server.cost_ledger.entries()
                     if e.get("kind") == "reservation"], [])
                finals = [e for e in server.cost_ledger.entries()
                          if e.get("usage", {}).get("final") is True]
                self.assertEqual(len(finals), 1)
                self.assertAlmostEqual(finals[0]["usage"]["duration_s"],
                                       150, delta=1)
                self.assertLessEqual(finals[0]["estimated_usd"], 0.12)
                self.assertLessEqual(payload["cost_estimate_usd"], 0.50)
            finally:
                server.shutdown()

    def test_status_callback_then_close_records_one_final(self):
        # Fix round 2, P1: the Twilio status callback and the session
        # close race to record the final duration charge — only the
        # first final entry lands, so the call is never charged twice.
        with tempfile.TemporaryDirectory() as tmp:
            server, session = self._live_server(tmp)
            try:
                server.handle_status_callback(
                    "CA-srv-1", "completed",
                    {"CallDuration": "120", "SequenceNumber": "1"})
                payload = server.end_live_session("CA-srv-1", "completed")
                self.assertIsNotNone(payload)
                finals = [e for e in server.cost_ledger.entries()
                          if e.get("usage", {}).get("final") is True]
                self.assertEqual(len(finals), 1)
                self.assertAlmostEqual(finals[0]["usage"]["duration_s"], 120.0)
                # The session's estimate is the call's TRUE total, not
                # just the close's own (near-zero) duration entry.
                self.assertAlmostEqual(
                    payload["cost_estimate_usd"],
                    server.cost_ledger.call_total_usd("CA-srv-1"))
                self.assertAlmostEqual(
                    payload["cost_estimate_usd"],
                    finals[0]["estimated_usd"])
            finally:
                server.shutdown()

    def test_close_then_status_callback_records_one_final(self):
        # The race in the other order: close first, callback second.
        with tempfile.TemporaryDirectory() as tmp:
            server, session = self._live_server(tmp)
            try:
                payload = server.end_live_session("CA-srv-1", "completed")
                self.assertIsNotNone(payload)
                server.handle_status_callback(
                    "CA-srv-1", "completed",
                    {"CallDuration": "120", "SequenceNumber": "1"})
                finals = [e for e in server.cost_ledger.entries()
                          if e.get("usage", {}).get("final") is True]
                self.assertEqual(len(finals), 1)
                self.assertAlmostEqual(
                    payload["cost_estimate_usd"],
                    server.cost_ledger.call_total_usd("CA-srv-1"))
            finally:
                server.shutdown()

    def test_outbox_gate_off_blocks_alerts_not_ingest(self):
        with tempfile.TemporaryDirectory() as tmp:
            from app.integrations.alerts import AlertRefused
            server = ReceptionistServer(_config(tmp))
            try:
                # Mode OFF: INGEST retries are persistence, not a live action.
                server.require_outbox_delivery({"channel": "INGEST"})
                with self.assertRaises(AlertRefused):
                    server.require_outbox_delivery({"channel": "ALERT"})
                # A kill blocks everything.
                server.handle_kill(reason="drill", set_by="test")
                with self.assertRaises(AlertRefused):
                    server.require_outbox_delivery({"channel": "INGEST"})
            finally:
                server.shutdown()


if __name__ == "__main__":
    unittest.main()
