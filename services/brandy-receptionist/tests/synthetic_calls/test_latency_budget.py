"""§11.10 latency + §11.14 budget cap + barge-in stop bound.

DETERMINISTIC HARNESS MEASUREMENTS — NOT live-call proof. Fake providers
carry scripted per-stage latencies; the numbers below measure the pipeline
on this host over >=200 representative synthetic turns and assert
p95 <= 800 ms, report p99, and assert barge-in stop p95 <= 250 ms and
emergency trigger -> alert-request p95 <= 2000 ms. No PSTN, no real
telephony, no vendor numbers: the p95 <= 800 ms LIVE-call bar remains
unproven until real telephony trials run.
"""
import os
import statistics
import sys
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.config import ReceptionistConfig
from app.integrations.alerts import AlertDispatcher, FakeAlertTransport
from app.policy.dialogue import CallDialogue
from app.providers import FakeLLM, FakeSTT, FakeTTS
from app.server import BudgetGuard


def p95(values):
    s = sorted(values)
    return s[max(0, min(len(s) - 1, int(0.95 * len(s))))]


def p99(values):
    s = sorted(values)
    return s[max(0, min(len(s) - 1, int(0.99 * len(s))))]


class TestLatency(unittest.TestCase):
    def test_end_to_end_p95_over_200_turns(self):
        stt = FakeSTT(latency_ms=120.0)
        llm = FakeLLM(first_token_ms=150.0)
        tts = FakeTTS(first_audio_ms=90.0)
        playback_buffer_ms = 40.0
        samples = []
        turns = ["I'm looking for a place to rent", "my sink is leaking",
                 "I have a question about my bill", "the toilet is clogged"] * 50
        self.assertEqual(len(turns), 200)
        for text in turns:
            speech_end = time.perf_counter()
            stt.transcribe_chunk(text.encode())
            llm.respond(state="INTENT", response_class="ask_slot", history=[])
            tts.synthesize("Brandy will review your question and follow up.")
            first_audio = time.perf_counter()
            total_ms = (first_audio - speech_end) * 1000.0 + playback_buffer_ms
            samples.append(total_ms)
        measured_p95 = p95(samples)
        measured_p99 = p99(samples)
        print(f"\n[latency] n={len(samples)} p50={statistics.median(samples):.1f}ms "
              f"p95={measured_p95:.1f}ms p99={measured_p99:.1f}ms (target p95<=800ms)")
        self.assertLessEqual(measured_p95, ReceptionistConfig().latency_p95_target_ms)
        # p99 is measured and reported, not asserted to the stretch target.
        self.assertLessEqual(measured_p99, 2000.0)

    def test_barge_in_stop_p95(self):
        tts = FakeTTS()
        stops = []
        for _ in range(50):
            tts.synthesize("some agent speech")
            stops.append(tts.stop())
        self.assertLessEqual(p95(stops), ReceptionistConfig().barge_in_stop_p95_target_ms)

    def test_emergency_trigger_to_alert_request_p95(self):
        samples = []
        for i in range(50):
            d = CallDialogue(f"CA-lat-{i}")
            d.start()
            start = time.perf_counter()
            out = d.handle_turn("I smell gas near the stove")
            dispatcher = AlertDispatcher(FakeAlertTransport())
            dispatcher.dispatch_emergency(out["emergency_event_id"], "GAS", "Gas emergency.")
            samples.append((time.perf_counter() - start) * 1000.0)
        measured = p95(samples)
        print(f"\n[emergency-latency] p95={measured:.1f}ms (target <=2000ms)")
        self.assertLessEqual(measured, ReceptionistConfig().emergency_alert_request_p95_target_ms)


class TestBudgetCap(unittest.TestCase):
    def test_budget_cap_denies_new_nonemergency_sessions(self):
        guard = BudgetGuard(max_minutes=1.0)
        self.assertTrue(guard.allow(1.0))
        guard.charge(1.0)
        self.assertFalse(guard.allow(1.0))
        # Emergency sessions are never denied by budget.
        self.assertTrue(guard.allow(1.0, emergency=True))


if __name__ == "__main__":
    unittest.main()
