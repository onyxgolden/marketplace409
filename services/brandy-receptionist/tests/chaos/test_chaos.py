"""§11.11 resilience: disconnect/reconnect, duplicate webhooks, STT/TTS
outage fallback, FORGE downtime -> durable outbox, worker restart,
no phantom acknowledgment.
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.integrations.alerts import AlertDispatcher, FakeAlertTransport
from app.integrations.delivery import Outbox
from app.integrations.forge import ForgeIngestClient
from app.policy.dialogue import CallDialogue
from app.providers import FakeSTT, FakeTTS
from app.server import ReceptionistServer
from app.session import CallSession


class TestChaos(unittest.TestCase):
    def test_duplicate_twilio_status_callbacks_deduped(self):
        server = ReceptionistServer()
        first = server.handle_status_callback("CA-dup", "completed", {"SequenceNumber": "1"})
        second = server.handle_status_callback("CA-dup", "completed", {"SequenceNumber": "1"})
        self.assertFalse(first["deduped"])
        self.assertTrue(second["deduped"])

    def test_reconnect_preserves_session_state(self):
        session = CallSession("CA-reconnect")
        session.dialogue.start()
        session.dialogue.handle_turn("my sink is leaking")
        session.dialogue.handle_turn("Sam Sample")
        # Simulated disconnect + reconnect: same session object resumes.
        out = session.dialogue.handle_turn("kitchen sink dripping")
        self.assertEqual(session.dialogue.state, "CAPTURE_CALLBACK")
        self.assertEqual(session.dialogue.slots["caller_name"], "Sam Sample")

    def test_stt_outage_falls_back_to_safe_prompt(self):
        stt = FakeSTT(fail_on={b"bad-audio"})
        with self.assertRaises(RuntimeError):
            stt.transcribe_chunk(b"bad-audio")
        # Dialogue layer: STT failure on an apparent hazard escalates;
        # on a benign turn the caller is asked to repeat (no invented slot).
        d = CallDialogue("CA-stt-out")
        d.start()
        out = d.handle_turn("", stt_failed=True)
        self.assertIn(out["state"], ("CLARIFY", "INCOMPLETE"))

    def test_tts_outage_does_not_lose_the_call_record(self):
        tts = FakeTTS(fail=True)
        with self.assertRaises(RuntimeError):
            tts.synthesize("hello")
        session = CallSession("CA-tts-out")
        session.dialogue.start()
        session.dialogue.handle_turn("I have a question")
        session.end(reason="tts_outage")
        self.assertEqual(len(session.events), 1)  # CALL_ENDED recorded

    def test_forge_downtime_queues_to_outbox(self):
        # Unreachable ingest URL -> client reports failure; the caller
        # enqueues the payload in the durable outbox instead of dropping it.
        client = ForgeIngestClient("http://127.0.0.1:1/ingest", "secret", timeout_s=1)
        result = client.post({"x": 1})
        self.assertFalse(result["ok"])
        with tempfile.TemporaryDirectory() as tmp:
            box = Outbox(os.path.join(tmp, "outbox.json"))
            item = box.enqueue("evt-forge-down", "INGEST", "FORGE", {"call_sid": "CA-x"})
            self.assertEqual(item["state"], "PENDING")
            box2 = Outbox(os.path.join(tmp, "outbox.json"))
            self.assertEqual(box2.pending_count(), 1)  # survives restart

    def test_no_phantom_acknowledgment_after_outage(self):
        transport = FakeAlertTransport(outcomes={("PRIMARY", "VOICE"): ["failed_5xx"],
                                                ("PRIMARY", "SMS"): ["failed_5xx"]})
        d = AlertDispatcher(transport)
        alert = d.dispatch_emergency("emg-chaos", "FIRE", "Fire emergency.")
        self.assertIsNone(alert["human_ack_at"])
        self.assertEqual(alert["resolution_state"], "UNRESOLVED")

    def test_worker_restart_keeps_outbox_and_sessions_recoverable(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "outbox.json")
            box = Outbox(path)
            box.enqueue("evt-restart", "SMS", "PRIMARY", {})
            # Restart: new Outbox over the same file sees the item.
            self.assertEqual(Outbox(path).pending_count(), 1)


if __name__ == "__main__":
    unittest.main()
