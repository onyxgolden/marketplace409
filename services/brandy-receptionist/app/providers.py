"""Provider interfaces: STT / LLM / TTS behind swappable adapters.

The realtime v1 path is Twilio Media Streams + Deepgram STT + a small fast
cloud LLM + Cartesia TTS, orchestrated here (Pipecat-compatible shape, but
the policy engine in app/policy never depends on any provider). Local
Ollama is OUT of the realtime v1 critical path; the LLM interface is what
a later A/B evaluation would plug into.

Real adapters lazy-import their vendor SDKs and raise DisabledError unless
explicitly enabled — importing this module never phones home, and tests
run entirely on the Fake providers with scripted latencies. Real adapters
accept an injected client (``client=``) so tests can prove the wiring —
timeouts, circuit breaker, error taxonomy, transcript extraction — without
any network. The SDK call shapes below were verified against the pinned
packages (deepgram-sdk 7.17.0, cartesia 4.2.0, openai 3.46.0,
pipecat-ai 1.15.0, twilio 9.13.0) in a clean venv; the first live
rehearsal still validates them end to end before any real call.

Environment quirk (this VM): httpx chokes on a NO_PROXY value containing
``[::1]``. Vendor clients are therefore built inside
``_clean_proxy_env()``, which temporarily normalises NO_PROXY/no_proxy
to loopback-only. The deployment host does not need this, but the guard
is harmless there.
"""
from __future__ import annotations

import os
import threading
import time
from contextlib import contextmanager

from .config import DisabledError


# --- Error taxonomy ----------------------------------------------------------

