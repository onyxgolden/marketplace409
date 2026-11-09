"""P1-4: backup escalation needs no external caller.

The ack deadline is armed on a dedicated scheduler thread at dispatch;
backup starts on known primary failure immediately; the backup-once
claim collapses repeated timeout checks to one wave; retries are bounded
and dead-letter; a worker restart reloads unresolved alerts and resumes
escalation instead of dropping them.
"""
import os
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.integrations.alerts import AlertDispatcher, FakeAlertTransport


class FakeClock:
    def __init__(self, now=1_000_000.0):
        self.now = now

    def __call__(self):
        return self.now


def make_dispatcher(transport=None, clock=None, **kwargs):
    kwargs.setdefault("state_path", None)
    kwargs.setdefault("scheduler_enabled", False)
    return AlertDispatcher(transport or FakeAlertTransport(),
                           clock=clock or time.time, **kwargs)


class TestEscalationScheduler(unittest.TestCase):
    def test_scheduler_thread_fires_backup_without_manual_call(self):
        # Real clock, tiny deadline: the scheduler alone must start backup.
        dispatcher = AlertDispatcher(
            FakeAlertTransport(), ack_timeout_s=0.05,
            state_path=None, scheduler_enabled=True)
        try:
            dispatcher.dispatch_emergency("emg-sched-1", "FIRE", "Fire emergency.")
            deadline = time.time() + 2.0
            while time.time() < deadline:
                if dispatcher.get("emg-sched-1")["backup_attempted_at"] is not None:
                    break
                time.sleep(0.02)
            alert = dispatcher.get("emg-sched-1")
            self.assertIsNotNone(alert["backup_attempted_at"])
            self.assertEqual(alert["state"], "UNACKNOWLEDGED")
            roles = {(c["role"], c["channel"]) for c in
                     dispatcher.transport.calls}
            self.assertIn(("BACKUP", "VOICE"), roles)
            self.assertIn(("BACKUP", "SMS"), roles)
        finally:
            dispatcher.shutdown()

    def test_ack_before_deadline_prevents_backup(self):
        clock = FakeClock()
        dispatcher = make_dispatcher(clock=clock, ack_timeout_s=30)
        dispatcher.dispatch_emergency("emg-sched-2", "GAS", "Gas emergency.")
        voice_sid = next(a.provider_sid for a in dispatcher.get("emg-sched-2")["attempts"]
                         if a.channel == "VOICE")
        dispatcher.acknowledge("emg-sched-2", "dtmf", call_sid=voice_sid)
        clock.now += 60
        self.assertEqual(dispatcher.check_ack_timeout("emg-sched-2")["state"], "ACKNOWLEDGED")
        roles = {(c["role"], c["channel"]) for c in dispatcher.transport.calls}
        self.assertNotIn(("BACKUP", "VOICE"), roles)


class TestBackupOnceClaim(unittest.TestCase):
    def test_repeated_timeout_checks_start_one_backup_wave(self):
        clock = FakeClock()
        dispatcher = make_dispatcher(clock=clock, ack_timeout_s=30)
        dispatcher.dispatch_emergency("emg-once-1", "WATER", "Water emergency.")
        clock.now += 60
        for _ in range(3):
            dispatcher.check_ack_timeout("emg-once-1")
        backup_calls = [c for c in dispatcher.transport.calls if c["role"] == "BACKUP"]
        self.assertEqual(len(backup_calls), 2)  # one voice + one SMS, not six
        self.assertEqual(dispatcher.get("emg-once-1")["backup_waves"], 1)

    def test_immediate_backup_on_primary_failure(self):
        transport = FakeAlertTransport(
            outcomes={("PRIMARY", "VOICE"): ["failed_5xx"], ("PRIMARY", "SMS"): ["failed_5xx"]})
        dispatcher = make_dispatcher(transport=transport)
        alert = dispatcher.dispatch_emergency("emg-once-2", "WATER", "Water emergency.")
        # Backup started during dispatch; no manual timeout call needed.
        self.assertIsNotNone(alert["backup_attempted_at"])
        roles = {(c["role"], c["channel"]) for c in transport.calls}
        self.assertIn(("BACKUP", "VOICE"), roles)
        self.assertIn(("BACKUP", "SMS"), roles)

    def test_immediate_backup_on_voice_unanswered(self):
        transport = FakeAlertTransport(
            outcomes={("PRIMARY", "VOICE"): ["unanswered"], ("PRIMARY", "SMS"): ["accepted"]})
        dispatcher = make_dispatcher(transport=transport)
        alert = dispatcher.dispatch_emergency("emg-once-3", "FIRE", "Fire emergency.")
        self.assertIsNotNone(alert["backup_attempted_at"])
        self.assertEqual(alert["state"], "UNACKNOWLEDGED")

    def test_in_flight_primary_waits_for_deadline(self):
        # Provider-accepted legs are still ringing, not unanswered: no
        # immediate backup; the deadline still escalates.
        clock = FakeClock()
        dispatcher = make_dispatcher(clock=clock, ack_timeout_s=30)
        dispatcher.dispatch_emergency("emg-once-4", "GAS", "Gas emergency.")
        self.assertIsNone(dispatcher.get("emg-once-4")["backup_attempted_at"])
        clock.now += 60
        dispatcher.check_ack_timeout("emg-once-4")
        self.assertIsNotNone(dispatcher.get("emg-once-4")["backup_attempted_at"])


