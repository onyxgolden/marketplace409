"""Go-live §2: real provider adapters with INJECTED fake clients — no
network, no keys on disk. Proves the wiring: timeouts, circuit breaker,
error taxonomy, transcript extraction, TTS first-audio, LLM system
prompt, and the Pipecat pipeline construction against the real pinned
package (skipped when pipecat is not installed).
"""
import os
import sys
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.config import ReceptionistConfig
from app.providers import (
    CartesiaTTSAdapter, CircuitBreaker, DeepgramSTTAdapter,
    OpenAILLMAdapter, ProviderAuthError, ProviderRateLimited,
    ProviderTimeout, ProviderUnavailable, build_pipecat_pipeline,
    classify_error)

try:
    import pipecat  # noqa: F401
    HAS_PIPECAT = True
except ImportError:
    HAS_PIPECAT = False


class _FakeDeepgramResponse:
    """Minimal ListenV1Response shape (object attributes, like the SDK)."""
    def __init__(self, text, confidence=0.93):
        alt = type("Alt", (), {"transcript": text, "confidence": confidence})()
        channel = type("Channel", (), {"alternatives": [alt]})()
        self.results = type("Results", (), {"channels": [channel]})()


class _FakeDeepgramMedia:
    def __init__(self, text="hello", fail=None):
        self.text = text
        self.fail = fail
        self.calls = []

    def transcribe_file(self, **kwargs):
        self.calls.append(kwargs)
        if self.fail is not None:
            raise self.fail
        return _FakeDeepgramResponse(self.text)


class _FakeDeepgramV1:
    def __init__(self, media):
        self.media = media


class _FakeDeepgramListen:
    def __init__(self, media):
        self.v1 = _FakeDeepgramV1(media)


class _FakeDeepgramClient:
    def __init__(self, media):
        self.listen = _FakeDeepgramListen(media)


class _FakeChatCompletions:
    def __init__(self, text="Brandy will follow up.", fail=None):
        self.text = text
        self.fail = fail
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.fail is not None:
            raise self.fail
        msg = type("Msg", (), {"content": self.text})()
        choice = type("Choice", (), {"message": msg})()
        return type("Completion", (), {"choices": [choice]})()


class _FakeOpenAIClient:
    def __init__(self, completions):
        self.chat = type("Chat", (), {"completions": completions})()


class _FakeCartesiaTTS:
    def __init__(self, chunks=None, fail=None):
        self.chunks = chunks if chunks is not None else [b"\x00" * 160, b"\x01" * 160]
        self.fail = fail
        self.calls = []

    def bytes(self, **kwargs):
        self.calls.append(kwargs)
        if self.fail is not None:
            raise self.fail
        yield from self.chunks


class _FakeCartesiaClient:
    def __init__(self, tts):
        self.tts = tts


class _SlowCallable:
    def __init__(self, delay_s):
        self.delay_s = delay_s

    def __call__(self):
        time.sleep(self.delay_s)
        return "done"


class TestClassifyError(unittest.TestCase):
    def test_http_status_mapping(self):
        class E401(Exception):
            status_code = 401
        self.assertIsInstance(classify_error(E401("nope")), ProviderAuthError)
        class E429(Exception):
            status_code = 429
        self.assertIsInstance(classify_error(E429("slow down")), ProviderRateLimited)
        self.assertIsInstance(classify_error(TimeoutError("x")), ProviderTimeout)
        self.assertIsInstance(classify_error(RuntimeError("boom")), ProviderUnavailable)


class TestCircuitBreaker(unittest.TestCase):
    def test_opens_after_threshold_then_half_opens(self):
        clock = [0.0]
        breaker = CircuitBreaker(failure_threshold=2, cooldown_s=10, clock=lambda: clock[0])
        with self.assertRaises(ProviderUnavailable):
            breaker.call(lambda: (_ for _ in ()).throw(RuntimeError("x")))
        with self.assertRaises(ProviderUnavailable):
            breaker.call(lambda: (_ for _ in ()).throw(RuntimeError("x")))
        self.assertEqual(breaker.state, "OPEN")
        with self.assertRaises(ProviderUnavailable):
            breaker.call(lambda: "never runs")
        clock[0] = 11.0
        self.assertEqual(breaker.state, "HALF_OPEN")
        self.assertEqual(breaker.call(lambda: "probe ok"), "probe ok")
        self.assertEqual(breaker.state, "CLOSED")


