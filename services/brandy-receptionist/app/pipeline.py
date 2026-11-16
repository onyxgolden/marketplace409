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

Fix round 1 (P1 — Receptionist Cut 1 local-build review): the LLM call
is now GENUINELY off the critical path, not just "timed and ignored."
A background thread runs it; `_turn` starts that thread and moves
straight to dialogue/disclosure/quote-guard/TTS without ever joining
it. `result["llm_text"]`/`trace["llm_ms"]` therefore reflect the MOST
RECENTLY COMPLETED advisory result — which may be from an earlier turn,
or absent (`None`/empty) on the very first turn before any advisory
call has finished — never this turn's own synchronous result, because
there isn't one. `wait_for_pending_llm_advisory()` exists ONLY for
tests that need to assert on the eventually-completed value
deterministically; production code must never call it, since doing so
would recreate the exact blocking bug this fixes.

The opening disclosure is NOT LLM-generated: when the dialogue reaches
the DISCLOSE_AI_AND_RECORDING state, the pipeline verifies the speak
text is byte-identical to the pinned disclosure revision (see
app/policy/disclosure.py) before TTS. Any mismatch fails the call
closed to human fallback.

Every turn records stage timings into the LatencyRecorder and charges
the CostLedger for its incremental provider usage (LLM minutes, TTS
chars); the call's duration is charged once at close, on the full
elapsed call duration (fix round 2, P1 — pricing a turn's processing
time as duration would double-count it against the final duration
charge, and settling a turn must never drop the session reservation).
A turn that exceeds the call's turn/duration limits, the cost ceiling, the kill
switch, or the activation mode fails closed to human fallback — the
pipeline raises PipelineClosed, which the media gateway translates into
the Twilio human-fallback TwiML.
"""
from __future__ import annotations

import threading
import time

from .cost import BudgetExceeded, blended_minute_usd
from .policy import quote_guard
from .policy.disclosure import current_revision, verify_disclosure_hash, verify_disclosure_text
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
        # The current turn's reservation (fix round 2, P1): held from
        # _require_live_turn until the turn settles (success) or is
        # released (failure). Distinct from the session reservation the
        # gateway holds for the call's duration — a turn must never
        # release the session reservation.
        self._turn_reservation: dict | None = None
        # Fix round 1 (P1): the advisory LLM's last-completed result,
        # updated only by `_run_advisory_llm` running in its own
        # background thread — never written from the main turn flow,
        # which only READS it (lock-protected) to populate this turn's
        # `llm_text`/`trace["llm_ms"]` with whatever is already known.
        self._llm_lock = threading.Lock()
        self.last_llm_result: dict = {"text": "", "ms": None}
        self._llm_thread: threading.Thread | None = None

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
                # The reservation is held in self._turn_reservation and
                # settled by handle_audio into ONLY this turn's actual
                # cost (fix round 2, P1) — it never touches the session
                # reservation the gateway holds for the call's duration.
                # A failed turn releases it instead (see
                # _release_turn_reservation), so a failed provider turn
                # holds no headroom after the failure.
                self._turn_reservation = self.cost_ledger.reserve(
                    call_sid=self.call_sid, source=self.source,
                    purpose="turn",
                    projected_usd=blended_minute_usd(self.config.cost_rate_version),
                    max_per_call_usd=self.config.max_cost_per_call_usd,
                    max_campaign_usd=self.config.max_cost_campaign_usd)
            except BudgetExceeded as exc:
                # Budget exhaustion fails the call closed to human fallback
                # (the gateway catches PipelineClosed); it must never
                # escape as a raw BudgetExceeded and kill the stream thread.
                raise PipelineClosed(str(exc)) from exc

    def _release_turn_reservation(self) -> None:
        """Release the current turn's reservation without settling it
        (the turn failed, so the projected spend never happened). The
        session reservation is untouched. Never raises: a corrupt ledger
        refuses the release, which is conservative — the headroom stays
        held until an operator reconciles it."""
        reservation, self._turn_reservation = self._turn_reservation, None
        if reservation is None or self.cost_ledger is None:
            return
        try:
            self.cost_ledger.release_reservation(reservation["id"])
        except BudgetExceeded:
            pass

    # --- disclosure -----------------------------------------------------------

    def verify_disclosure(self, dialogue_out: dict) -> dict:
        """If this turn speaks the disclosure, verify it is byte-identical
        AND hash-identical to the pinned revision before TTS (local-build
        Cut 1 §2: "a revision id/hash verified before first audio" — the
        hash check is a second, independent comparison against the
        registry's own pinned SHA-256, not just a repeat of the text
        check). Returns revision info (the caller must surface UNAPPROVED
        wherever the disclosure is shown). Raises PipelineClosed on any
        mismatch."""
        speak = dialogue_out.get("speak") or {}
        if speak.get("template_id") != "disclosure":
            return {"disclosure_spoken": False}
        revision = current_revision()
        text = speak.get("text", "")
        if not verify_disclosure_text(revision["id"], text) or not verify_disclosure_hash(revision["id"], text):
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
        to the safe prompt, never invents a slot). A failed turn
        releases its own reservation (the projected spend never
        happened) and never touches the session reservation."""
        self._require_live_turn()
        try:
            return self._turn(audio)
        except BudgetExceeded as exc:
            # A corrupt ledger at settlement must fail the call closed
            # to human fallback, never kill the stream thread with a
            # raw BudgetExceeded (same rule as _require_live_turn).
            self._release_turn_reservation()
            raise PipelineClosed(str(exc)) from exc
        except (PipelineClosed, ProviderError):
            self._release_turn_reservation()
            raise
        except Exception:
            self._release_turn_reservation()
            raise

    def _turn(self, audio: bytes) -> dict:
        """One turn's provider work: STT -> advisory LLM -> dialogue ->
        disclosure pinning -> quote-guard re-gate -> TTS -> latency +
        cost settlement. Called only from handle_audio, after
        _require_live_turn has reserved this turn's headroom."""
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

        # LLM is advisory in this slice, and (fix round 1, P1) genuinely
        # off the critical path: start it in the background and read
        # whatever the MOST RECENTLY COMPLETED advisory call produced —
        # never wait for this turn's own call before proceeding to
        # dialogue/TTS below.
        self._llm_thread = threading.Thread(
            target=self._run_advisory_llm, args=(transcript, self.dialogue.state), daemon=True)
        self._llm_thread.start()
        with self._llm_lock:
            llm_text = self.last_llm_result.get("text", "")
            trace["llm_ms"] = self.last_llm_result.get("ms")

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
            # Settle ONLY this turn's reservation (fix round 2, P1):
            # the session reservation stays held for the call's
            # duration. The turn prices only its incremental provider
            # usage (LLM minutes + TTS chars, duration 0) — duration
            # is priced exactly once, by the final record at close,
            # on the full elapsed call duration. (_require_live_turn
            # always sets _turn_reservation when a ledger is present;
            # a missing id here would fall back to releasing all of
            # the call's reservations, the old behavior — it cannot
            # happen through handle_audio.)
            reservation, self._turn_reservation = self._turn_reservation, None
            # Fix round 1 (P1): `trace["llm_ms"]` is now the LAST
            # completed advisory call's duration, not necessarily this
            # turn's own (which may still be running in the background)
            # — an approximation, documented here rather than hidden,
            # accepted in exchange for never blocking the spoken reply
            # on the LLM. Local-inference LLM usage prices at $0/minute
            # regardless (brief §5), so this approximation has zero
            # dollar impact on the local provider path; it only affects
            # the cloud OpenAI adapter's cost-ledger precision, by at
            # most one turn's worth of LLM minutes, never accumulating
            # (each turn's charge still reflects a real completed call,
            # just possibly the previous turn's).
            self.cost_ledger.record_call(
                call_sid=self.call_sid, source=self.source,
                duration_s=0.0,
                agent_chars=len(reply_text),
                llm_minutes=(trace["llm_ms"] or 0.0) / 60000.0,
                settle_reservation_id=(reservation or {}).get("id"),
                usage_extra={"turn": self.turns})

        return {"audio": tts_result.get("audio", b""), "transcript": transcript,
                "reply_text": reply_text, "dialogue_state": dialogue_out.get("state"),
                "emergency": dialogue_out.get("emergency", False),
                "trace": trace, "llm_text": llm_text,
                "disclosure": disclosure_info}

    def _run_advisory_llm(self, transcript: str, state: str) -> None:
        """Runs in its own daemon thread (fix round 1, P1), started by
        `_turn` and never joined by it. Failure here is swallowed, same
        as the old synchronous version — advisory-only, the dialogue
        continues regardless either way."""
        started = time.perf_counter()
        text = ""
        try:
            result = self.llm.respond(
                state=state, response_class="REPLY", history=[{"role": "user", "content": transcript}])
            text = (result or {}).get("text", "")
        except Exception:  # noqa: BLE001 — LLM advisory only
            text = ""
        ms = (time.perf_counter() - started) * 1000.0
        with self._llm_lock:
            self.last_llm_result = {"text": text, "ms": ms}

    def wait_for_pending_llm_advisory(self, timeout: float = 5.0) -> None:
        """TEST-ONLY: blocks until the most recently started advisory
        LLM thread finishes (or `timeout` elapses), so a test can assert
        on `self.last_llm_result` deterministically instead of racing a
        background thread. Production code must never call this — doing
        so recreates the exact blocking bug fix round 1 removed."""
        if self._llm_thread is not None:
            self._llm_thread.join(timeout)

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
