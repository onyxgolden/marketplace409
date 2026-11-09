"""Go-live §2/§6/§8: the live-turn pipeline with Fake providers.

Covers: a turn flows STT -> dialogue -> guarded reply -> TTS with a
latency trace + cost entry; the LLM is advisory (its text is recorded,
never spoken); the disclosure is verified byte-identical before TTS and
a drifted disclosure fails the call closed; the quote guard re-gates
speak text; OFF mode / kill switch / turn limit / budget all fail
closed with PipelineClosed; provider failure falls back to the safe
clarify prompt; barge-in stop is measured.
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.config import ReceptionistConfig
from app.cost import CostLedger
from app.kill_switch import KillSwitch
from app.latency import LatencyRecorder
from app.pipeline import CallPipeline, PipelineClosed
from app.policy.dialogue import CallDialogue
from app.providers import FakeLLM, FakeSTT, FakeTTS, ProviderError


def _pipeline(tmp, *, stt=None, llm=None, tts=None, mode="TEST_ONLY",
              kill_path=None, max_turns=40, max_cost=0.50, campaign=10.0):
    config = ReceptionistConfig(
        cost_ledger_path=os.path.join(tmp, "ledger.json"),
        kill_switch_path=kill_path or os.path.join(tmp, "kill.json"),
        max_turns_per_call=max_turns,
        max_cost_per_call_usd=max_cost,
        max_cost_campaign_usd=campaign)
    dialogue = CallDialogue("CA-pipe-1")
    dialogue.start()
    return CallPipeline(
        stt=stt or FakeSTT(script={b"audio-1": "my sink is leaking"}),
        llm=llm or FakeLLM(),
        tts=tts or FakeTTS(),
        dialogue=dialogue, config=config,
        cost_ledger=CostLedger(config.cost_ledger_path),
        latency_recorder=LatencyRecorder(os.path.join(tmp, "latency.jsonl")),
        kill_switch=KillSwitch(config.kill_switch_path),
        activation_mode=mode, source="TEST", call_sid="CA-pipe-1")


class TestPipelineTurn(unittest.TestCase):
    def test_turn_flows_and_records_latency_and_cost(self):
        with tempfile.TemporaryDirectory() as tmp:
            pipe = _pipeline(tmp)
            result = pipe.handle_audio(b"audio-1")
            self.assertEqual(result["transcript"], "my sink is leaking")
            self.assertEqual(result["dialogue_state"], "CAPTURE_NAME")
            self.assertTrue(result["audio"])
            self.assertIn("stt_ms", result["trace"])
            self.assertIn("e2e_ms", result["trace"])
            self.assertEqual(pipe.turns, 1)
            turns = pipe.latency_recorder.load_turns()
            self.assertEqual(len(turns), 1)
            self.assertEqual(turns[0]["source"], "TEST")
            self.assertGreater(pipe.cost_ledger.total_usd(), 0)

    def test_llm_text_is_recorded_never_spoken(self):
        with tempfile.TemporaryDirectory() as tmp:
            llm = FakeLLM(attack_text="Your rent is $500, guaranteed.")
            pipe = _pipeline(tmp, llm=llm)
            result = pipe.handle_audio(b"audio-1")
            # The attack text never reaches the caller: the dialogue's
            # fixed template speaks instead, and the LLM text is only in
            # the trace for rehearsal evaluation.
            self.assertEqual(result["llm_text"], "Your rent is $500, guaranteed.")
            self.assertNotIn("$500", result["reply_text"])
            self.assertNotIn("guaranteed", result["reply_text"])

    def test_off_mode_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            pipe = _pipeline(tmp, mode="OFF")
            with self.assertRaises(PipelineClosed):
                pipe.handle_audio(b"audio-1")

    def test_kill_switch_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            kill_path = os.path.join(tmp, "kill.json")
            pipe = _pipeline(tmp, kill_path=kill_path)
            pipe.kill_switch.kill(reason="drill", set_by="test")
            with self.assertRaises(PipelineClosed):
                pipe.handle_audio(b"audio-1")

    def test_turn_limit_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            pipe = _pipeline(tmp, max_turns=1)
            pipe.handle_audio(b"audio-1")
            with self.assertRaises(PipelineClosed):
                pipe.handle_audio(b"audio-1")

    def test_budget_exhaustion_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            pipe = _pipeline(tmp, max_cost=0.01)
            with self.assertRaises(PipelineClosed):
                pipe.handle_audio(b"audio-1")

    def test_stt_failure_raises_provider_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            stt = FakeSTT(fail_on={b"bad-audio"})
            pipe = _pipeline(tmp, stt=stt)
            with self.assertRaises(ProviderError):
                pipe.handle_audio(b"bad-audio")

    def test_safe_clarify_after_provider_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            pipe = _pipeline(tmp)
            result = pipe.safe_clarify()
            self.assertTrue(result["audio"])
            self.assertIn("say that again", result["reply_text"])

    def test_barge_in_stop_is_measured(self):
        with tempfile.TemporaryDirectory() as tmp:
            tts = FakeTTS()
            pipe = _pipeline(tmp, tts=tts)
            pipe.handle_audio(b"audio-1")
            self.assertTrue(tts.playing)
            stopped_ms = pipe.barge_in_stop()
            self.assertGreaterEqual(stopped_ms, 0.0)
            self.assertFalse(tts.playing)

    def test_disclosure_drift_fails_the_call_closed(self):
        # Simulate a dialogue whose disclosure template drifted from the
        # pinned revision: the pipeline must refuse to speak it.
        with tempfile.TemporaryDirectory() as tmp:
            import app.policy.quote_guard as qg
            original = qg.TEMPLATES["disclosure"]
            try:
                qg.TEMPLATES["disclosure"] = "Hi, I am an AI. This call is recorded."
                pipe = _pipeline(tmp)
                # The dialogue's start() returns the drifted disclosure;
                # verify_disclosure must reject it.
                dialogue = CallDialogue("CA-drift")
                out = dialogue.start()
                with self.assertRaises(PipelineClosed):
                    pipe.verify_disclosure(out)
            finally:
                qg.TEMPLATES["disclosure"] = original

    def test_disclosure_verification_passes_for_pinned_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            pipe = _pipeline(tmp)
            dialogue = CallDialogue("CA-ok")
            out = dialogue.start()
            info = pipe.verify_disclosure(out)
            self.assertTrue(info["disclosure_spoken"])
            self.assertEqual(info["revision_status"], "UNAPPROVED")


class TestTurnReservationLifecycle(unittest.TestCase):
    """Fix round 2, P1: the session reservation the gateway holds for
    the call's duration must survive every turn — a turn settles ONLY
    its own reservation, and a failed turn releases its own
    reservation instead. The turn prices no duration (duration is
    priced once, at close)."""

    def test_successful_turn_keeps_session_reservation(self):
        with tempfile.TemporaryDirectory() as tmp:
            pipe = _pipeline(tmp)
            session_res = pipe.cost_ledger.reserve(
                call_sid="CA-pipe-1", source="TEST", purpose="session",
                projected_usd=0.04, max_per_call_usd=0.50,
                max_campaign_usd=10.0)
            result = pipe.handle_audio(b"audio-1")
            self.assertTrue(result["audio"])
            # The session reservation is untouched by the turn.
            remaining = [e for e in pipe.cost_ledger.entries()
                         if e.get("kind") == "reservation"]
            self.assertEqual(len(remaining), 1)
            self.assertEqual(remaining[0]["id"], session_res["id"])
            self.assertEqual(remaining[0]["purpose"], "session")
            # The turn actual prices only its LLM/TTS usage: no
            # duration — the old code charged the turn's processing
            # time as duration and dropped the session reservation.
            turn_entries = [e for e in pipe.cost_ledger.entries()
                            if e.get("kind") == "call"]
            self.assertEqual(len(turn_entries), 1)
            self.assertEqual(turn_entries[0]["usage"]["duration_s"], 0.0)
            self.assertGreater(turn_entries[0]["estimated_usd"], 0.0)
            self.assertAlmostEqual(
                pipe.cost_ledger.total_usd(),
                0.04 + turn_entries[0]["estimated_usd"])

    def test_failed_turn_releases_its_reservation_keeps_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            stt = FakeSTT(fail_on={b"bad-audio"})
            pipe = _pipeline(tmp, stt=stt)
            pipe.cost_ledger.reserve(
                call_sid="CA-pipe-1", source="TEST", purpose="session",
                projected_usd=0.04, max_per_call_usd=0.50,
                max_campaign_usd=10.0)
            with self.assertRaises(ProviderError):
                pipe.handle_audio(b"bad-audio")
            # The failed turn's reservation is released (the projected
            # spend never happened); the session reservation is held.
            remaining = [e for e in pipe.cost_ledger.entries()
                         if e.get("kind") == "reservation"]
            self.assertEqual(len(remaining), 1)
            self.assertEqual(remaining[0]["purpose"], "session")
            self.assertEqual(
                [e for e in pipe.cost_ledger.entries()
                 if e.get("kind") == "call"], [])
            self.assertAlmostEqual(pipe.cost_ledger.total_usd(), 0.04)
            # The call is still usable after the failure: the next
            # turn runs on the same session reservation.
            pipe.handle_audio(b"audio-1")
            self.assertEqual(pipe.turns, 1)


if __name__ == "__main__":
    unittest.main()
