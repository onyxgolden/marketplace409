"""Go-live §4: emergency alerts behind the live gate — no consent, no
send; refused dispatches are recorded, never dropped, never escalated;
a kill mid-escalation refuses the backup wave; provider-accepted is
never a human ACK.

The Twilio transport uses an injected fake client (no network). The
dispatcher is exercised through its real gates: live_gate is a
callable that raises AlertRefused when the mode/kill forbids sending.
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.integrations.alerts import (
    AlertDispatcher, AlertRefused, FakeAlertTransport, RecipientAllowlist,
    TwilioAlertTransport)


class _FakeTwilioMessages:
    def __init__(self):
        self.created = []

    def create(self, **kwargs):
        sid = "SM-" + str(len(self.created) + 1)
        self.created.append({**kwargs, "sid": sid})
        return type("Msg", (), {"sid": sid})()


class _FakeTwilioCalls:
    def __init__(self):
        self.created = []

    def create(self, **kwargs):
        sid = "CA-" + str(len(self.created) + 1)
        self.created.append({**kwargs, "sid": sid})
        return type("Call", (), {"sid": sid})()


class _FakeTwilioClient:
    def __init__(self):
        self.messages = _FakeTwilioMessages()
        self.calls = _FakeTwilioCalls()


def _consented_allowlist(*, voice=True, sms=True):
    consent = {}
    if voice:
        consent["voice"] = {"given": True, "given_at": "2026-11-08T00:00:00Z",
                            "recorded_by": "operator"}
    if sms:
        consent["sms"] = {"given": True, "given_at": "2026-11-08T00:00:00Z",
                          "recorded_by": "operator"}
    return RecipientAllowlist({
        "PRIMARY": {"name": "Brandy Morgan", "voice_e164": "+15551234567",
                    "sms_e164": "+15551234567", "consent": consent}})


def _transport(allowlist, client=None):
    return TwilioAlertTransport(
        "AC-x", "tok", "+15550001111", allowlist=allowlist,
        client=client if client is not None else _FakeTwilioClient())


def _gate_raising(message):
    def gate():
        raise AlertRefused(message)
    return gate


class TestTwilioAlertTransport(unittest.TestCase):
    def test_no_consented_recipient_means_no_provider_call(self):
        client = _FakeTwilioClient()
        transport = _transport(RecipientAllowlist({}), client)
        result = transport.send(role="PRIMARY", channel="SMS", message="water leak")
        self.assertFalse(result["accepted"])
        self.assertEqual(result["failure_class"], "no_consented_recipient")
        self.assertEqual(client.messages.created, [])
        self.assertEqual(client.calls.created, [])

    def test_consented_sms_recipient_reaches_the_provider(self):
        client = _FakeTwilioClient()
        transport = _transport(_consented_allowlist(), client)
        result = transport.send(role="PRIMARY", channel="SMS", message="water leak")
        self.assertTrue(result["accepted"])
        self.assertEqual(result["sid"], "SM-1")
        self.assertEqual(client.messages.created[0]["to"], "+15551234567")
        self.assertEqual(client.messages.created[0]["from_"], "+15550001111")

    def test_consented_voice_recipient_places_a_call(self):
        client = _FakeTwilioClient()
        transport = _transport(_consented_allowlist(), client)
        result = transport.send(role="PRIMARY", channel="VOICE", message="water leak")
        self.assertTrue(result["accepted"])
        self.assertEqual(result["sid"], "CA-1")
        self.assertEqual(client.calls.created[0]["to"], "+15551234567")

    def test_sms_only_consent_blocks_voice(self):
        client = _FakeTwilioClient()
        transport = _transport(_consented_allowlist(voice=False), client)
        result = transport.send(role="PRIMARY", channel="VOICE", message="water leak")
        self.assertFalse(result["accepted"])
        self.assertEqual(client.calls.created, [])


class TestRecipientAllowlist(unittest.TestCase):
    def test_empty_by_default_and_consent_is_per_channel(self):
        allowlist = RecipientAllowlist({})
        self.assertIsNone(allowlist.resolve("PRIMARY", "SMS"))
        allowlist = _consented_allowlist(voice=False)
        self.assertEqual(allowlist.resolve("PRIMARY", "SMS"), "+15551234567")
        self.assertIsNone(allowlist.resolve("PRIMARY", "VOICE"))
        self.assertIsNone(allowlist.resolve("BACKUP", "SMS"))

    def test_load_of_missing_file_is_empty(self):
        allowlist = RecipientAllowlist.load("/nonexistent/recipients.json")
        self.assertIsNone(allowlist.resolve("PRIMARY", "SMS"))


class TestDispatcherLiveGate(unittest.TestCase):
    def _dispatcher(self, tmp, *, transport=None, gate=None, allowlist=None):
        return AlertDispatcher(
            transport or FakeAlertTransport(),
            scheduler_enabled=False, state_path=os.path.join(tmp, "alerts.json"),
            live_gate=gate, recipient_allowlist=allowlist)

    def test_off_mode_dispatch_is_refused_and_recorded(self):
        with tempfile.TemporaryDirectory() as tmp:
            dispatcher = self._dispatcher(tmp, gate=_gate_raising("activation mode OFF"))
            record = dispatcher.dispatch_emergency("emg-off-1", "WATER", "Water emergency.")
            self.assertEqual(record["state"], "REFUSED")
            self.assertEqual(record["resolution_state"], "UNRESOLVED")
            self.assertIn("OFF", record["refused_reason"])
            self.assertEqual(record["attempts"], [])
            # Refused, never dropped: the record persists and is findable.
            self.assertEqual(dispatcher.get("emg-off-1")["state"], "REFUSED")
            # Idempotent: a duplicate dispatch returns the same record.
            again = dispatcher.dispatch_emergency("emg-off-1", "WATER", "Water emergency.")
            self.assertIs(again, record)

    def test_refused_alert_is_never_escalated_to_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            dispatcher = self._dispatcher(tmp, gate=_gate_raising("activation mode OFF"))
            dispatcher.dispatch_emergency("emg-off-2", "WATER", "Water emergency.")
            record = dispatcher.check_ack_timeout("emg-off-2")
            self.assertEqual(record["state"], "REFUSED")
            self.assertEqual(record["attempts"], [])

    def test_kill_mid_escalation_refuses_the_backup_wave(self):
        with tempfile.TemporaryDirectory() as tmp:
            gate_state = {"killed": False}

            def gate():
                if gate_state["killed"]:
                    raise AlertRefused("kill switch engaged")

            dispatcher = self._dispatcher(
                tmp, transport=FakeAlertTransport(),
                gate=gate, allowlist=_consented_allowlist())
            record = dispatcher.dispatch_emergency("emg-kill-1", "WATER", "Water emergency.")
            self.assertEqual(record["state"], "ALERTING")
            gate_state["killed"] = True
            after = dispatcher.check_ack_timeout("emg-kill-1")
            self.assertEqual(after["state"], "REFUSED")
            self.assertEqual(after["resolution_state"], "UNRESOLVED")
            self.assertIn("kill", after["refused_reason"])
            backup = [a for a in after["attempts"] if a.role == "BACKUP"]
            self.assertEqual(backup, [])

    def test_test_mode_dispatch_without_consent_records_failed_attempts(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = _FakeTwilioClient()
            transport = _transport(RecipientAllowlist({}), client)
            dispatcher = self._dispatcher(tmp, transport=transport,
                                          allowlist=RecipientAllowlist({}))
            record = dispatcher.dispatch_emergency("emg-noconsent-1", "WATER",
                                                   "Water emergency.")
            # No consented recipient: the provider is never called, the
            # attempts are recorded FAILED, and the alert stays visible.
            self.assertEqual(client.messages.created, [])
            self.assertEqual(client.calls.created, [])
            self.assertEqual(record["resolution_state"], "UNRESOLVED")
            self.assertTrue(record["attempts"])
            self.assertTrue(all(a.state == "FAILED" for a in record["attempts"]))
            self.assertTrue(all(a.failure_class == "no_consented_recipient"
                                for a in record["attempts"]))


if __name__ == "__main__":
    unittest.main()
