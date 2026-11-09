"""Go-live §7/§8: cost ledger + ceilings, latency recorder + receipt.

Cost rates are the Nov 8 teardown's verified unit prices: the ~$0.04/min
all-in total must reproduce from the line items. The ledger is durable
(restart recovery) and the ceilings fail closed before a session or an
expensive action. Latency percentiles use nearest-rank; the receipt
compares p95 against the config targets.
"""
import json
import multiprocessing
import os
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.cost import (
    BudgetExceeded, CostLedger, RESERVATION_TTL_S, blended_minute_usd,
    estimate_alert_cost_usd, estimate_call_cost_usd, rate_table)
from app.latency import LatencyRecorder, percentile


class TestRateTable(unittest.TestCase):
    def test_line_items_sum_to_the_teardown_total(self):
        rates = rate_table("1.0")
        total = (rates["twilio_inbound_usd_per_min"]
                 + rates["twilio_media_streams_usd_per_min"]
                 + rates["deepgram_stt_usd_per_min"]
                 + rates["llm_usd_per_min"]
                 + 0.016)  # Cartesia ~$0.016/min of agent speech
        self.assertAlmostEqual(total, 0.039, places=3)

    def test_blended_minute_is_the_planning_number(self):
        self.assertEqual(blended_minute_usd("1.0"), 0.04)

    def test_unknown_version_raises(self):
        with self.assertRaises(ValueError):
            rate_table("9.9")

    def test_call_estimate_scales_with_duration(self):
        one = estimate_call_cost_usd(duration_s=60, agent_chars=400)
        two = estimate_call_cost_usd(duration_s=120, agent_chars=800)
        self.assertAlmostEqual(two, one * 2, places=5)
        self.assertGreater(one, 0.03)
        self.assertLess(one, 0.05)

    def test_alert_cost_by_channel(self):
        self.assertEqual(estimate_alert_cost_usd(channel="SMS"), 0.0079)
        self.assertGreater(estimate_alert_cost_usd(channel="VOICE"), 0.01)