class ProviderError(RuntimeError):
    """Base provider failure. ``kind`` drives retry policy; ``retryable``
    is False for auth/config errors that a retry can never fix."""
    kind = "provider_error"

    def __init__(self, message: str, *, retryable: bool = True, status: int | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.status = status


class ProviderTimeout(ProviderError):
    kind = "timeout"


class ProviderUnavailable(ProviderError):
    kind = "unavailable"


class ProviderAuthError(ProviderError):
    kind = "auth"

    def __init__(self, message: str, *, status: int | None = None):
        super().__init__(message, retryable=False, status=status)


class ProviderRateLimited(ProviderError):
    kind = "rate_limited"


def classify_error(exc: BaseException) -> ProviderError:
    """Map a vendor SDK exception onto the taxonomy. Unknown exceptions
    become retryable ProviderUnavailable (never silently swallowed)."""
    if isinstance(exc, ProviderError):
        return exc
    name = type(exc).__name__.lower()
    status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
    text = str(exc)
    if status in (401, 403) or "unauthorized" in name or "authentication" in name:
        return ProviderAuthError(text, status=status)
    if status == 429 or "rate" in name or "rate limit" in text.lower():
        return ProviderRateLimited(text, status=status)
    if status in (408, 504) or "timeout" in name or "timed out" in text.lower():
        return ProviderTimeout(text, status=status)
    if isinstance(exc, TimeoutError):
        return ProviderTimeout(text)
    return ProviderUnavailable(text, status=status)


def run_with_timeout(fn, timeout_s: float, *, label: str = "provider call"):
    """Run fn() in a worker thread; raise ProviderTimeout past the deadline.

    stdlib threads cannot be killed, so a timed-out call is abandoned, not
    interrupted — the worker may still finish in the background. The caller
    must therefore treat a timeout as a failed attempt (no retry of a
    non-idempotent action without an idempotency key) and the circuit
    breaker must trip. Documented here so no caller assumes cancellation.
    """
    result: dict = {}
    error: dict = {}

    def _target():
        try:
            result["value"] = fn()
        except BaseException as exc:  # noqa: BLE001 — captured, re-raised below
            error["error"] = exc

    worker = threading.Thread(target=_target, daemon=True)
    worker.start()
    worker.join(timeout_s)
    if worker.is_alive():
        raise ProviderTimeout(f"{label} exceeded {timeout_s}s (abandoned, not cancelled)")
    if "error" in error:
        raise classify_error(error["error"])
    return result.get("value")


@contextmanager
def _clean_proxy_env():
    """Temporarily normalise NO_PROXY/no_proxy so httpx-based SDK clients
    can be constructed on hosts whose proxy env contains bracketed IPv6
    literals (this VM). Restores the original values afterwards."""
    saved = {}
    for key in ("NO_PROXY", "no_proxy"):
        if key in os.environ:
            saved[key] = os.environ[key]
            os.environ[key] = "localhost,127.0.0.1"
    try:
        yield
    finally:
        for key, value in saved.items():
            os.environ[key] = value


class CircuitBreaker:
    """Consecutive-failure breaker: CLOSED -> OPEN (cooldown) -> HALF_OPEN
    (one probe) -> CLOSED on success, OPEN again on failure. The breaker
    is per-provider-instance; a tripped breaker fails fast with
    ProviderUnavailable instead of hammering a down vendor."""

    def __init__(self, failure_threshold: int = 3, cooldown_s: float = 60.0,
                 clock=time.monotonic):
        self.failure_threshold = failure_threshold
        self.cooldown_s = cooldown_s
        self._clock = clock
        self._failures = 0
        self._opened_at: float | None = None
        self._half_open_probe = False
        self._lock = threading.Lock()

    @property
    def state(self) -> str:
        with self._lock:
            if self._opened_at is None:
                return "CLOSED"
            if self._clock() - self._opened_at >= self.cooldown_s:
                return "HALF_OPEN"
            return "OPEN"

    def call(self, fn, *, label: str = "provider call"):
        with self._lock:
            if self._opened_at is not None:
                if self._clock() - self._opened_at < self.cooldown_s:
                    raise ProviderUnavailable(f"circuit breaker OPEN for {label}")
                if self._half_open_probe:
                    raise ProviderUnavailable(f"circuit breaker HALF_OPEN probe in flight for {label}")
                self._half_open_probe = True
        try:
            value = fn()
        except BaseException as exc:
            with self._lock:
                self._failures += 1
                self._half_open_probe = False
                if self._failures >= self.failure_threshold:
                    self._opened_at = self._clock()
            raise classify_error(exc)
        with self._lock:
            self._failures = 0
            self._opened_at = None
            self._half_open_probe = False
        return value


# --- Interfaces ---------------------------------------------------------------

class STTProvider:
    def transcribe_chunk(self, audio: bytes) -> dict:
        raise NotImplementedError

    def start_stream(self):
        """Open a streaming session; returns an object with send(bytes),
        recv_transcript(timeout_s) -> dict|None, close(). Streaming-only
        adapters implement it; chunk-only adapters raise NotImplementedError."""
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

    def stop(self) -> float:
        """Barge-in stop. Returns measured stop latency in ms."""
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
# Every real adapter takes the vendor key as an explicit constructor arg
# (env-sourced by the real_* factories, never committed) and an optional
# injected `client` so tests can prove the wiring without network.

def _extract_transcript(response) -> tuple[str, float]:
    """Pull (transcript, confidence) out of a Deepgram ListenV1Response,
    tolerating both the SDK object shape and plain dicts (tests)."""
    try:
        results = response.results if hasattr(response, "results") else response["results"]
        channels = results.channels if hasattr(results, "channels") else results["channels"]
        channel = channels[0]
        alternatives = channel.alternatives if hasattr(channel, "alternatives") else channel["alternatives"]
        alt = alternatives[0]
        text = alt.transcript if hasattr(alt, "transcript") else alt["transcript"]
        conf = alt.confidence if hasattr(alt, "confidence") else alt.get("confidence", 0.0)
        return str(text or ""), float(conf or 0.0)
    except (KeyError, IndexError, TypeError, AttributeError):
        return "", 0.0


class DeepgramSTTAdapter(STTProvider):
    """Deepgram Nova-3 streaming STT (deepgram-sdk 7.x).

    Chunk path: prerecorded transcribe_file (mulaw 8kHz, the Twilio
    Media Streams format). Stream path: listen.v1.connect websocket with
    interim results + endpointing; recv_transcript returns the next
    final (or interim, when requested) transcript dict.
    """

    def __init__(self, api_key: str, *, model: str = "nova-3", language: str = "en",
                 timeout_s: float = 10.0, client=None, breaker: CircuitBreaker | None = None):
        if not api_key:
            raise ProviderAuthError("Deepgram API key missing")
        self.api_key = api_key
        self.model = model
        self.language = language
        self.timeout_s = timeout_s
        self.breaker = breaker or CircuitBreaker()
        self._client = client

    def _client_or_build(self):
        if self._client is not None:
            return self._client
        from deepgram import DeepgramClient
        with _clean_proxy_env():
            self._client = DeepgramClient(api_key=self.api_key)
        return self._client

    def transcribe_chunk(self, audio: bytes) -> dict:
        started = time.perf_counter()

        def _call():
            client = self._client_or_build()
            response = client.listen.v1.media.transcribe_file(
                request=audio, model=self.model, language=self.language,
                encoding="mulaw", sample_rate=8000, smart_format=True,
                interim_results=False)
            return _extract_transcript(response)

        text, confidence = self.breaker.call(
            lambda: run_with_timeout(_call, self.timeout_s, label="Deepgram transcribe"),
            label="Deepgram STT")
        latency_ms = (time.perf_counter() - started) * 1000.0
        return {"text": text, "confidence": confidence, "latency_ms": latency_ms}

    def start_stream(self):
        client = self._client_or_build()
        connection = client.listen.v1.connect(
            model=self.model, language=self.language, encoding="mulaw",
            sample_rate=8000, interim_results=True, endpointing=300,
            smart_format=True, vad_events=True)
        return DeepgramStream(connection, timeout_s=self.timeout_s, breaker=self.breaker)


class DeepgramStream:
    """One Deepgram live websocket connection. The SDK's V1SocketClient is
    an iterator of transcript events; a reader thread funnels them into a
    queue so recv_transcript can block with a deadline."""

    def __init__(self, connection, *, timeout_s: float = 10.0, breaker: CircuitBreaker | None = None):
        self._connection = connection
        self._timeout_s = timeout_s
        self._breaker = breaker or CircuitBreaker()
        self._queue: "queue.Queue[dict]" = __import__("queue").Queue()
        self._closed = False
        self._reader = threading.Thread(target=self._drain, daemon=True)
        self._reader.start()

    def _drain(self):
        try:
            for event in self._connection:
                text, confidence = self._extract_event(event)
                if text:
                    self._queue.put({"text": text, "confidence": confidence,
                                     "is_final": self._is_final(event)})
        except Exception:  # noqa: BLE001 — stream end; recv sees the close
            pass
        finally:
            self._queue.put({"text": "", "confidence": 0.0, "is_final": True, "closed": True})

    @staticmethod
    def _extract_event(event) -> tuple[str, float]:
        try:
            channel = event.channel if hasattr(event, "channel") else event.get("channel", {})
            alternatives = channel.alternatives if hasattr(channel, "alternatives") else channel.get("alternatives", [])
            alt = alternatives[0]
            text = alt.transcript if hasattr(alt, "transcript") else alt.get("transcript", "")
            conf = alt.confidence if hasattr(alt, "confidence") else alt.get("confidence", 0.0)
            return str(text or ""), float(conf or 0.0)
        except (KeyError, IndexError, TypeError, AttributeError):
            return "", 0.0

    @staticmethod
    def _is_final(event) -> bool:
        try:
            return bool(event.is_final if hasattr(event, "is_final") else event.get("is_final", False))
        except (KeyError, TypeError, AttributeError):
            return False

    def send(self, audio: bytes) -> None:
        if self._closed:
            raise ProviderUnavailable("Deepgram stream is closed")
        self._connection.send(audio)

    def recv_transcript(self, timeout_s: float | None = None) -> dict | None:
        """Next transcript dict, or None on timeout. A {"closed": True}
        dict ends the stream."""
        try:
            return self._queue.get(timeout=timeout_s if timeout_s is not None else self._timeout_s)
        except Exception:  # queue.Empty
            return None

    def close(self) -> None:
        self._closed = True
        try:
            self._connection.finish()
        except Exception:  # noqa: BLE001 — best-effort close
            pass


class OpenAILLMAdapter(LLMProvider):
    """Small fast cloud LLM (GPT-4o-mini class, openai 3.x).

    The system prompt is deterministic and short: it states the agent's
    job (capture name/need/callback, never quote a price, escalate
    emergencies) and nothing else. The dialogue layer still gates every
    word through quote_guard — the LLM is advisory, never authoritative.
    """

    SYSTEM_PROMPT = (
        "You are a receptionist for Brandy's rental office. Capture the caller's "
        "name, what they need, and a callback number. Never quote a price, fee, "
        "or rent amount. If the caller reports water, fire, gas, smoke, flooding, "
        "or being locked out, say you are alerting Brandy immediately. Keep replies "
        "to one or two short sentences."
    )

    def __init__(self, api_key: str, *, model: str = "gpt-4o-mini", timeout_s: float = 8.0,
                 max_tokens: int = 200, client=None, breaker: CircuitBreaker | None = None):
        if not api_key:
            raise ProviderAuthError("OpenAI API key missing")
        self.api_key = api_key
        self.model = model
        self.timeout_s = timeout_s
        self.max_tokens = max_tokens
        self.breaker = breaker or CircuitBreaker()
        self._client = client

    def _client_or_build(self):
        if self._client is not None:
            return self._client
        from openai import OpenAI
        with _clean_proxy_env():
            self._client = OpenAI(api_key=self.api_key)
        return self._client

    def respond(self, *, state: str, response_class: str, history: list) -> dict:
        started = time.perf_counter()
        messages = [{"role": "system", "content": self.SYSTEM_PROMPT}]
        for turn in (history or [])[-10:]:
            messages.append({"role": turn.get("role", "user"), "content": turn.get("content", "")})
        messages.append({"role": "user",
                         "content": f"[state={state} response_class={response_class}] Reply as the receptionist."})

        def _call():
            client = self._client_or_build()
            completion = client.chat.completions.create(
                model=self.model, messages=messages, max_tokens=self.max_tokens,
                temperature=0.2, timeout=self.timeout_s)
            choice = completion.choices[0]
            text = choice.message.content if hasattr(choice.message, "content") else choice.message["content"]
            return str(text or "").strip()

        text = self.breaker.call(
            lambda: run_with_timeout(_call, self.timeout_s, label="OpenAI chat completion"),
            label="OpenAI LLM")
        first_token_ms = (time.perf_counter() - started) * 1000.0
        return {"response_class": response_class, "text": text, "first_token_ms": first_token_ms}


class CartesiaTTSAdapter(TTSProvider):
    """Cartesia Sonic streaming TTS (cartesia 4.x).

    synthesize() collects the byte stream (raw PCM s16le 8kHz, the Twilio
    Media Streams format) and measures time-to-first-audio. stop() aborts
    the active stream for barge-in.
    """

    def __init__(self, api_key: str, *, voice_id: str, model: str = "sonic-3",
                 timeout_s: float = 10.0, client=None, breaker: CircuitBreaker | None = None):
        if not api_key:
            raise ProviderAuthError("Cartesia API key missing")
        if not voice_id:
            raise ProviderAuthError("Cartesia voice_id missing")
        self.api_key = api_key
        self.voice_id = voice_id
        self.model = model
        self.timeout_s = timeout_s
        self.breaker = breaker or CircuitBreaker()
        self._client = client
        self._stop_requested = threading.Event()
        self.playing = False

    def _client_or_build(self):
        if self._client is not None:
            return self._client
        from cartesia import Cartesia
        with _clean_proxy_env():
            self._client = Cartesia(api_key=self.api_key)
        return self._client

    def synthesize(self, text: str) -> dict:
        if not text or not text.strip():
            return {"audio": b"", "first_audio_ms": 0.0}
        started = time.perf_counter()
        first_audio_ms: list[float] = []
        chunks: list[bytes] = []
        self._stop_requested.clear()

        def _call():
            client = self._client_or_build()
            stream = client.tts.bytes(
                model_id=self.model,
                output_format={"container": "raw", "encoding": "pcm_s16le", "sample_rate": 8000},
                transcript=text,
                voice={"mode": "id", "id": self.voice_id},
                language="en")
            for chunk in stream:
                if self._stop_requested.is_set():
                    break
                if not first_audio_ms:
                    first_audio_ms.append((time.perf_counter() - started) * 1000.0)
                chunks.append(bytes(chunk))
            return b"".join(chunks)

        audio = self.breaker.call(
            lambda: run_with_timeout(_call, self.timeout_s, label="Cartesia TTS"),
            label="Cartesia TTS")
        self.playing = True
        return {"audio": audio, "first_audio_ms": first_audio_ms[0] if first_audio_ms else 0.0}

    def stop(self) -> float:
        started = time.perf_counter()
        self._stop_requested.set()
        self.playing = False
        return (time.perf_counter() - started) * 1000.0


# --- Real adapter factories (lazy imports; disabled by default) -------------

def _env_key(name: str) -> str:
    return os.environ.get(name, "")


def real_stt(config, *, client=None):
    config.require_live("telephony")
    return DeepgramSTTAdapter(_env_key("DEEPGRAM_API_KEY"), client=client)


def real_llm(config, *, client=None):
    config.require_live("telephony")
    return OpenAILLMAdapter(_env_key("OPENAI_API_KEY"), client=client)


def real_tts(config, *, client=None):
    config.require_live("telephony")
    return CartesiaTTSAdapter(_env_key("CARTESIA_API_KEY"),
                              voice_id=os.environ.get("CARTESIA_VOICE_ID", ""), client=client)


def build_pipecat_pipeline(config, *, stt=None, llm=None, tts=None):
    """Construct the real Pipecat pipeline object (STT -> LLM -> TTS).

    Construction is verified offline with the pinned pipecat-ai package;
    running it needs a transport + runner and is rehearsal-gated. The
    media gateway (app/media_stream.py) runs the same STT -> LLM -> TTS
    turn loop through the adapters above, with the dialogue guardrails
    applied between the LLM and the TTS — a step Pipecat alone does not
    provide. Pass explicit services to override (tests inject fakes' real
    counterparts); otherwise the services are built from env keys.
    """
    config.require_live("telephony")
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.services.cartesia.tts import CartesiaTTSService
    from pipecat.services.deepgram.stt import DeepgramSTTService
    from pipecat.services.openai.llm import OpenAILLMService

    if stt is None:
        # Pipecat builds its own Deepgram httpx client internally, so the
        # construction itself must run under the sanitized proxy env —
        # this VM's NO_PROXY ([::1]) otherwise breaks httpx URL parsing
        # at construction time, before any audio flows.
        with _clean_proxy_env():
            stt = DeepgramSTTService(api_key=_env_key("DEEPGRAM_API_KEY"),
                                     encoding="mulaw", sample_rate=8000)
    if llm is None:
        llm = OpenAILLMService(api_key=_env_key("OPENAI_API_KEY"),
                               settings=OpenAILLMService.Settings(model="gpt-4o-mini"))
    if tts is None:
        tts = CartesiaTTSService(api_key=_env_key("CARTESIA_API_KEY"),
                                 voice_id=os.environ.get("CARTESIA_VOICE_ID", ""),
                                 model="sonic-3")
    pipeline = Pipeline([stt, llm, tts])
    return {"pipeline": pipeline, "stt": stt, "llm": llm, "tts": tts}


def real_telephony_pipeline(config):
    return build_pipecat_pipeline(config)
