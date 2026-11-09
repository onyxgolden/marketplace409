"""§11.3/§11.11 outbox: idempotent enqueue, atomic claim, bounded
retry/backoff, dead-letter, restart persistence.
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.integrations.delivery import MAX_ATTEMPTS, Outbox


class TestOutbox(unittest.TestCase):
    def test_idempotent_enqueue(self):
        box = Outbox()
        a = box.enqueue("evt-1", "SMS", "PRIMARY", {"msg": "hi"})
        b = box.enqueue("evt-1", "SMS", "PRIMARY", {"msg": "hi"})
        self.assertEqual(a["key"], b["key"])
        self.assertEqual(box.pending_count(), 1)

    def test_claim_is_atomic(self):
        box = Outbox()
        box.enqueue("evt-1", "SMS", "PRIMARY", {})
        claimed = box.claim_due()
        self.assertEqual(len(claimed), 1)
        self.assertEqual(box.claim_due(), [])  # second claim sees nothing

    def test_bounded_retry_then_dead_letter(self):
        box = Outbox()
        item = box.enqueue("evt-2", "VOICE", "BACKUP", {})
        for _ in range(MAX_ATTEMPTS):
            box.claim_due(now=1e9)
            box.mark_failed(item["key"], "provider_5xx", now=1e9)
        self.assertEqual(box.dead_letter()[0]["key"], item["key"])
        self.assertEqual(box.pending_count(), 0)

    def test_backoff_grows_between_attempts(self):
        box = Outbox()
        item = box.enqueue("evt-3", "SMS", "PRIMARY", {})
        box.claim_due(now=1000.0)
        out = box.mark_failed(item["key"], "timeout", now=1000.0)
        self.assertGreater(out["next_attempt_at"], 1000.0)
        self.assertEqual(out["state"], "PENDING")

    def test_restart_persists_pending_items(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "outbox.json")
            box = Outbox(path)
            box.enqueue("evt-4", "SMS", "PRIMARY", {"msg": "x"})
            box2 = Outbox(path)  # simulated worker restart
            self.assertEqual(box2.pending_count(), 1)
            self.assertEqual(box2.claim_due()[0]["event_id"], "evt-4")


if __name__ == "__main__":
    unittest.main()
