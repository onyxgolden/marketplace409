"""Live-turn pipeline (go-live §2/§6/§8): STT -> dialogue -> guardrails
-> TTS, with measured latency and cost hooks.

The pipeline is provider-agnostic: it takes STT/LLM/TTS adapters (real or
fake) and a CallDialogue. The dialogue layer owns the state machine and
speaks ONLY fixed templates (or LLM text passed through quote_guard) —
the pipeline adds a final defense-in-depth re-gate of the speak text
before TTS, so a template regression can never reach a caller unguarded.

LLM role in this slice: ADVISORY ONLY. The v1 dialogue speaks fixed
templates; the LLM's proposed reply is recorded in the turn trace for
rehearsal evaluation and is never spoken. Speaking LLM text directly
would bypass the fixed-template guarantee and needs a separate review
decision — flagged in the build report, not smuggled in here.

The opening disclosure is NOT LLM-generated: when the dialogue reaches
the DISCLOSE_AI_AND_RECORDING state, the pipeline verifies the speak
text is byte-identical to the pinned disclosure revision (see
app/policy/disclosure.py) before TTS. Any mismatch fails the call
closed to human fallback.

Every turn records stage timings into the LatencyRecorder and charges
the CostLedger (STT minutes, LLM minutes, TTS chars). A turn that
exceeds the call's turn/duration limits, the cost ceiling, the kill
switch, or the activation mode fails closed to human fallback — the
pipeline raises PipelineClosed, which the media gateway translates into
the Twilio human-fallback TwiML.
"""
from __future__ import annotations

import time

from .cost import BudgetExceeded, blended_minute_usd
from .policy import quote_guard
from .policy.disclosure import current_revision, verify_disclosure_text
from .providers import ProviderError
from .session import CALL_SOURCES


class PipelineClosed(RuntimeError):
    """The turn cannot proceed (mode/kill/budget/limit). Fail to human
    fallback; never retry the same turn against a live provider."""


