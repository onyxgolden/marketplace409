"""P1-1 (fix round 2): emergency alert persistence is fail-LOUD.

A write/rename/fsync failure must never be swallowed: it is logged at
CRITICAL, sticks in dispatcher health, and flags the alert records —
while the alert attempt itself still goes out (fail-open for the human
alert, per the brief). A corrupt state file is preserved aside and
surfaced, never silently dropped. Two workers sharing one state file
must not clobber each other's alerts, and an acknowledgment recorded
by one worker must survive another worker's later persist.
"""
import json
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.integrations.alerts import AlertDispatcher, FakeAlertTransport


class FakeClock:
    def __init__(self, now=1_000_000.0):
        self.now = now

    def __call__(self):
        return self.now


def make_dispatcher(clock=None, **kwargs):
    kwargs.setdefault("state_path", None)
    kwargs.setdefault("scheduler_enabled", False)
    return AlertDispatcher(FakeAlertTransport(), clock=clock or time.time, **kwargs)


class TestPersistFailureIsLoud(unittest.TestCase):
    def test_rename_failure_degrades_health_but_alert_still_goes_out(self):
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "alert-state.json")
            dispatcher = make_dispatcher(clock=clock, state_path=path)
            with mock.patch("os.replace", side_effect=OSError("disk full")):
                alert = dispatcher.dispatch_emergency("emg-p1-1", "FIRE", "Fire.")
            # Fail-open for the human alert: the call still went out.
            self.assertEqual(alert["state"], "ALERTING")
            self.assertTrue(any(a.channel == "VOICE" for a in alert["attempts"]))
            # Fail-LOUD for persistence: sticky, flagged, nothing claimed.
            self.assertEqual(dispatcher.health()["persistence"], "degraded")
            self.assertIn("disk full", dispatcher.health()["last_error"])
            self.assertTrue(alert["persistence_degraded"])
            self.assertFalse(os.path.exists(path))
            # A later successful persist clears the sticky error.
            self.assertTrue(dispatcher._persist_safe())
            self.assertEqual(dispatcher.health()["persistence"], "ok")
            self.assertIsNone(dispatcher.health()["last_error"])
            self.assertTrue(os.path.exists(path))

    def test_write_failure_is_loud(self):
        real_open = open

        def failing_open(path, *args, **kwargs):
            if isinstance(path, str) and path.endswith(".tmp"):
                raise OSError("read-only filesystem")
            return real_open(path, *args, **kwargs)

        clock = FakeClock()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "alert-state.json")
            dispatcher = make_dispatcher(clock=clock, state_path=path)
            with mock.patch("builtins.open", side_effect=failing_open):
                alert = dispatcher.dispatch_emergency("emg-p1-2", "GAS", "Gas.")
            self.assertEqual(dispatcher.health()["persistence"], "degraded")
            self.assertIn("read-only filesystem", dispatcher.health()["last_error"])
            self.assertTrue(alert["persistence_degraded"])

    def test_fsync_failure_is_loud(self):
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "alert-state.json")
            dispatcher = make_dispatcher(clock=clock, state_path=path)
            with mock.patch("os.fsync", side_effect=OSError("fsync failed")):
                dispatcher.dispatch_emergency("emg-p1-3", "WATER", "Water.")
            self.assertEqual(dispatcher.health()["persistence"], "degraded")
            self.assertIn("fsync failed", dispatcher.health()["last_error"])

    def test_ack_persist_failure_is_loud(self):
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "alert-state.json")
            dispatcher = make_dispatcher(clock=clock, state_path=path)
            dispatcher.dispatch_emergency("emg-p1-4", "FIRE", "Fire.")
            self.assertEqual(dispatcher.health()["persistence"], "ok")
            voice_sid = next(a.provider_sid for a in dispatcher.get("emg-p1-4")["attempts"]
                             if a.channel == "VOICE")
            with mock.patch("os.replace", side_effect=OSError("disk full")):
                alert = dispatcher.acknowledge("emg-p1-4", "dtmf", call_sid=voice_sid)
            # The ack itself still resolves in memory...
            self.assertEqual(alert["state"], "ACKNOWLEDGED")
            # ...but persistence says loudly that it is not durable yet.
            self.assertEqual(dispatcher.health()["persistence"], "degraded")
            self.assertTrue(alert["persistence_degraded"])


