"""Twilio Media Streams WebSocket gateway (go-live §2).

Stdlib-only WebSocket server (RFC 6455): HTTP Upgrade handshake,
text/binary/control frames, ping/pong, close. Twilio sends JSON text
frames (connected / start / media / stop / mark) and receives JSON text
frames (media with base64 mulaw 8kHz audio, clear, mark).

Flow per stream:
  connected -> log
  start     -> validate the signed stream token (customParameters.token,
               bound to call SID + operation), check mode + kill + budget,
               create the live session + CallPipeline, mark the TwiML
               disclosure as played (the dialogue must not repeat it)
  media     -> sequence/timestamp tracking (gaps recorded, never fatal),
               barge-in detection (caller audio while TTS is playing ->
               pipeline stop + Twilio `clear`), utterance buffering,
               pipeline turn -> paced audio back to Twilio; the duration
               budget is enforced on a deadline independent of frames
               (one blended minute reserved per elapsed minute, the
               next claimed 5 s before its interval starts, call ended
               when the ceilings cannot fund it — fix round 3, P1;
               deadline + watchdog enforcement fix round 4, P1):
               every media event re-checks it, each socket read is
               bounded by the next deadline, and an independent
               watchdog thread enforces it while frames stall or a
               provider turn blocks the loop
  stop      -> end the session, ingest the call record, close cleanly
  mark      -> log (playback acknowledgement)

Reconnect: a stream that drops without `stop` ends the session as
INCOMPLETE (safe close, no phantom record). A reconnect with the same
call SID + a fresh valid token resumes the EXISTING session instead of
creating a duplicate — resume is bounded by the stream-token TTL (120 s).

No provider key, number, or recipient lives here. The gateway refuses
live sessions unless the activation mode allows them and the provider
factory can build real adapters (no keys => no live session).
"""
from __future__ import annotations

import base64
import hashlib
import json
import queue
import select
import socket
import struct
import threading
import time

from .cost import BudgetExceeded, blended_minute_usd
from .pipeline import PipelineClosed
from .providers import ProviderError
from .session import CallSession, canonical_source
from .telephony_twilio import (
    MediaSequenceTracker, parse_media_event, verify_stream_token)

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
FRAME_BYTES = 160          # 20 ms of mulaw 8kHz audio per Twilio frame
FRAME_INTERVAL_S = 0.02
UTTERANCE_FLUSH_FRAMES = 50  # flush a turn after ~1.0 s of caller audio
# Fix round 4, P1 — deadline enforcement: the next minute is reserved
# RESERVE_MARGIN_S before its billable interval starts, so scheduling
# and network delays can never push the reservation past the boundary.
RESERVE_MARGIN_S = 5.0
# Longest a single socket wait may run without a budget recheck.
MAX_READ_TIMEOUT_S = 30.0
# The watchdog re-derives its deadline at least this often, so an
# extension made by the loop thread is never stale for long.
WATCHDOG_POLL_S = 5.0


def _ws_accept(key: str) -> str:
    digest = hashlib.sha1((key + WS_GUID).encode()).digest()
    return base64.b64encode(digest).decode()


class _FrameTimeout(Exception):
    """No complete frame arrived before the read deadline. Any partial
    bytes already received stay buffered in the reader — the next read
    resumes the same frame instead of desyncing the stream."""


_NEED_MORE = object()  # _try_parse_frame sentinel: not enough bytes yet


