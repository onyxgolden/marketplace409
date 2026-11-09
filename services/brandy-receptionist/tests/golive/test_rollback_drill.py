"""Go-live §5: rollback drill + preflight + retention audit + receipt
redaction.

Preflight is read-only and runs against a temp config; the drill runs
over real HTTP against the in-process server (kill -> health shows
killed -> live sessions ended -> unkill -> health clear). The receipt
never carries a full phone number or a secret.
"""
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))

from app.config import ReceptionistConfig
from app.server import ReceptionistServer, make_handler
from rollback_drill import drill, mask_e164, preflight, retention_audit


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
        operator_token="op-token",
        telephony_enabled=False)
    kwargs.update(overrides)
    return ReceptionistConfig(**kwargs)


def _statuses(checks):
    return {c["check"]: c["status"] for c in checks}


class TestPreflight(unittest.TestCase):
    def test_preflight_passes_on_a_clean_off_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            checks = preflight(config, tmp)
            statuses = _statuses(checks)
            self.assertEqual(statuses["activation_record"], "PASS")  # OFF is fine
            self.assertEqual(statuses["kill_switch_readable"], "PASS")
            self.assertEqual(statuses["disclosure_pinned"], "PASS")
            self.assertEqual(statuses["fallback_twiml_renders"], "PASS")
            # Fix round 1, P2-2: the default fallback records nothing.
            self.assertEqual(statuses["fallback_records_only_when_approved"], "PASS")
            self.assertEqual(statuses["voicemail_recording_policy"], "PASS")
            self.assertEqual(statuses["recording_off_by_default"], "PASS")
            self.assertEqual(statuses["transcript_storage_off_by_default"], "PASS")
            self.assertEqual(statuses["test_number_configured"], "PASS")
            self.assertEqual(statuses["cost_ledger_readable"], "PASS")
            # The test number is masked in the detail — never the full E.164.
            detail = next(c for c in checks if c["check"] == "test_number_configured")["detail"]
            self.assertNotIn("+15551234567", detail)
            self.assertIn("4567", detail)

    def test_preflight_fails_on_a_corrupt_data_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            with open(config.cost_ledger_path, "w", encoding="utf-8") as fh:
                fh.write("{not json")
            statuses = _statuses(preflight(config, tmp))
            self.assertEqual(statuses["cost_ledger_readable"], "FAIL")

    def test_preflight_voicemail_flag_without_approval_still_no_record(self):
        # Fix round 1, P2-2: the flag alone never enables recording.
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp, voicemail_recording_enabled=True)
            statuses = _statuses(preflight(config, tmp))
            self.assertEqual(statuses["fallback_records_only_when_approved"], "PASS")
            detail = next(c for c in preflight(config, tmp)
                          if c["check"] == "voicemail_recording_policy")["detail"]
            self.assertIn("records=False", detail)

    def test_preflight_voicemail_approved_and_enabled_records(self):
        # Fix round 1, P2-2: with an APPROVED policy + the flag, the
        # fallback records by design — and the preflight proves the
        # rendered fallback matches the policy.
        import app.policy.disclosure as disc
        original = disc.VOICEMAIL_RECORDING_POLICY["status"]
        try:
            disc.VOICEMAIL_RECORDING_POLICY["status"] = "APPROVED"
            with tempfile.TemporaryDirectory() as tmp:
                config = _config(tmp, voicemail_recording_enabled=True)
                statuses = _statuses(preflight(config, tmp))
                self.assertEqual(statuses["fallback_records_only_when_approved"], "PASS")
                detail = next(c for c in preflight(config, tmp)
                              if c["check"] == "voicemail_recording_policy")["detail"]
                self.assertIn("records=True", detail)
        finally:
            disc.VOICEMAIL_RECORDING_POLICY["status"] = original

    def test_mask_e164(self):
        self.assertEqual(mask_e164("+15551234567"), "+1-***-***-4567")
        self.assertEqual(mask_e164(""), "***")


class TestRetentionAudit(unittest.TestCase):
    def test_clean_dir_passes_except_provider_confirmation(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            statuses = _statuses(retention_audit(config, tmp))
            self.assertEqual(statuses["recording_flag_off"], "PASS")
            self.assertEqual(statuses["transcript_storage_flag_off"], "PASS")
            self.assertEqual(statuses["no_recording_artifacts_in_data"], "PASS")
            # Provider-side retention cannot be checked from this host:
            # always an open operator action, never silently green.
            self.assertEqual(statuses["provider_retention_audited"], "FAIL")
            # Fix round 1, P2-2: Twilio voicemail retention is a separate
            # operator confirmation (nothing to retain while recording
            # is off, but the item stays open until confirmed).
            self.assertEqual(statuses["voicemail_retention_audited"], "FAIL")

    def test_stray_recording_artifact_fails_the_audit(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            with open(os.path.join(tmp, "call-123.wav"), "wb") as fh:
                fh.write(b"RIFF")
            statuses = _statuses(retention_audit(config, tmp))
            self.assertEqual(statuses["no_recording_artifacts_in_data"], "FAIL")


class TestDrillOverHttp(unittest.TestCase):
    def test_drill_kill_and_unkill_over_http(self):
        with tempfile.TemporaryDirectory() as tmp:
            server = ReceptionistServer(_config(tmp))
            httpd = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(server))
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            try:
                port = httpd.server_address[1]
                checks = drill(f"http://127.0.0.1:{port}", "op-token", set_by="test")
            finally:
                httpd.shutdown()
                httpd.server_close()
                server.shutdown()
            statuses = _statuses(checks)
            self.assertEqual(statuses["server_reachable"], "PASS")
            self.assertEqual(statuses["kill_engaged"], "PASS")
            self.assertEqual(statuses["health_shows_killed"], "PASS")
            self.assertEqual(statuses["live_sessions_ended"], "PASS")
            self.assertEqual(statuses["kill_cleared"], "PASS")
            self.assertEqual(statuses["health_shows_not_killed"], "PASS")
            self.assertFalse(server.kill_switch.is_killed())

    def test_drill_with_wrong_token_fails_kill(self):
        with tempfile.TemporaryDirectory() as tmp:
            server = ReceptionistServer(_config(tmp))
            httpd = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(server))
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            try:
                port = httpd.server_address[1]
                checks = drill(f"http://127.0.0.1:{port}", "wrong-token", set_by="test")
            finally:
                httpd.shutdown()
                httpd.server_close()
                server.shutdown()
            statuses = _statuses(checks)
            self.assertEqual(statuses["server_reachable"], "PASS")
            self.assertEqual(statuses["kill_engaged"], "FAIL")
            self.assertFalse(server.kill_switch.is_killed())


if __name__ == "__main__":
    unittest.main()