class CallPipeline:
    def __init__(self, *, stt, llm, tts, dialogue, config, cost_ledger=None,
                 latency_recorder=None, kill_switch=None, activation_mode: str = "OFF",
                 source: str = "SYNTHETIC", call_sid: str = ""):
        if source not in CALL_SOURCES:
            raise ValueError(
                f"call source must be one of {CALL_SOURCES}, got {source!r}")
        self.stt = stt
        self.llm = llm
        self.tts = tts
        self.dialogue = dialogue
        self.config = config
        self.cost_ledger = cost_ledger
        self.latency_recorder = latency_recorder
        self.kill_switch = kill_switch
        self.activation_mode = activation_mode
        self.source = source
        self.call_sid = call_sid
        self.turns = 0
        self.started_at = time.monotonic()
        self.agent_chars = 0

    # --- guards ---------------------------------------------------------------

    def _require_live_turn(self) -> None:
        if self.activation_mode == "OFF":
            raise PipelineClosed("activation mode OFF: no live turns")
        if self.kill_switch is not None and self.kill_switch.is_killed():
            raise PipelineClosed("kill switch engaged: no live turns")
        if self.turns >= self.config.max_turns_per_call:
            raise PipelineClosed(f"turn limit reached ({self.config.max_turns_per_call})")
        if time.monotonic() - self.started_at > self.config.max_call_duration_s:
            raise PipelineClosed("call duration limit reached")
        if self.cost_ledger is not None:
            try:
                # Reserve one more minute of headroom BEFORE any provider
                # work this turn: the reservation is atomic across
                # concurrent sessions (fix round 1, P1-3), so a turn can
                # never start on a ceiling a sibling call already spent.
                # The reservation is settled into the actual turn cost by
                # record_call at the end of handle_audio.
                self.cost_ledger.reserve(
                    call_sid=self.call_sid, source=self.source,
                    projected_usd=blended_minute_usd(self.config.cost_rate_version),
                    max_per_call_usd=self.config.max_cost_per_call_usd,
                    max_campaign_usd=self.config.max_cost_campaign_usd)
            except BudgetExceeded as exc:
                # Budget exhaustion fails the call closed to human fallback
                # (the gateway catches PipelineClosed); it must never
                # escape as a raw BudgetExceeded and kill the stream thread.
                raise PipelineClosed(str(exc)) from exc

    # --- disclosure -----------------------------------------------------------

    def verify_disclosure(self, dialogue_out: dict) -> dict:
        """If this turn speaks the disclosure, verify it is byte-identical
        to the pinned revision before TTS. Returns revision info (the
        caller must surface UNAPPROVED wherever the disclosure is shown).
        Raises PipelineClosed on any mismatch."""
        speak = dialogue_out.get("speak") or {}
        if speak.get("template_id") != "disclosure":
            return {"disclosure_spoken": False}
        revision = current_revision()
        if not verify_disclosure_text(revision["id"], speak.get("text", "")):
            raise PipelineClosed(
                "disclosure text drifted from the pinned revision "
                f"{revision['id']}; refusing to speak an unpinned disclosure")
        return {"disclosure_spoken": True, "revision_id": revision["id"],
                "revision_status": revision["status"]}

    # --- one live turn ----------------------------------------------------------

    def handle_audio(self, audio: bytes) -> dict:
        """One turn: audio chunk -> transcript -> dialogue -> guarded reply
        -> TTS audio. Returns {"audio", "transcript", "reply_text",
        "dialogue_state", "trace": {...stage ms...}, "llm_text",
        "disclosure": {...}}. Raises PipelineClosed on any guard,
        ProviderError on a provider failure (the gateway then falls back
        to the safe prompt, never invents a slot)."""
        self._require_live_turn()
        turn_started = time.perf_counter()
        trace: dict = {}

        stt_started = time.perf_counter()
        try:
            stt_result = self.stt.transcribe_chunk(audio)
        except ProviderError:
            raise
        except Exception as exc:  # noqa: BLE001 — provider-shaped failure
            raise ProviderError(str(exc)) from exc
        trace["stt_ms"] = (time.perf_counter() - stt_started) * 1000.0
        transcript = (stt_result or {}).get("text", "")

        # LLM is advisory in this slice: its text is timed and recorded
        # for rehearsal evaluation, never spoken.
        llm_started = time.perf_counter()
        llm_text = ""
        try:
            llm_result = self.llm.respond(
                state=self.dialogue.state, response_class="REPLY",
                history=[{"role": "user", "content": transcript}])
            llm_text = (llm_result or {}).get("text", "")
        except Exception:  # noqa: BLE001 — LLM advisory only; dialogue continues
            llm_text = ""
        trace["llm_ms"] = (time.perf_counter() - llm_started) * 1000.0

        dialogue_out = self.dialogue.handle_turn(transcript)
        speak = dialogue_out.get("speak") or {}
        reply_text = speak.get("text", "")

        # Disclosure pinning: verify before anything is spoken.
        disclosure_info = self.verify_disclosure(dialogue_out)

        # Defense in depth: re-gate the speak text on CONTENT only (the
        # dialogue's template ids are not response classes, so the class
        # check is run against the always-allowed "acknowledge" class).
        # Fixed templates pass; any drift (or a template regression) falls
        # back to the safe human-callback template instead of reaching TTS.
        template_id = speak.get("template_id", "human_callback")
        violations = quote_guard.find_violations(
            reply_text, "acknowledge", is_readback=(template_id == "readback"))
        if violations:
            reply_text = quote_guard.render_template("human_callback")["text"]

        tts_started = time.perf_counter()
        tts_result = self.tts.synthesize(reply_text) if reply_text else {"audio": b"", "first_audio_ms": 0.0}
        trace["tts_first_audio_ms"] = tts_result.get("first_audio_ms", 0.0)
        trace["e2e_ms"] = (time.perf_counter() - turn_started) * 1000.0
        self.agent_chars += len(reply_text)
        self.turns += 1

        if self.latency_recorder is not None:
            self.latency_recorder.record_turn(
                call_sid=self.call_sid, turn=self.turns, source=self.source,
                stt_ms=trace["stt_ms"], llm_ms=trace["llm_ms"],
                tts_first_audio_ms=trace["tts_first_audio_ms"], e2e_ms=trace["e2e_ms"])
        if self.cost_ledger is not None:
            self.cost_ledger.record_call(
                call_sid=self.call_sid, source=self.source,
                duration_s=(time.perf_counter() - turn_started),
                agent_chars=len(reply_text), llm_minutes=trace["llm_ms"] / 60000.0)

        return {"audio": tts_result.get("audio", b""), "transcript": transcript,
                "reply_text": reply_text, "dialogue_state": dialogue_out.get("state"),
                "emergency": dialogue_out.get("emergency", False),
                "trace": trace, "llm_text": llm_text,
                "disclosure": disclosure_info}

    def safe_clarify(self) -> dict:
        """Provider failure on a turn: run the dialogue's STT-failure path
        (asks the caller to repeat; never invents a slot) and TTS the
        safe prompt. No provider is retried for this turn."""
        dialogue_out = self.dialogue.handle_turn("", stt_failed=True)
        speak = dialogue_out.get("speak") or {}
        reply_text = speak.get("text", "")
        tts_result = self.tts.synthesize(reply_text) if reply_text else {"audio": b"", "first_audio_ms": 0.0}
        return {"audio": tts_result.get("audio", b""), "transcript": "",
                "reply_text": reply_text, "dialogue_state": dialogue_out.get("state"),
                "emergency": dialogue_out.get("emergency", False),
                "trace": {}, "llm_text": "", "disclosure": {"disclosure_spoken": False}}

    def barge_in_stop(self) -> float:
        """Caller interrupted the agent: stop TTS immediately. Returns the
        measured stop latency in ms (target p95 ≤ 250 ms)."""
        started = time.perf_counter()
        try:
            stopped_ms = self.tts.stop()
        except Exception:  # noqa: BLE001 — stop must never raise
            stopped_ms = (time.perf_counter() - started) * 1000.0
        if self.latency_recorder is not None:
            self.latency_recorder.record_turn(
                call_sid=self.call_sid, turn=self.turns, source=self.source,
                barge_in_stop_ms=stopped_ms)
        return stopped_ms