class TestCostLedger(unittest.TestCase):
    def test_record_and_total_survive_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "ledger.json")
            ledger = CostLedger(path)
            entry = ledger.record_call(call_sid="CA-1", source="TEST", duration_s=60,
                                       agent_chars=400)
            self.assertGreater(entry["estimated_usd"], 0)
            self.assertEqual(entry["rate_version"], "1.0")
            self.assertEqual(entry["source"], "TEST")
            ledger2 = CostLedger(path)
            self.assertAlmostEqual(ledger2.total_usd(), entry["estimated_usd"])
            self.assertAlmostEqual(ledger2.call_total_usd("CA-1"), entry["estimated_usd"])
            self.assertEqual(ledger2.total_usd(source="LIVE"), 0)

    def test_alert_entries_recorded(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = CostLedger(os.path.join(tmp, "ledger.json"))
            ledger.record_alert(emergency_event_id="emg-1", source="TEST", channel="SMS")
            self.assertEqual(ledger.total_usd(), 0.0079)

    def test_per_call_ceiling_blocks_before_the_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = CostLedger(os.path.join(tmp, "ledger.json"))
            ledger.record_call(call_sid="CA-1", source="TEST", duration_s=1500,
                               agent_chars=6000)  # ~$0.75: 25 min x $0.0206 + 6000 chars
            with self.assertRaises(BudgetExceeded):
                ledger.check_call_ceiling(call_sid="CA-1", projected_usd=0.04,
                                          max_per_call_usd=0.50, max_campaign_usd=10.0)

    def test_campaign_ceiling_blocks_when_the_campaign_is_spent(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = CostLedger(os.path.join(tmp, "ledger.json"))
            for i in range(5):
                ledger.record_call(call_sid=f"CA-{i}", source="TEST", duration_s=600)
            with self.assertRaises(BudgetExceeded):
                ledger.check_call_ceiling(call_sid="CA-new", projected_usd=0.04,
                                          max_per_call_usd=0.50, max_campaign_usd=1.00)

    def test_ceiling_passes_inside_budget(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = CostLedger(os.path.join(tmp, "ledger.json"))
            ledger.check_call_ceiling(call_sid="CA-1", projected_usd=0.04,
                                      max_per_call_usd=0.50, max_campaign_usd=10.0)


class TestCostReservations(unittest.TestCase):
    """Fix round 1, P1-3: the ceiling is a hard, atomic, fail-closed
    budget — reservations serialize concurrent claims, a corrupt ledger
    refuses spend instead of resetting, and reserved spend reconciles
    into actuals (never double-counted)."""

    def test_reserve_holds_headroom_and_settles_into_actuals(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "ledger.json")
            ledger = CostLedger(path)
            reservation = ledger.reserve(
                call_sid="CA-1", source="TEST", projected_usd=0.04,
                max_per_call_usd=0.50, max_campaign_usd=10.0)
            self.assertEqual(reservation["status"], "reserved")
            # The reservation counts toward the totals while held.
            self.assertAlmostEqual(ledger.total_usd(), 0.04)
            self.assertAlmostEqual(ledger.call_total_usd("CA-1"), 0.04)
            # A restart still sees the held headroom (durable).
            restarted = CostLedger(path)
            self.assertAlmostEqual(restarted.total_usd(), 0.04)
            # Recording the actual cost settles the reservation: the
            # ledger holds the actual only, never actual + reservation.
            entry = restarted.record_call(call_sid="CA-1", source="TEST",
                                          duration_s=60, agent_chars=100)
            self.assertAlmostEqual(restarted.total_usd(), entry["estimated_usd"])
            self.assertEqual(
                [e["kind"] for e in restarted.entries()], ["call"])

    def test_release_reservation_frees_headroom(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = CostLedger(os.path.join(tmp, "ledger.json"))
            reservation = ledger.reserve(
                call_sid="CA-1", source="TEST", projected_usd=0.04,
                max_per_call_usd=0.50, max_campaign_usd=0.05)
            self.assertTrue(ledger.release_reservation(reservation["id"]))
            self.assertAlmostEqual(ledger.total_usd(), 0.0)
            self.assertFalse(ledger.release_reservation(reservation["id"]))
            # And the headroom is usable again.
            ledger.reserve(call_sid="CA-1", source="TEST", projected_usd=0.04,
                           max_per_call_usd=0.50, max_campaign_usd=0.05)

    def test_two_concurrent_reserves_with_one_calls_headroom(self):
        # Campaign headroom for exactly one $0.04 reservation: two
        # threads racing the same claim must yield exactly one winner.
        with tempfile.TemporaryDirectory() as tmp:
            ledger = CostLedger(os.path.join(tmp, "ledger.json"))
            barrier = threading.Barrier(2)
            results = []

            def claim(i):
                barrier.wait(timeout=10)
                try:
                    ledger.reserve(call_sid=f"CA-{i}", source="TEST",
                                   projected_usd=0.04, max_per_call_usd=0.50,
                                   max_campaign_usd=0.05)
                    results.append("reserved")
                except BudgetExceeded:
                    results.append("refused")

            threads = [threading.Thread(target=claim, args=(i,)) for i in (1, 2)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=10)
            self.assertEqual(sorted(results), ["refused", "reserved"])
            self.assertAlmostEqual(ledger.total_usd(), 0.04)

    def test_first_session_refusal_when_campaign_exhausted(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = CostLedger(os.path.join(tmp, "ledger.json"))
            # Spend the campaign down to $0.01 of headroom.
            ledger.record_call(call_sid="CA-0", source="TEST", duration_s=1500,
                               agent_chars=6000)  # ~$0.75 of a $0.76 ceiling
            with self.assertRaises(BudgetExceeded):
                ledger.reserve(call_sid="CA-new", source="TEST",
                               projected_usd=0.04, max_per_call_usd=0.50,
                               max_campaign_usd=0.76)

    def test_corrupt_ledger_fails_closed_on_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "ledger.json")
            ledger = CostLedger(path)
            ledger.record_call(call_sid="CA-1", source="TEST", duration_s=60)
            spent = ledger.total_usd()
            self.assertGreater(spent, 0)
            # Corrupt the file on disk, as a crash or bad write would.
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("{not json")
            restarted = CostLedger(path)
            self.assertTrue(restarted.is_corrupt)
            self.assertIsNotNone(restarted.corrupt_reason)
            # Every spend-authorizing operation refuses — the ledger is
            # NEVER silently reset to an empty campaign.
            with self.assertRaises(BudgetExceeded):
                restarted.reserve(call_sid="CA-2", source="TEST",
                                  projected_usd=0.04, max_per_call_usd=0.50,
                                  max_campaign_usd=10.0)
            with self.assertRaises(BudgetExceeded):
                restarted.check_call_ceiling(call_sid="CA-2", projected_usd=0.04,
                                             max_per_call_usd=0.50,
                                             max_campaign_usd=10.0)
            with self.assertRaises(BudgetExceeded):
                restarted.record_call(call_sid="CA-2", source="TEST", duration_s=60)
            with self.assertRaises(BudgetExceeded):
                restarted.record_alert(emergency_event_id="emg-1",
                                       source="TEST", channel="SMS")
            with self.assertRaises(BudgetExceeded):
                restarted.total_usd()
            # And the corrupt file is still there for the operator to
            # repair — it was not overwritten by any of the refusals.
            with open(path, "r", encoding="utf-8") as fh:
                self.assertEqual(fh.read(), "{not json")

    def test_missing_ledger_is_a_fresh_start(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = CostLedger(os.path.join(tmp, "ledger.json"))
            self.assertFalse(ledger.is_corrupt)
            self.assertEqual(ledger.total_usd(), 0.0)
            ledger.reserve(call_sid="CA-1", source="TEST", projected_usd=0.04,
                           max_per_call_usd=0.50, max_campaign_usd=10.0)

    def test_stale_reservation_is_purged_after_ttl(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "ledger.json")
            ledger = CostLedger(path)
            ledger.reserve(call_sid="CA-1", source="TEST", projected_usd=0.04,
                           max_per_call_usd=0.50, max_campaign_usd=10.0)
            self.assertAlmostEqual(ledger.total_usd(), 0.04)
            # Age the reservation past the TTL on disk (a crashed
            # session's headroom): the next load drops it.
            with open(path, "r", encoding="utf-8") as fh:
                entries = json.load(fh)
            entries[0]["reserved_at"] = time.time() - RESERVATION_TTL_S - 60
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(entries, fh)
            restarted = CostLedger(path)
            self.assertAlmostEqual(restarted.total_usd(), 0.0)
            self.assertEqual(restarted.entries(), [])

    def test_alert_reserve_settles_and_releases_on_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "ledger.json")
            ledger = CostLedger(path)
            reservation = ledger.reserve(
                emergency_event_id="emg-1", channel="SMS", source="TEST",
                projected_usd=estimate_alert_cost_usd(channel="SMS"),
                max_campaign_usd=10.0)
            self.assertAlmostEqual(ledger.total_usd(), 0.0079)
            # A failed send releases the headroom.
            self.assertTrue(ledger.release_reservation(reservation["id"]))
            self.assertAlmostEqual(ledger.total_usd(), 0.0)
            # A successful send settles into the actual alert entry.
            ledger.reserve(emergency_event_id="emg-1", channel="SMS",
                           source="TEST",
                           projected_usd=estimate_alert_cost_usd(channel="SMS"),
                           max_campaign_usd=10.0)
            ledger.record_alert(emergency_event_id="emg-1", source="TEST",
                                channel="SMS")
            self.assertAlmostEqual(ledger.total_usd(), 0.0079)
            self.assertEqual(
                [e["kind"] for e in ledger.entries()], ["alert"])


def _reserve_child(path, call_sid, queue):
    """Multiprocessing worker: one reserve attempt against a shared
    ledger file. Reports 'reserved' or 'refused' back to the parent."""
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    from app.cost import BudgetExceeded, CostLedger
    try:
        ledger = CostLedger(path)
        ledger.reserve(call_sid=call_sid, source="TEST", projected_usd=0.04,
                       max_per_call_usd=0.50, max_campaign_usd=0.05)
        queue.put("reserved")
    except BudgetExceeded:
        queue.put("refused")


class TestCostLedgerMultiWorker(unittest.TestCase):
    def test_two_processes_racing_one_reservation(self):
        # Cross-process proof: two workers sharing one ledger file with
        # headroom for exactly one claim must serialize to one winner.
        # (The fcntl lock + re-read-under-lock is what makes this hold;
        # without it the second worker would clobber the first's entry.)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "ledger.json")
            ctx = multiprocessing.get_context("fork")
            queue = ctx.Queue()
            procs = [ctx.Process(target=_reserve_child,
                                 args=(path, f"CA-{i}", queue))
                     for i in (1, 2)]
            for p in procs:
                p.start()
            for p in procs:
                p.join(timeout=15)
            results = sorted(queue.get(timeout=5) for _ in procs)
            self.assertEqual(results, ["refused", "reserved"])
            ledger = CostLedger(path)
            self.assertAlmostEqual(ledger.total_usd(), 0.04)
            self.assertEqual(len(ledger.entries()), 1)


class TestLatency(unittest.TestCase):
    def test_percentile_nearest_rank(self):
        self.assertEqual(percentile([100, 200, 300, 400], 50), 200)
        self.assertEqual(percentile([100, 200, 300, 400], 95), 400)
        self.assertIsNone(percentile([], 95))

    def test_receipt_pass_and_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            rec = LatencyRecorder(os.path.join(tmp, "latency.jsonl"))
            for i in range(10):
                rec.record_turn(call_sid="CA-1", turn=i, source="TEST",
                                stt_ms=120, llm_ms=150, tts_first_audio_ms=90,
                                e2e_ms=400)
            receipt = rec.receipt(targets={"latency_p95_target_ms": 800,
                                           "barge_in_stop_p95_target_ms": 250})
            self.assertEqual(receipt["turns"], 10)
            self.assertEqual(receipt["stages"]["e2e_ms"]["p95"], 400)
            self.assertEqual(receipt["verdicts"]["e2e_ms"], "PASS")
            self.assertEqual(receipt["verdicts"]["barge_in_stop_ms"], "NO_SAMPLE")

            rec.record_turn(call_sid="CA-2", turn=1, source="TEST", e2e_ms=5000)
            receipt = rec.receipt(targets={"latency_p95_target_ms": 800})
            self.assertEqual(receipt["verdicts"]["e2e_ms"], "FAIL")

    def test_receipt_filters_by_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            rec = LatencyRecorder(os.path.join(tmp, "latency.jsonl"))
            rec.record_turn(call_sid="CA-1", turn=1, source="TEST", e2e_ms=100)
            rec.record_turn(call_sid="CA-2", turn=1, source="LIVE", e2e_ms=900)
            self.assertEqual(rec.receipt(source="TEST")["turns"], 1)
            self.assertEqual(rec.receipt(source="LIVE")["turns"], 1)


if __name__ == "__main__":
    unittest.main()