def _try_parse_frame(buf: bytes):
    """Parse one complete WebSocket frame from the head of `buf`.

    Returns (frame, consumed) where frame is {"opcode", "payload"} (or
    None for a clean close frame) and consumed is the byte count to
    drop from the buffer; returns (_NEED_MORE, 0) when the buffer
    does not yet hold a whole frame. Raises ValueError on fragmented
    frames, exactly as the old blocking read_frame did."""
    if len(buf) < 2:
        return _NEED_MORE, 0
    b0, b1 = buf[0], buf[1]
    fin = bool(b0 & 0x80)
    opcode = b0 & 0x0F
    masked = bool(b1 & 0x80)
    length = b1 & 0x7F
    offset = 2
    if length == 126:
        if len(buf) < offset + 2:
            return _NEED_MORE, 0
        length = struct.unpack(">H", buf[offset:offset + 2])[0]
        offset += 2
    elif length == 127:
        if len(buf) < offset + 8:
            return _NEED_MORE, 0
        length = struct.unpack(">Q", buf[offset:offset + 8])[0]
        offset += 8
    if masked:
        if len(buf) < offset + 4:
            return _NEED_MORE, 0
        mask_key = buf[offset:offset + 4]
        offset += 4
    else:
        mask_key = b""
    if len(buf) < offset + length:
        return _NEED_MORE, 0
    payload = bytes(buf[offset:offset + length])
    if masked:
        payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
    if not fin:
        raise ValueError("fragmented websocket frames are not supported")
    consumed = offset + length
    if opcode == 8:  # close
        return None, consumed
    if opcode == 9:  # ping -> caller replies with pong
        return {"opcode": 9, "payload": payload}, consumed
    if opcode == 10:  # pong -> ignore
        return {"opcode": 10, "payload": payload}, consumed
    return {"opcode": opcode, "payload": payload}, consumed


class _BufferedFrameReader:
    """Reads WebSocket frames from a socket against a deadline.

    Bytes are accumulated in an internal buffer and frames are parsed
    from it, so a read that times out mid-frame loses nothing: the
    partial bytes stay buffered and the next read resumes the same
    frame. The wait uses select(), never the socket timeout — the
    audio sender thread shares this socket and its sendall relies on
    the 30 s socket timeout, so the reader must not shrink it.

    read_frame_until(deadline_s) returns the next complete frame, or
    None on a clean close frame; it raises _FrameTimeout when the
    deadline passes first, ConnectionError when the peer closes, and
    ValueError on protocol errors."""

    def __init__(self, sock: socket.socket):
        self._sock = sock
        self._buf = bytearray()

    def read_frame_until(self, deadline_s: float) -> dict | None:
        while True:
            frame, consumed = _try_parse_frame(bytes(self._buf))
            if frame is not _NEED_MORE:
                del self._buf[:consumed]
                return frame
            remaining = deadline_s - time.time()
            if remaining <= 0:
                raise _FrameTimeout()
            wait = None if remaining == float("inf") else remaining
            readable, _, _ = select.select([self._sock], [], [], wait)
            if not readable:
                raise _FrameTimeout()
            chunk = self._sock.recv(65536)
            if not chunk:
                raise ConnectionError("websocket peer closed")
            self._buf.extend(chunk)


def read_frame(sock: socket.socket) -> dict | None:
    """Read one WebSocket frame (blocking). Returns {"opcode", "payload"}
    or None on a clean close frame. Raises on protocol errors / peer
    disconnect. Kept for single-frame callers; the gateway loop uses
    _BufferedFrameReader so a deadline can interrupt a stalled read
    without losing partial bytes."""
    return _BufferedFrameReader(sock).read_frame_until(float("inf"))


def write_frame(sock: socket.socket, opcode: int, payload: bytes) -> None:
    """Write one server->client frame (never masked, per RFC 6455)."""
    header = bytes([0x80 | opcode])
    length = len(payload)
    if length < 126:
        header += bytes([length])
    elif length < 65536:
        header += bytes([126]) + struct.pack(">H", length)
    else:
        header += bytes([127]) + struct.pack(">Q", length)
    sock.sendall(header + payload)


def write_text(sock: socket.socket, text: str) -> None:
    write_frame(sock, 1, text.encode("utf-8"))