class TestMissingStatePath(unittest.TestCase):
    def test_no_state_path_reports_unavailable_not_ok(self):
        dispatcher = make_dispatcher(state_path=None)
        self.assertEqual(dispatcher.health()["persistence"], "unavailable")
        alert = dispatcher.dispatch_emergency("emg-p1-5", "FIRE", "Fire.")
        self.assertEqual(alert["state"], "ALERTING")
        self.assertEqual(dispatcher.health()["persistence"], "unavailable")


class TestCorruptStateFile(unittest.TestCase):
    def test_corrupt_file_preserved_aside_and_surfaced(self):
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "alert-state.json")
            with open(path, "w") as fh:
                fh.write("{not json at all")
            dispatcher = make_dispatcher(clock=clock, state_path=path)
            health = dispatcher.health()
            self.assertEqual(health["persistence"], "degraded")
            self.assertIn("unreadable", health["last_error"])
            asides = [n for n in os.listdir(tmp) if n.startswith("alert-state.json.corrupt-")]
            self.assertEqual(len(asides), 1)
            # The dispatcher still works — and the load error stays
            # sticky even after later persists succeed, because prior
            # alerts may have been lost.
            dispatcher.dispatch_emergency("emg-p1-6", "GAS", "Gas.")
            self.assertTrue(dispatcher._persist_safe())
            self.assertEqual(dispatcher.health()["persistence"], "degraded")
            self.assertIn("unreadable", dispatcher.health()["last_error"])

    def test_non_list_state_file_is_corrupt(self):
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "alert-state.json")
            with open(path, "w") as fh:
                json.dump({"not": "a list"}, fh)
            dispatcher = make_dispatcher(clock=clock, state_path=path)
            self.assertEqual(dispatcher.health()["persistence"], "degraded")


class TestRestartAndMultiWorker(unittest.TestCase):
    def test_restart_reload_reports_ok_health(self):
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "alert-state.json")
            first = make_dispatcher(clock=clock, state_path=path)
            first.dispatch_emergency("emg-p1-7", "FIRE", "Fire.")
            second = make_dispatcher(clock=clock, state_path=path)
            self.assertEqual(second.health()["persistence"], "ok")
            self.assertIsNotNone(second.get("emg-p1-7"))

    def test_persisted_bytes_are_on_disk_not_just_memory(self):
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "alert-state.json")
            dispatcher = make_dispatcher(clock=clock, state_path=path)
            dispatcher.dispatch_emergency("emg-p1-8", "WATER", "Water.")
            with open(path) as fh:
                records = json.load(fh)
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]["emergency_event_id"], "emg-p1-8")
            self.assertEqual(len(records[0]["attempts"]), 2)  # voice + SMS
            self.assertNotIn("_dirty", records[0])  # internal keys stay out

    def test_two_workers_share_state_without_clobbering(self):
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "alert-state.json")
            first = make_dispatcher(clock=clock, state_path=path)
            first.dispatch_emergency("emg-p1-9", "FIRE", "Fire.")
            second = make_dispatcher(clock=clock, state_path=path)
            self.assertIsNotNone(second.get("emg-p1-9"))
            second.dispatch_emergency("emg-p1-10", "GAS", "Gas.")
            third = make_dispatcher(clock=clock, state_path=path)
            self.assertIsNotNone(third.get("emg-p1-9"))
            self.assertIsNotNone(third.get("emg-p1-10"))

    def test_ack_from_one_worker_survives_other_workers_persist(self):
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "alert-state.json")
            first = make_dispatcher(clock=clock, state_path=path)
            first.dispatch_emergency("emg-p1-11", "FIRE", "Fire.")
            second = make_dispatcher(clock=clock, state_path=path)
            voice_sid = next(a.provider_sid for a in second.get("emg-p1-11")["attempts"]
                             if a.channel == "VOICE")
            second.acknowledge("emg-p1-11", "dtmf", call_sid=voice_sid)
            # First worker still holds the stale pre-ack copy; its next
            # persist must not resurrect the alert as unacknowledged.
            first.dispatch_emergency("emg-p1-12", "GAS", "Gas.")
            third = make_dispatcher(clock=clock, state_path=path)
            self.assertEqual(third.get("emg-p1-11")["state"], "ACKNOWLEDGED")
            self.assertIsNotNone(third.get("emg-p1-12"))


if __name__ == "__main__":
    unittest.main()