class TestBoundedRetry(unittest.TestCase):
    def test_retries_then_dead_letter(self):
        clock = FakeClock()
        dispatcher = make_dispatcher(clock=clock, ack_timeout_s=30,
                                     max_attempts=3, backoff_s=(0, 0, 0))
        dispatcher.dispatch_emergency("emg-retry-1", "WATER", "Water emergency.")
        clock.now += 60
        dispatcher.check_ack_timeout("emg-retry-1")  # wave 1
        self.assertEqual(dispatcher.get("emg-retry-1")["state"], "UNACKNOWLEDGED")
        dispatcher.check_ack_timeout("emg-retry-1")  # wave 2 (retry, backoff 0)
        alert = dispatcher.get("emg-retry-1")
        self.assertEqual(alert["state"], "DEAD_LETTER")
        self.assertEqual(alert["resolution_state"], "DEAD_LETTER")
        backup_calls = [c for c in dispatcher.transport.calls if c["role"] == "BACKUP"]
        self.assertEqual(len(backup_calls), 4)  # two waves x voice+sms
        # A third check starts nothing more.
        dispatcher.check_ack_timeout("emg-retry-1")
        self.assertEqual(len([c for c in dispatcher.transport.calls
                              if c["role"] == "BACKUP"]), 4)


class TestRestartRecovery(unittest.TestCase):
    def test_restart_reloads_unresolved_alert_and_resumes(self):
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "alert-state.json")
            first = make_dispatcher(clock=clock, ack_timeout_s=30, state_path=path)
            first.dispatch_emergency("emg-restart-1", "FIRE", "Fire emergency.")
            self.assertTrue(os.path.exists(path))
            # Simulated worker restart: new dispatcher, same state file.
            second = make_dispatcher(clock=clock, ack_timeout_s=30, state_path=path)
            alert = second.get("emg-restart-1")
            self.assertIsNotNone(alert)
            self.assertEqual(alert["state"], "ALERTING")
            self.assertIsNone(alert["backup_attempted_at"])
            clock.now += 60
            second.check_ack_timeout("emg-restart-1")
            self.assertIsNotNone(second.get("emg-restart-1")["backup_attempted_at"])
            # And the ack still resolves after a restart, bound to the
            # reloaded attempt's provider SID.
            voice_sid = next(a.provider_sid for a in second.get("emg-restart-1")["attempts"]
                             if a.channel == "VOICE")
            second.acknowledge("emg-restart-1", "dtmf", call_sid=voice_sid)
            self.assertEqual(second.get("emg-restart-1")["state"], "ACKNOWLEDGED")

    def test_restart_does_not_replay_acknowledged_alerts(self):
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "alert-state.json")
            first = make_dispatcher(clock=clock, ack_timeout_s=30, state_path=path)
            first.dispatch_emergency("emg-restart-2", "GAS", "Gas emergency.")
            voice_sid = next(a.provider_sid for a in first.get("emg-restart-2")["attempts"]
                             if a.channel == "VOICE")
            first.acknowledge("emg-restart-2", "dtmf", call_sid=voice_sid)
            second = make_dispatcher(clock=clock, ack_timeout_s=30, state_path=path)
            self.assertEqual(second.get("emg-restart-2")["state"], "ACKNOWLEDGED")
            clock.now += 300
            second.check_ack_timeout("emg-restart-2")
            # No backup was ever attempted for the resolved alert.
            self.assertIsNone(second.get("emg-restart-2")["backup_attempted_at"])
            self.assertEqual(second.get("emg-restart-2")["state"], "ACKNOWLEDGED")


if __name__ == "__main__":
    unittest.main()