class AudioSender(threading.Thread):
    """Paces TTS audio back to Twilio at real time: one 160-byte frame
    per 20 ms. Bursting would jitter playback; the queue + pacing keeps
    the stream smooth. daemon thread; stop() drains then exits."""

    def __init__(self, sock: socket.socket, stream_sid: str):
        super().__init__(daemon=True)
        self._sock = sock
        self._stream_sid = stream_sid
        self._queue: queue.Queue[bytes | None] = queue.Queue()
        self._stopped = False

    def send(self, audio: bytes) -> None:
        if self._stopped:
            return
        self._queue.put(audio)

    def clear(self) -> None:
        """Drop queued (not yet sent) audio — barge-in: Twilio already got
        a `clear`, so anything still queued must not play after it."""
        try:
            while True:
                self._queue.get_nowait()
        except queue.Empty:
            pass

    def stop(self) -> None:
        self._stopped = True
        self._queue.put(None)

    def run(self) -> None:
        mark_counter = 0
        while True:
            audio = self._queue.get()
            if audio is None:
                return
            for offset in range(0, len(audio), FRAME_BYTES):
                chunk = audio[offset:offset + FRAME_BYTES]
                if len(chunk) < FRAME_BYTES:
                    chunk = chunk + b"\xff" * (FRAME_BYTES - len(chunk))
                try:
                    write_text(self._sock, json.dumps({
                        "event": "media", "streamSid": self._stream_sid,
                        "media": {"payload": base64.b64encode(chunk).decode()}}))
                except (OSError, ValueError):
                    return
                time.sleep(FRAME_INTERVAL_S)
            mark_counter += 1
            try:
                write_text(self._sock, json.dumps({
                    "event": "mark", "streamSid": self._stream_sid,
                    "mark": {"name": f"turn-{mark_counter}"}}))
            except (OSError, ValueError):
                return


class _BudgetWatchdog(threading.Thread):
    """Independent duration-deadline enforcer (fix round 4, P1).

    The media loop's deadline-bounded reads cannot fire while the
    loop thread is blocked in a long provider turn, while a partial
    frame trickles in byte by byte, or while a send blocks. The
    watchdog runs on its own thread and enforces the budget at each
    deadline instead: it reserves the next minute (or ends the call),
    and on ending it shuts the socket down so any blocked read/send
    in the loop or sender thread unblocks at once. It re-derives the
    deadline from the live session at least every WATCHDOG_POLL_S, so
    an extension made by the loop thread is never stale for long.
    Daemon thread; stopped via `stop_event`, and it exits on its own
    when the session is gone."""

    def __init__(self, gateway: "MediaStreamGateway", conn: socket.socket,
                 call_sid: str, stop_event: threading.Event):
        super().__init__(daemon=True)
        self._gateway = gateway
        self._conn = conn
        self._call_sid = call_sid
        self._stop = stop_event

    def run(self) -> None:
        while not self._stop.is_set():
            live = self._gateway.server.live_sessions.get(self._call_sid)
            if live is None:
                return
            deadline = self._gateway._next_budget_deadline(live)
            delay = deadline - time.time()
            if delay <= 0:
                reason = self._gateway._duration_budget_check(
                    live, self._call_sid)
                if reason is not None:
                    self._terminate(reason)
                    return
                continue
            self._stop.wait(timeout=min(delay, WATCHDOG_POLL_S))

    def _terminate(self, reason: str) -> None:
        self._gateway.server.end_live_session(self._call_sid, reason)
        try:
            self._conn.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass


