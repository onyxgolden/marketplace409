"""Go-live §7/§8: cost ledger + ceilings, latency recorder + receipt.

Cost rates are the Nov 8 teardown's verified unit prices: the ~$0.04/min
all-in total must reproduce from the line items. The ledger is durable
(restart recovery) and the ceilings fail closed before a session or an
expensive action. Latency percentiles use nearest-rank; the receipt
compares p95 against the config targets.
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.cost import (
    BudgetExceeded, CostLedger, blended_minute_usd, estimate_alert_cost_usd,
    estimate_call_cost_usd, rate_table)
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
