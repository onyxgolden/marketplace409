"""Receptionist Cut 1 local provider adapters, fix round 1 additions:
auth-token attachment, loopback URL validation at the factory boundary,
and — the P1 streaming fix — that `LocalKokoroTTSAdapter.synthesize()`'s
`first_audio_ms` reflects the real first-byte wall-clock time an
injected streaming client reports, never a server-side header on a
fully-buffered response. INJECTED fakes only — no real HTTP, no real
models, consistent with `test_providers_real.py`'s own pattern for the
cloud adapters.
"""
import os
import sys
import time
import unittest
import wave
from io import BytesIO

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.config import DisabledError, ReceptionistConfig
from app.providers import (
    LocalFasterWhisperSTTAdapter,
    LocalKokoroTTSAdapter,
    LocalOllamaLLMAdapter,
    ProviderUnavailable,
    local_inference_health,
    local_llm,
    local_stt,
    local_tts,
)


class TestLocalFasterWhisperSTTAdapter(unittest.TestCase):
    def test_attaches_the_auth_token_to_the_request(self):
        seen = {}

        def fake_post(base_url, path, *, binary_body=None, timeout_s=None, content_type=None, auth_token=None, **_):
            seen["auth_token"] = auth_token
            seen["content_type"] = content_type
            return 200, {}, b'{"text": "hello", "confidence": 0.9}'

        adapter = LocalFasterWhisperSTTAdapter(base_url="http://127.0.0.1:8809", http_post=fake_post, auth_token="tok-123")
        result = adapter.transcribe_chunk(b"\x00\x01")
        self.assertEqual(seen["auth_token"], "tok-123")
        self.assertEqual(seen["content_type"], "audio/wav")
        self.assertEqual(result["text"], "hello")

    def test_raises_on_a_non_200_response(self):
        def fake_post(*a, **k):
            return 503, {}, b'{"error": "STT model not loaded"}'

        adapter = LocalFasterWhisperSTTAdapter(base_url="http://127.0.0.1:8809", http_post=fake_post)
        with self.assertRaises(Exception):
            adapter.transcribe_chunk(b"\x00")


class TestLocalOllamaLLMAdapter(unittest.TestCase):
    def test_sends_an_advisory_only_system_prompt_and_parses_the_reply(self):
        seen = {}

        def fake_post(base_url, path, *, json_body=None, timeout_s=None, **_):
            seen["path"] = path
            seen["messages"] = json_body["messages"]
            return 200, {}, b'{"message": {"content": "Please provide your name."}}'

        adapter = LocalOllamaLLMAdapter(base_url="http://127.0.0.1:11434", http_post=fake_post)
        result = adapter.respond(state="ASK_NAME", response_class="ask_slot", history=[{"role": "user", "content": "hi"}])
        self.assertEqual(seen["path"], "/api/chat")
        self.assertEqual(seen["messages"][0]["role"], "system")
        self.assertIn("advisory", seen["messages"][0]["content"].lower())
        self.assertEqual(result["text"], "Please provide your name.")

    def test_raises_on_a_non_200_response(self):
        def fake_post(*a, **k):
            return 500, {}, b"internal error"

        adapter = LocalOllamaLLMAdapter(base_url="http://127.0.0.1:11434", http_post=fake_post)
        with self.assertRaises(Exception):
            adapter.respond(state="X", response_class="ask_slot", history=[])


