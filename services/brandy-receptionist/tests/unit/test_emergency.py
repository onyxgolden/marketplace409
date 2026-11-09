"""§11.2/§11.3 no-silent-emergency: concurrent primary voice+SMS, backup
on unanswered/5xx/outage, SMS-accepted != ack, bounded attempts, exactly
one logical emergency under duplicate partials/webhook retries.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.integrations.alerts import AlertDispatcher, FakeAlertTransport


class TestEmergencyAlerts(unittest.TestCase):
    def test_primary_voice_and_sms_start_concurrently(self):
        transport = FakeAlertTransport()
        d = AlertDispatcher(transport)
        alert = d.dispatch_emergency("emg-test-1", "WATER", "Water emergency.")
        roles = {(c["role"], c["channel"]) for c in transport.calls}
        self.assertIn(("PRIMARY", "VOICE"), roles)
        self.assertIn(("PRIMARY", "SMS"), roles)
        self.assertEqual(alert["state"], "ALERTING")
        self.assertIsNotNone(alert["detected_at"])

    def test_backup_starts_when_primary_unacknowledged(self):
        transport = FakeAlertTransport(
            outcomes={("PRIMARY", "VOICE"): ["unanswered"], ("PRIMARY", "SMS"): ["accepted"]})
        d = AlertDispatcher(transport)
        d.dispatch_emergency("emg-test-2", "FIRE", "Fire emergency.")
        alert = d.check_ack_timeout("emg-test-2")
        roles = {(c["role"], c["channel"]) for c in transport.calls}
        self.assertIn(("BACKUP", "VOICE"), roles)
        self.assertIn(("BACKUP", "SMS"), roles)
        self.assertEqual(alert["state"], "UNACKNOWLEDGED")
        self.assertEqual(alert["resolution_state"], "UNRESOLVED")
        self.assertIsNotNone(alert["backup_attempted_at"])

    def test_sms_accepted_is_not_human_acknowledgment(self):
        transport = FakeAlertTransport(
            outcomes={("PRIMARY", "SMS"): ["accepted"], ("PRIMARY", "VOICE"): ["accepted"]})
        d = AlertDispatcher(transport)
        alert = d.dispatch_emergency("emg-test-3", "GAS", "Gas emergency.")
        self.assertIsNone(alert["human_ack_at"])
        # Even with both provider-accepted, no ack exists until explicit.
        d.check_ack_timeout("emg-test-3")
        self.assertEqual(d.get("emg-test-3")["state"], "UNACKNOWLEDGED")

    def test_provider_5xx_triggers_backup(self):
        transport = FakeAlertTransport(
            outcomes={("PRIMARY", "VOICE"): ["failed_5xx"], ("PRIMARY", "SMS"): ["failed_5xx"]})
        d = AlertDispatcher(transport)
        alert = d.dispatch_emergency("emg-test-4", "WATER", "Water emergency.")
        failed = [a for a in alert["attempts"] if a.state == "FAILED"]
        self.assertEqual(len(failed), 2)
        self.assertEqual(failed[0].failure_class, "provider_5xx")
        d.check_ack_timeout("emg-test-4")
        self.assertIsNotNone(d.get("emg-test-4")["backup_attempted_at"])

    def test_explicit_dtmf_ack_resolves(self):
        transport = FakeAlertTransport()
        d = AlertDispatcher(transport)
        d.dispatch_emergency("emg-test-5", "LOCKOUT", "Lockout emergency.")
        # DTMF ack must name the provider SID of a recorded alert attempt.
        voice_sid = next(a.provider_sid for a in d.get("emg-test-5")["attempts"]
                         if a.channel == "VOICE")
        alert = d.acknowledge("emg-test-5", "dtmf", call_sid=voice_sid)
        self.assertEqual(alert["state"], "ACKNOWLEDGED")
        self.assertIsNotNone(alert["human_ack_at"])
        self.assertEqual(alert["ack_method"], "dtmf")
        # Ack after the deadline is a no-op: already resolved.
        self.assertEqual(d.check_ack_timeout("emg-test-5")["state"], "ACKNOWLEDGED")

    def test_unbound_dtmf_ack_is_rejected(self):
        transport = FakeAlertTransport()
        d = AlertDispatcher(transport)
        d.dispatch_emergency("emg-test-5b", "LOCKOUT", "Lockout emergency.")
        # No call SID, and a SID from no recorded attempt, both fail closed.
        with self.assertRaises(ValueError):
            d.acknowledge("emg-test-5b", "dtmf")
        with self.assertRaises(ValueError):
            d.acknowledge("emg-test-5b", "dtmf", call_sid="FAKE-not-an-attempt")
        self.assertIsNone(d.get("emg-test-5b")["human_ack_at"])
        self.assertEqual(d.get("emg-test-5b")["resolution_state"], "UNRESOLVED")

    def test_answering_alone_is_not_ack(self):
        transport = FakeAlertTransport()
        d = AlertDispatcher(transport)
        with self.assertRaises(ValueError):
            d.acknowledge("emg-test-6", "answered_call")
        d.dispatch_emergency("emg-test-6", "FIRE", "Fire emergency.")
        with self.assertRaises(ValueError):
            d.acknowledge("emg-test-6", "answered_call")

    def test_duplicate_dispatch_is_one_logical_emergency(self):
        transport = FakeAlertTransport()
        d = AlertDispatcher(transport)
        first = d.dispatch_emergency("emg-test-7", "WATER", "Water emergency.")
        second = d.dispatch_emergency("emg-test-7", "WATER", "Water emergency.")
        self.assertIs(first, second)
        self.assertEqual(len(transport.calls), 2)  # one voice + one SMS, not four


if __name__ == "__main__":
    unittest.main()
