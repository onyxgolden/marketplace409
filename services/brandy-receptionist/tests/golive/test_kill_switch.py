"""Go-live §5: kill switch — file state read fresh, atomic writes, audit.

Covers: default not-killed, kill/clear round-trip, a kill written by one
handle is visible to another without a restart (fresh read), the audit
history records every transition, require_not_killed raises while killed.
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.kill_switch import KillSwitch, KillSwitchEngaged, clear, is_killed, kill


class TestKillSwitch(unittest.TestCase):
    def test_default_not_killed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "kill.json")
            self.assertFalse(is_killed(path))
            self.assertEqual(KillSwitch(path).state()["killed"], False)

    def test_kill_then_clear_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "kill.json")
            ks = KillSwitch(path)
            state = ks.kill(reason="drill", set_by="operator")
            self.assertTrue(state["killed"])
            self.assertEqual(state["reason"], "drill")
            self.assertTrue(is_killed(path))
            cleared = ks.clear(reason="drill complete", set_by="operator")
            self.assertFalse(cleared["killed"])
            self.assertFalse(is_killed(path))

    def test_kill_visible_to_another_handle_without_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "kill.json")
            kill(path, reason="operator kill", set_by="op-a")
            # A second handle (a second process, in production) sees it.
            self.assertTrue(KillSwitch(path).is_killed())

    def test_history_records_every_transition(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "kill.json")
            kill(path, reason="r1", set_by="op")
            clear(path, reason="r2", set_by="op")
            kill(path, reason="r3", set_by="op")
            with open(path + ".history.jsonl", encoding="utf-8") as fh:
                rows = [json.loads(line) for line in fh if line.strip()]
            self.assertEqual(len(rows), 3)
            self.assertEqual([r["killed"] for r in rows], [True, False, True])
            self.assertEqual([r["reason"] for r in rows], ["r1", "r2", "r3"])

    def test_require_not_killed_raises_while_killed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "kill.json")
            ks = KillSwitch(path)
            ks.require_not_killed()  # no raise while clear
            ks.kill(reason="x", set_by="op")
            with self.assertRaises(KillSwitchEngaged):
                ks.require_not_killed()

    def test_corrupt_file_means_not_killed_but_readable_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "kill.json")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("{not json")
            self.assertFalse(is_killed(path))


if __name__ == "__main__":
    unittest.main()