class TestDeepgramAdapter(unittest.TestCase):
    def test_transcribe_chunk_extracts_transcript(self):
        media = _FakeDeepgramMedia(text="my sink is leaking")
        adapter = DeepgramSTTAdapter("fake-key", client=_FakeDeepgramClient(media))
        result = adapter.transcribe_chunk(b"\x00" * 160)
        self.assertEqual(result["text"], "my sink is leaking")
        self.assertAlmostEqual(result["confidence"], 0.93)
        self.assertEqual(media.calls[0]["model"], "nova-3")
        self.assertEqual(media.calls[0]["encoding"], "mulaw")
        self.assertEqual(media.calls[0]["sample_rate"], 8000)

    def test_provider_5xx_maps_to_unavailable_and_trips_breaker(self):
        class E500(Exception):
            status_code = 500
        media = _FakeDeepgramMedia(fail=E500("down"))
        breaker = CircuitBreaker(failure_threshold=1, cooldown_s=60)
        adapter = DeepgramSTTAdapter("fake-key", client=_FakeDeepgramClient(media), breaker=breaker)
        with self.assertRaises(ProviderUnavailable):
            adapter.transcribe_chunk(b"\x00")
        self.assertEqual(breaker.state, "OPEN")

    def test_missing_key_raises_auth(self):
        with self.assertRaises(ProviderAuthError):
            DeepgramSTTAdapter("")

    def test_timeout_abandons_slow_call(self):
        media = _FakeDeepgramMedia()
        # A slow transcribe_file: wrap the media call in a slow shim.
        orig = media.transcribe_file
        def slow(**kwargs):
            time.sleep(0.5)
            return orig(**kwargs)
        media.transcribe_file = slow
        adapter = DeepgramSTTAdapter("fake-key", client=_FakeDeepgramClient(media), timeout_s=0.05)
        with self.assertRaises(ProviderTimeout):
            adapter.transcribe_chunk(b"\x00")


class TestOpenAIAdapter(unittest.TestCase):
    def test_respond_returns_text_and_records_call(self):
        completions = _FakeChatCompletions(text="What is your name?")
        adapter = OpenAILLMAdapter("fake-key", client=_FakeOpenAIClient(completions))
        result = adapter.respond(state="INTENT", response_class="REPLY", history=[])
        self.assertEqual(result["text"], "What is your name?")
        self.assertEqual(result["response_class"], "REPLY")
        call = completions.calls[0]
        self.assertEqual(call["model"], "gpt-4o-mini")
        system = call["messages"][0]
        self.assertEqual(system["role"], "system")
        self.assertIn("Never quote a price", system["content"])

    def test_auth_error_is_not_retryable(self):
        class E401(Exception):
            status_code = 401
        completions = _FakeChatCompletions(fail=E401("bad key"))
        adapter = OpenAILLMAdapter("fake-key", client=_FakeOpenAIClient(completions))
        with self.assertRaises(ProviderAuthError) as ctx:
            adapter.respond(state="INTENT", response_class="REPLY", history=[])
        self.assertFalse(ctx.exception.retryable)


class TestCartesiaAdapter(unittest.TestCase):
    def test_synthesize_joins_chunks_and_measures_first_audio(self):
        tts = _FakeCartesiaTTS(chunks=[b"a" * 160, b"b" * 160])
        adapter = CartesiaTTSAdapter("fake-key", voice_id="voice-1",
                                     client=_FakeCartesiaClient(tts))
        result = adapter.synthesize("hello")
        self.assertEqual(result["audio"], b"a" * 160 + b"b" * 160)
        self.assertGreaterEqual(result["first_audio_ms"], 0.0)
        call = tts.calls[0]
        self.assertEqual(call["model_id"], "sonic-3")
        self.assertEqual(call["voice"], {"mode": "id", "id": "voice-1"})
        self.assertEqual(call["output_format"]["sample_rate"], 8000)

    def test_empty_text_synthesizes_nothing(self):
        tts = _FakeCartesiaTTS()
        adapter = CartesiaTTSAdapter("fake-key", voice_id="voice-1",
                                     client=_FakeCartesiaClient(tts))
        self.assertEqual(adapter.synthesize("  ")["audio"], b"")
        self.assertEqual(len(tts.calls), 0)

    def test_stop_returns_stop_latency(self):
        adapter = CartesiaTTSAdapter("fake-key", voice_id="voice-1",
                                     client=_FakeCartesiaClient(_FakeCartesiaTTS()))
        adapter.synthesize("hello")
        self.assertTrue(adapter.playing)
        stopped_ms = adapter.stop()
        self.assertGreaterEqual(stopped_ms, 0.0)
        self.assertFalse(adapter.playing)


@unittest.skipUnless(HAS_PIPECAT, "pipecat-ai is not installed in this python")
class TestPipecatPipeline(unittest.TestCase):
    def test_build_pipeline_with_real_services(self):
        config = ReceptionistConfig(telephony_enabled=True)
        env = {"DEEPGRAM_API_KEY": "fake", "OPENAI_API_KEY": "fake",
               "CARTESIA_API_KEY": "fake", "CARTESIA_VOICE_ID": "fake-voice"}
        with mock.patch.dict(os.environ, env):
            built = build_pipecat_pipeline(config)
        self.assertIsNotNone(built["pipeline"])
        self.assertEqual(type(built["stt"]).__name__, "DeepgramSTTService")
        self.assertEqual(type(built["llm"]).__name__, "OpenAILLMService")
        self.assertEqual(type(built["tts"]).__name__, "CartesiaTTSService")


class TestRealFactoriesRequireLive(unittest.TestCase):
    def test_factories_raise_when_telephony_disabled(self):
        from app.providers import real_llm, real_stt, real_tts
        config = ReceptionistConfig(telephony_enabled=False)
        for fn in (real_stt, real_llm, real_tts):
            with self.assertRaises(Exception):
                fn(config)


if __name__ == "__main__":
    unittest.main()