class MediaStreamGateway:
    """One gateway process: accepts Twilio Media Streams connections and
    drives CallPipelines. `server` is the ReceptionistServer (duck-typed):
    it provides config, kill_switch, cost_ledger, latency_recorder,
    activation_state(), make_pipeline(call_sid, source), and
    end_live_session(call_sid, reason)."""

    def __init__(self, server, *, host: str = "127.0.0.1", port: int = 8765):
        self.server = server
        self.host = host
        self.port = port
        self._sock: socket.socket | None = None
        self._thread: threading.Thread | None = None
        self._running = False
        self._connections = 0
        self._lock = threading.Lock()

    # --- lifecycle -----------------------------------------------------------

    def start(self) -> None:
        if self._running:
            return
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind((self.host, self.port))
        self._sock.listen(8)
        self._sock.settimeout(1.0)
        self._running = True
        self._thread = threading.Thread(target=self._accept_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._running = False
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
        self._sock = None

    @property
    def running(self) -> bool:
        return self._running

    def connection_count(self) -> int:
        with self._lock:
            return self._connections

    def _accept_loop(self) -> None:
        while self._running:
            try:
                conn, _addr = self._sock.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            with self._lock:
                self._connections += 1
            threading.Thread(target=self._handle_connection, args=(conn,),
                             daemon=True).start()

    # --- per-connection ------------------------------------------------------

    def _handle_connection(self, conn: socket.socket) -> None:
        stream_sid = None
        call_sid = None
        sender: AudioSender | None = None
        watchdog: _BudgetWatchdog | None = None
        watchdog_stop = threading.Event()
        try:
            conn.settimeout(MAX_READ_TIMEOUT_S)
            key = self._handshake(conn)
            if key is None:
                conn.close()
                return
            tracker = MediaSequenceTracker()
            audio_buffer = bytearray()
            frames_since_flush = 0
            reader = _BufferedFrameReader(conn)
            while True:
                # Deadline-bounded read (fix round 4, P1): the next
                # frame is awaited only until the budget must next be
                # enforced — the earlier of the next minute's reserve
                # deadline, the absolute duration cap, and 30 s. A
                # timeout here is not a dropped stream: it is the
                # moment to reserve the next minute or end the call.
                # Partial bytes stay buffered in the reader.
                live = (self.server.live_sessions.get(call_sid)
                        if call_sid is not None else None)
                deadline = time.time() + MAX_READ_TIMEOUT_S
                if live is not None:
                    deadline = min(deadline,
                                   self._next_budget_deadline(live))
                try:
                    frame = reader.read_frame_until(deadline)
                except _FrameTimeout:
                    live = (self.server.live_sessions.get(call_sid)
                            if call_sid is not None else None)
                    if live is not None:
                        reason = self._duration_budget_check(live, call_sid)
                        if reason is not None:
                            self.server.end_live_session(call_sid, reason)
                            break
                    continue
                if frame is None:
                    break  # clean close
                if frame["opcode"] == 9:  # ping
                    write_frame(conn, 10, frame["payload"])
                    continue
                if frame["opcode"] != 1:  # text only
                    continue
                try:
                    event = parse_media_event(frame["payload"].decode("utf-8"))
                except ValueError:
                    continue  # malformed frame: drop, never trust
                etype = event["event"]
                if etype == "connected":
                    continue
                if etype == "start":
                    stream_sid = event["stream_sid"]
                    call_sid = event["call_sid"]
                    token = (event["custom_parameters"] or {}).get("token", "")
                    session = self._start_session(conn, event, token)
                    if session is None:
                        break  # refused: token/mode/kill/budget — socket closed
                    sender = session["sender"]
                    # Independent deadline enforcer (fix round 4, P1):
                    # covers the cases a bounded read cannot — a
                    # partial frame trickling in, a long provider turn
                    # blocking this thread, a blocked send.
                    watchdog = _BudgetWatchdog(self, conn, call_sid,
                                               watchdog_stop)
                    watchdog.start()
                    continue
                if call_sid is None:
                    continue  # media before start: ignore
                if etype == "media":
                    tracker.observe(sequence_number=event["sequence_number"],
                                    timestamp=event["timestamp"])
                    raw = base64.b64decode(event["payload_b64"])
                    # Barge-in: caller audio while TTS is playing.
                    live = self.server.live_sessions.get(call_sid)
                    if live is not None and live["pipeline"].tts.playing:
                        live["pipeline"].barge_in_stop()
                        if sender is not None:
                            sender.clear()
                        write_text(conn, json.dumps(
                            {"event": "clear", "streamSid": stream_sid}))
                    audio_buffer.extend(raw)
                    frames_since_flush += 1
                    if frames_since_flush >= UTTERANCE_FLUSH_FRAMES:
                        self._flush_turn(conn, call_sid, bytes(audio_buffer), sender)
                        audio_buffer.clear()
                        frames_since_flush = 0
                elif etype == "mark":
                    continue  # playback acknowledgement
                elif etype == "stop":
                    if audio_buffer:
                        self._flush_turn(conn, call_sid, bytes(audio_buffer), sender)
                        audio_buffer.clear()
                    self.server.end_live_session(call_sid, "twilio_stop")
                    break
                # Duration budget (fix round 3, P1; deadline-enforced
                # in fix round 4): checked after every media event,
                # independent of turns — a silent call's frames arrive
                # just as steadily as a talking call's, so its budget
                # is enforced even with no turns. A failed extension
                # (or the absolute duration cap) ends the session
                # before the next billable interval accrues; the
                # socket close falls back to Twilio's human
                # voicemail/forwarding. The same check also runs on
                # the read deadline and in the watchdog thread, so a
                # call with no frames at all is enforced just the same.
                if call_sid is not None:
                    live = self.server.live_sessions.get(call_sid)
                    if live is not None:
                        reason = self._duration_budget_check(live, call_sid)
                        if reason is not None:
                            self.server.end_live_session(call_sid, reason)
                            break
        except (ConnectionError, OSError, ValueError):
            # Dropped stream without `stop`: end as INCOMPLETE (safe close).
            if call_sid is not None:
                self.server.end_live_session(call_sid, "stream_dropped")
        finally:
            watchdog_stop.set()
            if sender is not None:
                sender.stop()
            try:
                conn.close()
            except OSError:
                pass
            with self._lock:
                self._connections -= 1

    def _handshake(self, conn: socket.socket) -> str | None:
        """Read the HTTP Upgrade request; reply 101 or 400. Returns the
        Sec-WebSocket-Key on success, None on failure."""
        request = b""
        while b"\r\n\r\n" not in request and len(request) < 8192:
            chunk = conn.recv(4096)
            if not chunk:
                return None
            request += chunk
        head = request.split(b"\r\n\r\n", 1)[0].decode("latin-1")
        lines = head.split("\r\n")
        headers = {}
        for line in lines[1:]:
            if ":" in line:
                name, value = line.split(":", 1)
                headers[name.strip().lower()] = value.strip()
        key = headers.get("sec-websocket-key")
        if not key or headers.get("upgrade", "").lower() != "websocket":
            conn.sendall(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n")
            return None
        response = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {_ws_accept(key)}\r\n\r\n"
        )
        conn.sendall(response.encode("latin-1"))
        return key

    # --- session lifecycle -----------------------------------------------------

    def _start_session(self, conn: socket.socket, event: dict, token: str) -> dict | None:
        """Validate the stream token + mode + kill + budget, then create or
        resume the live session. Returns the session dict, or None to
        refuse (the caller then closes the socket — Twilio falls back to
        the number's human voicemail/forwarding)."""
        call_sid = event["call_sid"]
        secret = self.server.config.stream_token_secret
        if not verify_stream_token(secret, token, call_sid, self.server.config.operation_id):
            return None
        state = self.server.activation_state()
        if state["mode"] == "OFF":
            return None
        if self.server.kill_switch.is_killed():
            return None
        # Resume: same call SID re-connecting within the token TTL keeps
        # its session (no duplicate call record, no duplicate pipeline).
        existing = self.server.live_sessions.get(call_sid)
        if existing is not None:
            return existing
        # Canonical mode -> source mapping at the gateway boundary (fix
        # round 1, P1-1): a TEST_ONLY session is a TEST call, a
        # LIVE_APPROVED session is a LIVE call. The ingest route and the
        # DB CHECK accept only TEST | LIVE | SYNTHETIC — a raw mode value
        # here would 400 every rehearsal ingest. OFF is refused above.
        source = canonical_source(state["mode"])
        # Hard budget first (fix round 1, P1-3): reserve one minute of
        # headroom BEFORE creating the session or any provider pipeline.
        # An exhausted campaign refuses the session here — no provider
        # session, no chargeable action, no phantom record. The
        # reservation is purpose "session" (fix round 2, P1): it is
        # the call's duration headroom, held for the whole call, and
        # settled only by the final record at session end — a turn's
        # settlement never touches it. Its id is kept on the live
        # session so the close path can settle it explicitly; it is
        # released if pipeline construction fails.
        #
        # One minute is only the FIRST minute (fix round 3, P1): the
        # gateway extends the session reservation one blended minute
        # per elapsed minute — on every media event, on the read
        # deadline, and in the watchdog thread (_duration_budget_check
        # / _next_budget_deadline, fix round 4) — independent of turns,
        # so a silent call cannot accrue unreserved billable duration.
        # The full 30-minute maximum is NOT reserved at admission: at
        # the blended rate it costs ~$1.20, more than the $0.50 per-call
        # ceiling, so a full-max reservation would refuse every call.
        # Instead each minute is claimed atomically as it approaches,
        # and the call ends (fail closed) the minute the ceilings
        # cannot fund the next one. Under the default ceilings a call
        # is therefore duration-capped at ~12 minutes ($0.50 / $0.04);
        # the 30-minute maximum is reachable only with a higher
        # per-call ceiling, set by the owner with the spend word.
        reservation = None
        try:
            reservation = self.server.cost_ledger.reserve(
                call_sid=call_sid, source=source, purpose="session",
                projected_usd=blended_minute_usd(
                    self.server.config.cost_rate_version),
                max_per_call_usd=self.server.config.max_cost_per_call_usd,
                max_campaign_usd=self.server.config.max_cost_campaign_usd)
            # Admission must fit the reserved duration AND the
            # projected turn spend (fix round 3, P1): one more blended
            # minute for a turn has to fit the PER-CALL ceiling, or
            # the call is admitted into a state where it can never
            # take a turn. The campaign ceiling is NOT part of this
            # check: the campaign is shared and dynamic (a sibling
            # ending frees it), and every reserve() claim enforces it
            # atomically — the check here is the per-call fit the
            # verdict requires. A sibling may still consume the
            # headroom before the first turn; that turn's own
            # reserve() is the real guard and fails the call closed
            # then.
            self.server.cost_ledger.check_call_ceiling(
                call_sid=call_sid,
                projected_usd=blended_minute_usd(
                    self.server.config.cost_rate_version),
                max_per_call_usd=self.server.config.max_cost_per_call_usd)
        except BudgetExceeded:
            if reservation is not None:
                try:
                    self.server.cost_ledger.release_reservation(
                        reservation["id"])
                except BudgetExceeded:
                    pass  # corrupt ledger: the headroom stays held
            return None
        session = CallSession(call_sid, source=source)
        # The TwiML <Say> already spoke the disclosure: mark it played so
        # the dialogue does not repeat it in-stream. The revision pinned
        # here is verified against the registry at voice-webhook time.
        # (Do NOT call dialogue.start() here — that would return the
        # disclosure speak a second time.)
        from .policy.disclosure import current_revision
        revision = current_revision()
        session.dialogue.mark_twiml_disclosure_played(revision["id"])
        try:
            pipeline = self.server.make_pipeline(call_sid, source=source,
                                                 dialogue=session.dialogue)
        except (ProviderError, PipelineClosed):
            if reservation is not None:
                self.server.cost_ledger.release_reservation(reservation["id"])
            return None
        sender = AudioSender(conn, event["stream_sid"])
        sender.start()
        live = {"session": session, "pipeline": pipeline, "sender": sender,
                "stream_sid": event["stream_sid"], "source": source,
                "session_reservation_id": reservation["id"],
                # Minutes of duration headroom held so far (fix round 3,
                # P1): 1 at admission, extended one minute at a time by
                # _duration_budget_check as the call elapses.
                "reserved_minutes": 1,
                # Serializes _duration_budget_check between the media
                # loop and the watchdog thread (fix round 4, P1): both
                # may fire at the same deadline, and without the lock
                # both could reserve the same next minute — or one
                # could fail the call closed on a minute the other
                # had just reserved.
                "budget_lock": threading.Lock()}
        self.server.live_sessions[call_sid] = live
        return live

    def _next_budget_deadline(self, live: dict) -> float:
        """Wall-clock time by which the budget must next be enforced:
        the earlier of the next minute's reserve deadline (one margin
        before the currently covered interval ends, so the next minute
        is reserved BEFORE its billable interval starts) and the
        absolute duration cap."""
        session = live["session"]
        reserved = live.get("reserved_minutes", 1)
        reserve_deadline = (session.started_at + reserved * 60
                            - RESERVE_MARGIN_S)
        cap_deadline = (session.started_at
                        + self.server.config.max_call_duration_s)
        return min(reserve_deadline, cap_deadline)

    def _duration_budget_check(self, live: dict, call_sid: str) -> str | None:
        """Enforce the call's duration budget (fix round 3, P1;
        deadline-enforced in fix round 4).

        Returns None while the call may continue, or a reason string
        when the session must end NOW, before the next billable
        interval accrues. Runs on every media-loop iteration, on the
        read deadline, and in the watchdog thread — independent of
        turns and of incoming frames: Twilio streams audio frames even
        while the caller is silent, so a quiet call is checked just as
        often as a talkative one, and a call with no frames at all is
        checked by the deadline paths instead.

        The rule: the call may only accrue billable minutes it has
        already reserved. At admission one blended minute is held; at
        each further minute boundary one more is claimed atomically
        (purpose "session", same as the admission minute), so the
        headroom grows with the elapsed time and a concurrent call
        cannot spend it first. The next minute is claimed
        RESERVE_MARGIN_S BEFORE its interval starts, so scheduling
        and network delays can never push the reservation past the
        boundary. A failed extension means the per-call or campaign
        ceiling cannot fund the next minute: the call ends instead of
        accruing unreserved duration. The absolute max_call_duration_s
        cap ends the call even with headroom to spare.

        Serialized on the session's budget_lock: the loop and the
        watchdog may both fire at the same deadline, and without the
        lock both could reserve the same next minute — or one could
        fail the call closed on a minute the other had just reserved.

        Coverage: a held minute is priced at the blended $0.04 while
        the final record prices duration at the component rates
        (~$0.0206/min), so reserved headroom always exceeds the final
        duration charge — the final can never convert unreserved
        duration into an over-ceiling charge. Turn provider spend is
        separately guarded by per-turn reservations (unchanged).
        Crash/restart: extension reservations are purpose "session"
        with the 3600 s TTL, so a dead worker's unspent headroom
        settles as assumed spend (fix round 2), never silently
        restored."""
        lock = live.get("budget_lock")
        if lock is None:
            lock = live["budget_lock"] = threading.Lock()
        with lock:
            session = live["session"]
            elapsed_s = time.time() - session.started_at
            if elapsed_s >= self.server.config.max_call_duration_s:
                return "max_call_duration_reached"
            # Look one margin ahead: the next minute is reserved
            # BEFORE its interval starts, not after it has begun.
            minutes_needed = int((elapsed_s + RESERVE_MARGIN_S) // 60) + 1
            reserved = live.get("reserved_minutes", 1)
            while reserved < minutes_needed:
                try:
                    self.server.cost_ledger.reserve(
                        call_sid=call_sid, source=live["source"],
                        purpose="session",
                        projected_usd=blended_minute_usd(
                            self.server.config.cost_rate_version),
                        max_per_call_usd=self.server.config.max_cost_per_call_usd,
                        max_campaign_usd=self.server.config.max_cost_campaign_usd)
                except BudgetExceeded:
                    return "duration_budget_exhausted"
                reserved += 1
            live["reserved_minutes"] = reserved
            return None

    def _flush_turn(self, conn: socket.socket, call_sid: str, audio: bytes,
                    sender: AudioSender | None) -> None:
        """Run one pipeline turn and stream the reply audio back."""
        live = self.server.live_sessions.get(call_sid)
        if live is None or sender is None:
            return
        try:
            result = live["pipeline"].handle_audio(audio)
        except PipelineClosed:
            # Guard tripped mid-call: end the session; Twilio's number
            # fallback (human voicemail/forwarding) takes the next call.
            self.server.end_live_session(call_sid, "pipeline_closed")
            return
        except ProviderError:
            # Provider failure on a turn: safe clarify prompt, no invented
            # slot. The dialogue's STT-failure path asks the caller to
            # repeat; the turn is NOT retried against the provider.
            result = live["pipeline"].safe_clarify()
            if not result.get("audio"):
                return
        if result.get("audio"):
            sender.send(result["audio"])
        if result.get("emergency"):
            # Emergency detected on this turn: dispatch immediately (the
            # dispatcher, not the call flow, owns the alert timeline).
            self.server.dispatch_emergency_for_session(call_sid)