class TestLocalKokoroTTSAdapterStreaming(unittest.TestCase):
    def test_first_audio_ms_reflects_the_real_first_byte_timestamp_not_a_header(self):
        """Fix round 1, P1's own regression: the OLD adapter trusted a
        server-reported `X-First-Audio-Ms` header on a fully-buffered
        response — a value the server could misreport (deliberately or
        by bug) with no way for the client to catch it. The NEW adapter
        computes first_audio_ms itself from the streaming helper's
        reported first-byte wall-clock time. This fake streaming client
        reports a first-byte time 50ms after a recorded `request_sent`
        instant, then takes another 500ms for the rest — proving the
        measured value tracks the FIRST-byte moment, not the full
        duration, and is NOT taken from any header the server sent."""
        request_sent_at = {}

        def fake_streaming_post(base_url, path, *, json_body=None, timeout_s=None, auth_token=None):
            # Simulate: first byte arrives 50ms after the call starts;
            # the full body (irrelevant content for this test) finishes
            # much later. first_byte_at is a perf_counter() timestamp,
            # exactly what the real streaming reader produces.
            t0 = time.perf_counter()
            time.sleep(0.05)
            first_byte_at = time.perf_counter()
            time.sleep(0.05)  # pretend the rest of the stream takes longer
            pcm = b"\x00\x00" * 100  # 100 silent int16 samples
            headers = {"X-Sample-Rate": "24000", "X-Channels": "1"}
            return 200, headers, pcm, first_byte_at

        adapter = LocalKokoroTTSAdapter(base_url="http://127.0.0.1:8809", http_post_streaming=fake_streaming_post)
        result = adapter.synthesize("Hello there.")
        # ~50ms, not ~100ms (the full duration) and not 0 (a header the
        # server never even sends anymore).
        self.assertGreater(result["first_audio_ms"], 20)
        self.assertLess(result["first_audio_ms"], 90)

    def test_wraps_raw_pcm_into_a_valid_playable_wav(self):
        def fake_streaming_post(base_url, path, *, json_body=None, timeout_s=None, auth_token=None):
            pcm = (b"\x10\x00" * 50)  # 50 int16 samples, nonzero so it's not trivially empty
            return 200, {"X-Sample-Rate": "24000", "X-Channels": "1"}, pcm, time.perf_counter()

        adapter = LocalKokoroTTSAdapter(base_url="http://127.0.0.1:8809", http_post_streaming=fake_streaming_post)
        result = adapter.synthesize("Hi.")
        with wave.open(BytesIO(result["audio"]), "rb") as w:
            self.assertEqual(w.getnchannels(), 1)
            self.assertEqual(w.getsampwidth(), 2)
            self.assertEqual(w.getframerate(), 24000)
            self.assertEqual(w.getnframes(), 50)

    def test_raises_on_a_non_200_streaming_response(self):
        def fake_streaming_post(*a, **k):
            return 503, {}, b'{"error": "Kokoro model not loaded"}', None

        adapter = LocalKokoroTTSAdapter(base_url="http://127.0.0.1:8809", http_post_streaming=fake_streaming_post)
        with self.assertRaises(Exception):
            adapter.synthesize("text")

    def test_empty_text_never_makes_a_request(self):
        called = {"n": 0}

        def fake_streaming_post(*a, **k):
            called["n"] += 1
            return 200, {}, b"", time.perf_counter()

        adapter = LocalKokoroTTSAdapter(base_url="http://127.0.0.1:8809", http_post_streaming=fake_streaming_post)
        result = adapter.synthesize("   ")
        self.assertEqual(called["n"], 0)
        self.assertEqual(result["audio"], b"")


class TestLocalFactoriesValidateUrlsAndGateOnLiveFlag(unittest.TestCase):
    def test_local_stt_refuses_when_local_inference_is_not_enabled(self):
        config = ReceptionistConfig(local_inference_enabled=False)
        with self.assertRaises(DisabledError):
            local_stt(config)

    def test_local_llm_refuses_when_local_inference_is_not_enabled(self):
        config = ReceptionistConfig(local_inference_enabled=False)
        with self.assertRaises(DisabledError):
            local_llm(config)

    def test_local_tts_refuses_when_local_inference_is_not_enabled(self):
        config = ReceptionistConfig(local_inference_enabled=False)
        with self.assertRaises(DisabledError):
            local_tts(config)

    def test_local_stt_refuses_a_misconfigured_non_loopback_url(self):
        config = ReceptionistConfig(local_inference_enabled=True, local_inference_base_url="http://evil.example.com:8809")
        with self.assertRaises(ValueError):
            local_stt(config)

    def test_local_llm_refuses_a_misconfigured_non_loopback_ollama_url(self):
        config = ReceptionistConfig(local_inference_enabled=True, ollama_base_url="http://evil.example.com:11434")
        with self.assertRaises(ValueError):
            local_llm(config)

    def test_local_inference_health_never_raises_even_with_everything_down(self):
        config = ReceptionistConfig(local_inference_base_url="http://127.0.0.1:1", ollama_base_url="http://127.0.0.1:2")
        result = local_inference_health(config)
        self.assertIn("error", result["localInferenceServer"])
        self.assertIn("error", result["ollama"])


if __name__ == "__main__":
    unittest.main()
