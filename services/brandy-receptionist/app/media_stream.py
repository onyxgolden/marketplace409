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
               pipeline turn -> paced audio back to Twilio
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


def _ws_accept(key: str) -> str:
    digest = hashlib.sha1((key + WS_GUID).encode()).digest()
    return base64.b64encode(digest).decode()


def _recv_exact(sock: socket.socket, n: int) -> bytes:
    data = b""
    while len(data) < n:
        chunk = sock.recv(n - len(data))
        if not chunk:
            raise ConnectionError("websocket peer closed")
        data += chunk
    return data


def read_frame(sock: socket.socket) -> dict | None:
    """Read one WebSocket frame. Returns {"opcode", "payload"} or None on
    a clean close frame. Raises on protocol errors / peer disconnect."""
    header = _recv_exact(sock, 2)
    b0, b1 = header[0], header[1]
    fin = bool(b0 & 0x80)
    opcode = b0 & 0x0F
    masked = bool(b1 & 0x80)
    length = b1 & 0x7F
    if length == 126:
        length = struct.unpack(">H", _recv_exact(sock, 2))[0]
    elif length == 127:
        length = struct.unpack(">Q", _recv_exact(sock, 8))[0]
    mask_key = _recv_exact(sock, 4) if masked else b""
    payload = _recv_exact(sock, length) if length else b""
    if masked:
        payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
    if not fin:
        raise ValueError("fragmented websocket frames are not supported")
    if opcode == 8:  # close
        return None
    if opcode == 9:  # ping -> caller replies with pong
        return {"opcode": 9, "payload": payload}
    if opcode == 10:  # pong -> ignore
        return {"opcode": 10, "payload": payload}
    return {"opcode": opcode, "payload": payload}


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
        try:
            conn.settimeout(30.0)
            key = self._handshake(conn)
            if key is None:
                conn.close()
                return
            tracker = MediaSequenceTracker()
            audio_buffer = bytearray()
            frames_since_flush = 0
            while True:
                frame = read_frame(conn)
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
        except (ConnectionError, OSError, ValueError):
            # Dropped stream without `stop`: end as INCOMPLETE (safe close).
            if call_sid is not None:
                self.server.end_live_session(call_sid, "stream_dropped")
        finally:
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
        # reservation is released if pipeline construction fails, and
        # settled into the actual call cost at session end.
        reservation = None
        try:
            reservation = self.server.cost_ledger.reserve(
                call_sid=call_sid, source=source,
                projected_usd=blended_minute_usd(
                    self.server.config.cost_rate_version),
                max_per_call_usd=self.server.config.max_cost_per_call_usd,
                max_campaign_usd=self.server.config.max_cost_campaign_usd)
        except BudgetExceeded:
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
                "stream_sid": event["stream_sid"], "source": source}
        self.server.live_sessions[call_sid] = live
        return live

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
