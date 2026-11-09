"""Provider interfaces: STT / LLM / TTS behind swappable adapters.

The realtime v1 path is Twilio Media Streams + Deepgram STT + a small fast
cloud LLM + Cartesia TTS, orchestrated here (Pipecat-compatible shape, but
the policy engine in app/policy never depends on any provider). Local
Ollama is OUT of the realtime v1 critical path; the LLM interface is what
a later A/B evaluation would plug into.

Real adapters lazy-import their vendor SDKs and raise DisabledError unless
explicitly enabled — importing this module never phones home, and tests
run entirely on the Fake providers with scripted latencies.
"""
from __future__ import annotations

import time

from .config import DisabledError


class STTProvider:
    def transcribe_chunk(self, audio: bytes) -> dict:
        raise NotImplementedError


class LLMProvider:
    def respond(self, *, state: str, response_class: str, history: list) -> dict:
        """Return {"response_class": str, "text": str}. The dialogue layer
        gates every word through quote_guard before it can play."""
        raise NotImplementedError


class TTSProvider:
    def synthesize(self, text: str) -> dict:
        """Return {"audio": bytes, "first_audio_ms": float}."""
        raise NotImplementedError


class FakeSTT(STTProvider):
    """Scripted STT: maps audio payload bytes to a transcript, with a
    configurable endpointing latency. `fail_on` forces an outage."""
    def __init__(self, script: dict | None = None, latency_ms: float = 120.0,
                 fail_on: set | None = None):
        self.script = script or {}
        self.latency_ms = latency_ms
        self.fail_on = fail_on or set()

    def transcribe_chunk(self, audio: bytes) -> dict:
        if audio in self.fail_on:
            raise RuntimeError("STT provider outage (simulated)")
        time.sleep(self.latency_ms / 1000.0)
        return {"text": self.script.get(audio, ""), "confidence": 0.97,
                "latency_ms": self.latency_ms}


class FakeLLM(LLMProvider):
    """Scripted LLM: returns a canned response per state, or the attack
    string when `attack_text` is set (used by quote-guard tests)."""
    def __init__(self, first_token_ms: float = 150.0, attack_text: str | None = None):
        self.first_token_ms = first_token_ms
        self.attack_text = attack_text
        self.calls: list = []

    def respond(self, *, state: str, response_class: str, history: list) -> dict:
        self.calls.append({"state": state, "response_class": response_class})
        time.sleep(self.first_token_ms / 1000.0)
        if self.attack_text is not None:
            return {"response_class": response_class, "text": self.attack_text}
        return {"response_class": response_class,
                "text": "Brandy will review your question and follow up."}


class FakeTTS(TTSProvider):
    """Scripted TTS with first-audio latency and a barge-in stop hook."""
    def __init__(self, first_audio_ms: float = 90.0, fail: bool = False):
        self.first_audio_ms = first_audio_ms
        self.fail = fail
        self.stopped_at: float | None = None
        self.playing = False

    def synthesize(self, text: str) -> dict:
        if self.fail:
            raise RuntimeError("TTS provider outage (simulated)")
        time.sleep(self.first_audio_ms / 1000.0)
        self.playing = True
        return {"audio": b"\x00" * 160, "first_audio_ms": self.first_audio_ms}

    def stop(self) -> float:
        """Barge-in stop. Returns measured stop latency in ms (simulated
        near-instant; the latency test asserts the p95 bound)."""
        started = time.perf_counter()
        self.playing = False
        self.stopped_at = time.perf_counter()
        return (self.stopped_at - started) * 1000.0


# --- Real adapters (lazy imports; disabled by default) -----------------------

def real_stt(config):
    config.require_live("telephony")
    import deepgram  # noqa: F401  (deepgram-sdk, pinned in requirements.txt)
    raise NotImplementedError("Deepgram streaming adapter wires at go-live config time; not in v1 synthetic build.")


def real_llm(config):
    config.require_live("telephony")
    raise NotImplementedError("Small fast cloud LLM adapter wires at go-live config time; not in v1 synthetic build.")


def real_tts(config):
    config.require_live("telephony")
    import cartesia  # noqa: F401  (cartesia, pinned in requirements.txt)
    raise NotImplementedError("Cartesia streaming TTS adapter wires at go-live config time; not in v1 synthetic build.")


def real_telephony_pipeline(config):
    config.require_live("telephony")
    import pipecat  # noqa: F401  (pipecat-ai, pinned in requirements.txt)
    raise NotImplementedError("Pipecat pipeline wires at go-live config time; not in v1 synthetic build.")
