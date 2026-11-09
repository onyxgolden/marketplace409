"""Go-live §2: Media Streams gateway — stdlib WebSocket, token + mode
gates, sequence tracking, barge-in, reconnect-resume, safe close.

The gateway test drives a real TCP socket against the gateway in-process
(no Twilio, no network): handshake, start/media/stop frames, and the
refusal paths (bad token, OFF mode). A stub server stands in for
ReceptionistServer.
"""
import base64
import json
import os
import socket
import struct
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.config import ReceptionistConfig
from app.cost import BudgetExceeded, CostLedger
from app.kill_switch import KillSwitch
from app.latency import LatencyRecorder
from app.media_stream import MediaStreamGateway, _ws_accept, read_frame, write_frame
from app.pipeline import CallPipeline
from app.policy.dialogue import CallDialogue
from app.providers import FakeLLM, FakeSTT, FakeTTS
from app.session import CallSession, canonical_source
from app.telephony_twilio import (
    MediaSequenceTracker, parse_media_event, sign_stream_token)


# --- frame helpers (client side: masked frames) ------------------------------

def client_frame(opcode: int, payload: bytes) -> bytes:
    mask = b"\x01\x02\x03\x04"
    header = bytes([0x80 | opcode, 0x80 | (len(payload) if len(payload) < 126 else 126)])
    if len(payload) >= 126:
        header = bytes([0x80 | opcode, 0x80 | 126]) + struct.pack(">H", len(payload))
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return header + mask + masked


def client_text(obj: dict) -> bytes:
    return client_frame(1, json.dumps(obj).encode())


class _StubServer:
    """Minimal ReceptionistServer stand-in for gateway tests."""

    def __init__(self, tmp, *, mode="TEST_ONLY", campaign=10.0,
                 per_call=0.50):
        self.config = ReceptionistConfig(
            cost_ledger_path=os.path.join(tmp, "ledger.json"),
            kill_switch_path=os.path.join(tmp, "kill.json"),
            stream_token_secret="stream-secret",
            max_cost_campaign_usd=campaign,
            max_cost_per_call_usd=per_call)
        self.kill_switch = KillSwitch(self.config.kill_switch_path)
        self.cost_ledger = CostLedger(self.config.cost_ledger_path)
        self.latency_recorder = LatencyRecorder(os.path.join(tmp, "latency.jsonl"))
        self.live_sessions: dict = {}
        self.ended: list = []
        self.payloads: dict = {}
        self.mode = mode
        self.pipelines: dict = {}

    def activation_state(self):
        return {"mode": self.mode, "valid": self.mode != "OFF",
                "reason": self.mode, "record": None}

    def make_pipeline(self, call_sid, *, source, dialogue):
        pipe = CallPipeline(
            stt=FakeSTT(script={b"\x00" * 160: "my sink is leaking"}),
            llm=FakeLLM(), tts=FakeTTS(), dialogue=dialogue,
            config=self.config, cost_ledger=self.cost_ledger,
            latency_recorder=self.latency_recorder,
            kill_switch=self.kill_switch, activation_mode=self.mode,
            source=source, call_sid=call_sid)
        self.pipelines[call_sid] = pipe
        return pipe

    def end_live_session(self, call_sid, reason="completed"):
        if call_sid not in self.live_sessions:
            return None
        live = self.live_sessions.pop(call_sid)
        self.ended.append((call_sid, reason))
        payload = live["session"].ingest_payload()
        self.payloads[call_sid] = payload
        return payload


def _open_stream(port, call_sid, stream_sid, token):
    """Handshake + start frame; returns the connected socket."""
    sock = socket.create_connection(("127.0.0.1", port), timeout=5)
    sock.sendall(
        b"GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\n"
        b"Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
        b"Sec-WebSocket-Version: 13\r\n\r\n")
    head = sock.recv(1024)
    assert b"101 Switching Protocols" in head
    sock.sendall(client_text({
        "event": "start", "streamSid": stream_sid,
        "start": {"streamSid": stream_sid, "callSid": call_sid,
                  "customParameters": {"token": token}}}))
    return sock


class TestMediaEventParsing(unittest.TestCase):
    def test_parse_start_media_stop(self):
        start = parse_media_event(json.dumps({
            "event": "start", "streamSid": "MZ1",
            "start": {"streamSid": "MZ1", "callSid": "CA-1",
                      "customParameters": {"token": "tok"}}}))
        self.assertEqual(start["event"], "start")
        self.assertEqual(start["call_sid"], "CA-1")
        self.assertEqual(start["custom_parameters"], {"token": "tok"})
        media = parse_media_event(json.dumps({
            "event": "media", "streamSid": "MZ1",
            "media": {"callSid": "CA-1", "sequenceNumber": "7",
                      "timestamp": "123", "payload": "AAAA"}}))
        self.assertEqual(media["sequence_number"], 7)
        stop = parse_media_event(json.dumps(
            {"event": "stop", "stop": {"callSid": "CA-1"}}))
        self.assertEqual(stop["event"], "stop")

    def test_malformed_events_raise(self):
        for bad in ('not json', '{"event": "explode"}', '{"event": "start", "start": {}}',
                    '{"event": "media", "media": {}}'):
            with self.assertRaises(ValueError, msg=bad):
                parse_media_event(bad)

    def test_sequence_tracker_counts_gaps(self):
        tracker = MediaSequenceTracker()
        tracker.observe(sequence_number=1, timestamp=0)
        tracker.observe(sequence_number=2, timestamp=20)
        out = tracker.observe(sequence_number=5, timestamp=40)
        self.assertTrue(out["gap"])
        self.assertEqual(tracker.gaps, 1)
        self.assertEqual(tracker.frames, 3)
        out = tracker.observe(sequence_number=6, timestamp=10)  # non-monotonic
        self.assertTrue(out["gap"])
        self.assertEqual(tracker.gaps, 2)


class TestGatewayHandshake(unittest.TestCase):
    def test_ws_accept_vector(self):
        # RFC 6455 §1.3 example.
        self.assertEqual(_ws_accept("dGhlIHNhbXBsZSBub25jZQ=="),
                         "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")

    def test_gateway_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            server = _StubServer(tmp)
            gateway = MediaStreamGateway(server, host="127.0.0.1", port=0)
            gateway.start()
            try:
                port = gateway._sock.getsockname()[1]
                sock = socket.create_connection(("127.0.0.1", port), timeout=5)
                sock.sendall(
                    b"GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\n"
                    b"Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
                    b"Sec-WebSocket-Version: 13\r\n\r\n")
                head = sock.recv(1024)
                self.assertIn(b"101 Switching Protocols", head)
                self.assertIn(b"s3pPLMBiTxaQ9kYGzzhZRbK+xOo=", head)
                # A valid start event creates the live session.
                token = sign_stream_token("stream-secret", "CA-gw-1", "brandy-rental-office")
                sock.sendall(client_text({
                    "event": "start", "streamSid": "MZ-gw-1",
                    "start": {"streamSid": "MZ-gw-1", "callSid": "CA-gw-1",
                              "customParameters": {"token": token}}}))
                time.sleep(0.5)
                self.assertIn("CA-gw-1", server.live_sessions)
                # 60 media frames (~1.2 s) flush a turn through the pipeline.
                for seq in range(1, 61):
                    sock.sendall(client_text({
                        "event": "media", "streamSid": "MZ-gw-1",
                        "media": {"callSid": "CA-gw-1", "sequenceNumber": str(seq),
                                  "timestamp": str(seq * 20),
                                  "payload": base64.b64encode(b"\x00" * 160).decode()}}))
                time.sleep(1.0)
                pipe = server.pipelines["CA-gw-1"]
                self.assertGreaterEqual(pipe.turns, 1)
                # Stop ends the session with the twilio_stop reason.
                sock.sendall(client_text({
                    "event": "stop", "stop": {"callSid": "CA-gw-1"}}))
                time.sleep(0.5)
                self.assertIn(("CA-gw-1", "twilio_stop"), server.ended)
                self.assertNotIn("CA-gw-1", server.live_sessions)
                sock.close()
            finally:
                gateway.stop()

    def test_bad_token_refuses_without_a_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            server = _StubServer(tmp)
            gateway = MediaStreamGateway(server, host="127.0.0.1", port=0)
            gateway.start()
            try:
                port = gateway._sock.getsockname()[1]
                sock = socket.create_connection(("127.0.0.1", port), timeout=5)
                sock.sendall(
                    b"GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\n"
                    b"Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n")
                sock.recv(1024)
                sock.sendall(client_text({
                    "event": "start", "streamSid": "MZ-bad",
                    "start": {"streamSid": "MZ-bad", "callSid": "CA-bad",
                              "customParameters": {"token": "forged"}}}))
                time.sleep(0.5)
                self.assertNotIn("CA-bad", server.live_sessions)
                self.assertEqual(server.ended, [])
                sock.close()
            finally:
                gateway.stop()

    def test_off_mode_refuses_without_a_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            server = _StubServer(tmp, mode="OFF")
            gateway = MediaStreamGateway(server, host="127.0.0.1", port=0)
            gateway.start()
            try:
                port = gateway._sock.getsockname()[1]
                sock = socket.create_connection(("127.0.0.1", port), timeout=5)
                sock.sendall(
                    b"GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\n"
                    b"Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n")
                sock.recv(1024)
                token = sign_stream_token("stream-secret", "CA-off-1", "brandy-rental-office")
                sock.sendall(client_text({
                    "event": "start", "streamSid": "MZ-off",
                    "start": {"streamSid": "MZ-off", "callSid": "CA-off-1",
                              "customParameters": {"token": token}}}))
                time.sleep(0.5)
                self.assertNotIn("CA-off-1", server.live_sessions)
                sock.close()
            finally:
                gateway.stop()

    def test_dropped_stream_ends_incomplete(self):
        with tempfile.TemporaryDirectory() as tmp:
            server = _StubServer(tmp)
            gateway = MediaStreamGateway(server, host="127.0.0.1", port=0)
            gateway.start()
            try:
                port = gateway._sock.getsockname()[1]
                sock = socket.create_connection(("127.0.0.1", port), timeout=5)
                sock.sendall(
                    b"GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\n"
                    b"Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n")
                sock.recv(1024)
                token = sign_stream_token("stream-secret", "CA-drop-1", "brandy-rental-office")
                sock.sendall(client_text({
                    "event": "start", "streamSid": "MZ-drop",
                    "start": {"streamSid": "MZ-drop", "callSid": "CA-drop-1",
                              "customParameters": {"token": token}}}))
                time.sleep(0.3)
                self.assertIn("CA-drop-1", server.live_sessions)
                sock.close()  # drop without stop
                time.sleep(0.5)
                self.assertIn(("CA-drop-1", "stream_dropped"), server.ended)
            finally:
                gateway.stop()


class TestCanonicalSource(unittest.TestCase):
    """Fix round 1, P1-1: activation modes are NOT call sources. The
    gateway maps TEST_ONLY -> TEST and LIVE_APPROVED -> LIVE at the
    boundary, so a rehearsal call's ingest payload carries TEST — the
    ingest route and the DB CHECK accept only TEST | LIVE | SYNTHETIC,
    and the inbox badge renders the payload's source verbatim."""

    def test_mapping(self):
        self.assertEqual(canonical_source("TEST_ONLY"), "TEST")
        self.assertEqual(canonical_source("LIVE_APPROVED"), "LIVE")
        with self.assertRaises(ValueError):
            canonical_source("OFF")
        with self.assertRaises(ValueError):
            canonical_source("BOGUS")

    def test_session_rejects_raw_mode_values(self):
        for bad in ("TEST_ONLY", "LIVE_APPROVED", "OFF", "BOGUS"):
            with self.assertRaises(ValueError, msg=bad):
                CallSession("CA-bad", source=bad)
        self.assertEqual(CallSession("CA-ok", source="TEST").source, "TEST")

    def test_test_only_start_labels_the_session_test(self):
        with tempfile.TemporaryDirectory() as tmp:
            server = _StubServer(tmp, mode="TEST_ONLY")
            gateway = MediaStreamGateway(server, host="127.0.0.1", port=0)
            gateway.start()
            try:
                port = gateway._sock.getsockname()[1]
                token = sign_stream_token("stream-secret", "CA-src-1", "brandy-rental-office")
                sock = _open_stream(port, "CA-src-1", "MZ-src-1", token)
                time.sleep(0.5)
                live = server.live_sessions["CA-src-1"]
                self.assertEqual(live["source"], "TEST")
                self.assertEqual(live["session"].source, "TEST")
                self.assertEqual(server.pipelines["CA-src-1"].source, "TEST")
                # Stop: the completed ingest payload carries TEST, so the
                # ingest route accepts it, the DB CHECK admits it, and
                # the inbox badge renders it as a test call.
                sock.sendall(client_text({
                    "event": "stop", "stop": {"callSid": "CA-src-1"}}))
                time.sleep(0.5)
                payload = server.payloads["CA-src-1"]
                self.assertEqual(payload["source"], "TEST")
                self.assertIn(payload["source"], ("TEST", "LIVE", "SYNTHETIC"))
                sock.close()
            finally:
                gateway.stop()

    def test_live_approved_start_labels_the_session_live(self):
        with tempfile.TemporaryDirectory() as tmp:
            server = _StubServer(tmp, mode="LIVE_APPROVED")
            gateway = MediaStreamGateway(server, host="127.0.0.1", port=0)
            gateway.start()
            try:
                port = gateway._sock.getsockname()[1]
                token = sign_stream_token("stream-secret", "CA-src-2", "brandy-rental-office")
                sock = _open_stream(port, "CA-src-2", "MZ-src-2", token)
                time.sleep(0.5)
                self.assertEqual(server.live_sessions["CA-src-2"]["source"], "LIVE")
                self.assertEqual(server.live_sessions["CA-src-2"]["session"].source, "LIVE")
                sock.close()
            finally:
                gateway.stop()

    def test_reconnect_resumes_with_the_canonical_source(self):
        # A clean WebSocket close (no `stop` frame) leaves the live
        # session in place; a reconnect with the same call SID + a fresh
        # token resumes the SAME session object — no duplicate pipeline,
        # no second budget reservation — still labeled TEST.
        with tempfile.TemporaryDirectory() as tmp:
            server = _StubServer(tmp, mode="TEST_ONLY")
            gateway = MediaStreamGateway(server, host="127.0.0.1", port=0)
            gateway.start()
            try:
                port = gateway._sock.getsockname()[1]
                token = sign_stream_token("stream-secret", "CA-src-3", "brandy-rental-office")
                sock = _open_stream(port, "CA-src-3", "MZ-src-3", token)
                time.sleep(0.3)
                first_session = server.live_sessions["CA-src-3"]["session"]
                first_pipeline = server.pipelines["CA-src-3"]
                # Clean close frame: the gateway breaks the read loop
                # WITHOUT ending the session (no `stop` arrived).
                sock.sendall(client_frame(8, b""))
                sock.close()
                time.sleep(0.5)
                self.assertEqual(server.ended, [])
                self.assertIn("CA-src-3", server.live_sessions)
                # Reconnect with a fresh token: the EXISTING session
                # resumes, still labeled TEST.
                token2 = sign_stream_token("stream-secret", "CA-src-3", "brandy-rental-office")
                sock2 = _open_stream(port, "CA-src-3", "MZ-src-3b", token2)
                time.sleep(0.3)
                live = server.live_sessions["CA-src-3"]
                self.assertIs(live["session"], first_session)
                self.assertIs(server.pipelines["CA-src-3"], first_pipeline)
                self.assertEqual(live["source"], "TEST")
                self.assertEqual(live["session"].source, "TEST")
                sock2.close()
            finally:
                gateway.stop()

    def test_budget_exhausted_session_refused_before_pipeline(self):
        # Fix round 1, P1-3: with the campaign spent, the gateway
        # refuses the session BEFORE any provider pipeline is created —
        # no chargeable session, no phantom record.
        with tempfile.TemporaryDirectory() as tmp:
            server = _StubServer(tmp, mode="TEST_ONLY", campaign=0.05)
            server.cost_ledger.record_call(
                call_sid="CA-spent", source="TEST", duration_s=1500,
                agent_chars=6000)  # ~$0.75: the $0.05 campaign is spent
            gateway = MediaStreamGateway(server, host="127.0.0.1", port=0)
            gateway.start()
            try:
                port = gateway._sock.getsockname()[1]
                token = sign_stream_token("stream-secret", "CA-src-4", "brandy-rental-office")
                sock = _open_stream(port, "CA-src-4", "MZ-src-4", token)
                time.sleep(0.5)
                self.assertNotIn("CA-src-4", server.live_sessions)
                self.assertNotIn("CA-src-4", server.pipelines)
                self.assertEqual(server.ended, [])
                sock.close()
            finally:
                gateway.stop()


class TestSessionReservationAtGateway(unittest.TestCase):
    """Fix round 2, P1: the gateway's session reservation must survive
    a turn (the old code dropped it on the first turn's settlement,
    freeing the campaign headroom for a concurrent call)."""

    def test_session_reservation_survives_turn_and_blocks_second_call(self):
        with tempfile.TemporaryDirectory() as tmp:
            # Campaign of exactly two minutes: call A takes one as its
            # session reservation; its turn takes the other as a turn
            # reservation and settles it into a small actual.
            server = _StubServer(tmp, mode="TEST_ONLY", campaign=0.08)
            gateway = MediaStreamGateway(server, host="127.0.0.1", port=0)
            gateway.start()
            try:
                port = gateway._sock.getsockname()[1]
                token_a = sign_stream_token("stream-secret",
                                            "CA-gw-A", "brandy-rental-office")
                sock_a = _open_stream(port, "CA-gw-A", "MZ-gw-A", token_a)
                time.sleep(0.5)
                self.assertIn("CA-gw-A", server.live_sessions)
                for seq in range(1, 61):
                    sock_a.sendall(client_text({
                        "event": "media", "streamSid": "MZ-gw-A",
                        "media": {"callSid": "CA-gw-A",
                                  "sequenceNumber": str(seq),
                                  "timestamp": str(seq * 20),
                                  "payload": base64.b64encode(
                                      b"\x00" * 160).decode()}}))
                time.sleep(1.0)
                pipe = server.pipelines["CA-gw-A"]
                self.assertGreaterEqual(pipe.turns, 1)
                # A completed a turn and is still connected: its
                # session reservation must still be held.
                held = [e for e in server.cost_ledger.entries()
                        if e.get("kind") == "reservation"
                        and e.get("call_sid") == "CA-gw-A"]
                self.assertEqual(len(held), 1)
                self.assertEqual(held[0]["purpose"], "session")
                # Call B cannot start: no minute of headroom is left.
                token_b = sign_stream_token("stream-secret",
                                            "CA-gw-B", "brandy-rental-office")
                sock_b = _open_stream(port, "CA-gw-B", "MZ-gw-B", token_b)
                time.sleep(0.5)
                self.assertNotIn("CA-gw-B", server.live_sessions)
                self.assertNotIn("CA-gw-B", server.pipelines)
                sock_b.close()
                sock_a.close()
            finally:
                gateway.stop()


class TestDurationBudgetExtension(unittest.TestCase):
    """Fix round 3, P1: a live call's duration headroom must grow with
    its elapsed billable time — one blended minute reserved per minute,
    in the media loop, independent of turns. A silent call cannot
    accrue unreserved minutes, and the final record can never convert
    unreserved duration into an over-ceiling charge. Elapsed time is
    simulated by backdating the session's started_at (the gateway
    measures elapsed time from it, exactly as the close path does)."""

    def _send_silence(self, sock, stream_sid, call_sid, seq=1):
        """One media frame of silence: no turn flushes (50 frames
        make a turn), so the call stays silent for budget purposes."""
        sock.sendall(client_text({
            "event": "media", "streamSid": stream_sid,
            "media": {"callSid": call_sid, "sequenceNumber": str(seq),
                      "timestamp": str(seq * 20),
                      "payload": base64.b64encode(b"\x00" * 160).decode()}}))

    def test_silent_call_ends_when_campaign_covers_only_one_minute(self):
        # The verdict's regression (1): campaign ceiling sufficient
        # for exactly one minute. The call must end at the second
        # minute boundary, before minute 2 accrues.
        with tempfile.TemporaryDirectory() as tmp:
            server = _StubServer(tmp, mode="TEST_ONLY", campaign=0.04)
            gateway = MediaStreamGateway(server, host="127.0.0.1", port=0)
            gateway.start()
            try:
                port = gateway._sock.getsockname()[1]
                token = sign_stream_token("stream-secret", "CA-dur-1",
                                          "brandy-rental-office")
                sock = _open_stream(port, "CA-dur-1", "MZ-dur-1", token)
                time.sleep(0.5)
                self.assertIn("CA-dur-1", server.live_sessions)
                live = server.live_sessions["CA-dur-1"]
                self.assertEqual(live["reserved_minutes"], 1)
                live["session"].started_at = time.time() - 61
                self._send_silence(sock, "MZ-dur-1", "CA-dur-1")
                time.sleep(0.5)
                self.assertIn(("CA-dur-1", "duration_budget_exhausted"),
                              server.ended)
                self.assertNotIn("CA-dur-1", server.live_sessions)
                # Nothing past the one reserved minute was ever held.
                self.assertAlmostEqual(server.cost_ledger.total_usd(), 0.04)
                held = [e for e in server.cost_ledger.entries()
                        if e.get("kind") == "reservation"]
                self.assertEqual(len(held), 1)
                self.assertEqual(held[0]["purpose"], "session")
                sock.close()
            finally:
                gateway.stop()

    def test_two_concurrent_calls_near_limit_neither_exceeds_ceiling(self):
        # The verdict's regression (2): campaign of exactly two
        # minutes, two live calls. Neither may accrue a second minute.
        with tempfile.TemporaryDirectory() as tmp:
            server = _StubServer(tmp, mode="TEST_ONLY", campaign=0.08)
            gateway = MediaStreamGateway(server, host="127.0.0.1", port=0)
            gateway.start()
            try:
                port = gateway._sock.getsockname()[1]
                socks = []
                for cid, sid in (("CA-dur-A", "MZ-dur-A"),
                                 ("CA-dur-B", "MZ-dur-B")):
                    token = sign_stream_token("stream-secret", cid,
                                              "brandy-rental-office")
                    socks.append(_open_stream(port, cid, sid, token))
                time.sleep(0.5)
                self.assertIn("CA-dur-A", server.live_sessions)
                self.assertIn("CA-dur-B", server.live_sessions)
                for cid in ("CA-dur-A", "CA-dur-B"):
                    server.live_sessions[cid]["session"].started_at = \
                        time.time() - 61
                self._send_silence(socks[0], "MZ-dur-A", "CA-dur-A")
                self._send_silence(socks[1], "MZ-dur-B", "CA-dur-B")
                time.sleep(0.5)
                self.assertIn(("CA-dur-A", "duration_budget_exhausted"),
                              server.ended)
                self.assertIn(("CA-dur-B", "duration_budget_exhausted"),
                              server.ended)
                self.assertAlmostEqual(server.cost_ledger.total_usd(), 0.08)
                for cid in ("CA-dur-A", "CA-dur-B"):
                    self.assertLessEqual(
                        server.cost_ledger.call_total_usd(cid), 0.50)
                for sock in socks:
                    sock.close()
            finally:
                gateway.stop()

    def test_extension_reserves_each_further_minute_while_headroom_remains(self):
        with tempfile.TemporaryDirectory() as tmp:
            server = _StubServer(tmp, mode="TEST_ONLY", campaign=10.0)
            gateway = MediaStreamGateway(server, host="127.0.0.1", port=0)
            gateway.start()
            try:
                port = gateway._sock.getsockname()[1]
                token = sign_stream_token("stream-secret", "CA-dur-2",
                                          "brandy-rental-office")
                sock = _open_stream(port, "CA-dur-2", "MZ-dur-2", token)
                time.sleep(0.5)
                live = server.live_sessions["CA-dur-2"]
                self.assertEqual(live["reserved_minutes"], 1)
                for elapsed, minutes in ((61, 2), (121, 3), (181, 4)):
                    live["session"].started_at = time.time() - elapsed
                    self._send_silence(sock, "MZ-dur-2", "CA-dur-2",
                                       seq=elapsed)
                    time.sleep(0.3)
                    self.assertIn("CA-dur-2", server.live_sessions)
                    self.assertEqual(live["reserved_minutes"], minutes)
                self.assertAlmostEqual(server.cost_ledger.total_usd(), 0.16)
                # Normal close still works after extensions.
                sock.sendall(client_text(
                    {"event": "stop", "stop": {"callSid": "CA-dur-2"}}))
                time.sleep(0.5)
                self.assertIn(("CA-dur-2", "twilio_stop"), server.ended)
                sock.close()
            finally:
                gateway.stop()

    def test_admission_refuses_when_no_turn_headroom(self):
        # Per-call ceiling $0.05: the session minute ($0.04) fits, but
        # one more minute for a turn does not — the call is refused at
        # admission instead of being admitted unable to take a turn,
        # and the refused session minute is released, not held.
        with tempfile.TemporaryDirectory() as tmp:
            server = _StubServer(tmp, mode="TEST_ONLY", campaign=10.0,
                                 per_call=0.05)
            gateway = MediaStreamGateway(server, host="127.0.0.1", port=0)
            gateway.start()
            try:
                port = gateway._sock.getsockname()[1]
                token = sign_stream_token("stream-secret", "CA-dur-3",
                                          "brandy-rental-office")
                sock = _open_stream(port, "CA-dur-3", "MZ-dur-3", token)
                time.sleep(0.5)
                self.assertNotIn("CA-dur-3", server.live_sessions)
                self.assertNotIn("CA-dur-3", server.pipelines)
                self.assertEqual(server.cost_ledger.entries(), [])
                sock.close()
            finally:
                gateway.stop()

    def test_max_call_duration_cap_ends_call_with_headroom(self):
        with tempfile.TemporaryDirectory() as tmp:
            server = _StubServer(tmp, mode="TEST_ONLY", campaign=10.0)
            gateway = MediaStreamGateway(server, host="127.0.0.1", port=0)
            gateway.start()
            try:
                port = gateway._sock.getsockname()[1]
                token = sign_stream_token("stream-secret", "CA-dur-4",
                                          "brandy-rental-office")
                sock = _open_stream(port, "CA-dur-4", "MZ-dur-4", token)
                time.sleep(0.5)
                live = server.live_sessions["CA-dur-4"]
                live["session"].started_at = time.time() - 1801
                self._send_silence(sock, "MZ-dur-4", "CA-dur-4")
                time.sleep(0.5)
                self.assertIn(("CA-dur-4", "max_call_duration_reached"),
                              server.ended)
                self.assertNotIn("CA-dur-4", server.live_sessions)
                sock.close()
            finally:
                gateway.stop()


class TestDurationDeadlineEnforcement(unittest.TestCase):
    """Fix round 4, P1: the duration budget must be enforced on a
    deadline independent of incoming media events. The fix-round-3
    check runs only after a successfully read frame, so a silent
    socket, a stalled partial frame, or a long provider turn can let
    a call sit past a paid minute boundary without securing the next
    minute. These regressions drive the gateway with NO further
    frames (or a stalled partial frame) after backdating the
    session's started_at, and require the call to end — or the next
    minute to be reserved — on the deadline, not on the next frame."""

    @staticmethod
    def _wait_until(predicate, timeout_s, interval_s=0.1):
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if predicate():
                return True
            time.sleep(interval_s)
        return predicate()

    def _send_silence(self, sock, stream_sid, call_sid, seq=1):
        sock.sendall(client_text({
            "event": "media", "streamSid": stream_sid,
            "media": {"callSid": call_sid, "sequenceNumber": str(seq),
                      "timestamp": str(seq * 20),
                      "payload": base64.b64encode(b"\x00" * 160).decode()}}))

    def test_no_frames_call_ends_at_one_minute_boundary(self):
        # The verdict's socket/no-frame regression: campaign covers
        # exactly one minute; after start the socket stays open but
        # sends nothing. The call must end (duration_budget_exhausted)
        # before uncovered time accrues — enforcement cannot wait for
        # the next media event.
        with tempfile.TemporaryDirectory() as tmp:
            server = _StubServer(tmp, mode="TEST_ONLY", campaign=0.04)
            gateway = MediaStreamGateway(server, host="127.0.0.1", port=0)
            gateway.start()
            try:
                port = gateway._sock.getsockname()[1]
                token = sign_stream_token("stream-secret", "CA-dl-1",
                                          "brandy-rental-office")
                sock = _open_stream(port, "CA-dl-1", "MZ-dl-1", token)
                time.sleep(0.5)
                self.assertIn("CA-dl-1", server.live_sessions)
                server.live_sessions["CA-dl-1"]["session"].started_at = \
                    time.time() - 61
                ended = self._wait_until(
                    lambda: ("CA-dl-1", "duration_budget_exhausted")
                    in server.ended, timeout_s=15)
                self.assertTrue(
                    ended, "idle call was not ended at the minute boundary")
                self.assertNotIn("CA-dl-1", server.live_sessions)
                self.assertAlmostEqual(server.cost_ledger.total_usd(), 0.04)
                sock.close()
            finally:
                gateway.stop()

    def test_partial_frame_stall_ends_when_budget_exhausted(self):
        # A truncated media frame: the gateway holds the first bytes
        # but no complete frame. The budget must still be enforced on
        # the deadline — a stalled partial frame is not a free minute.
        with tempfile.TemporaryDirectory() as tmp:
            server = _StubServer(tmp, mode="TEST_ONLY", campaign=0.04)
            gateway = MediaStreamGateway(server, host="127.0.0.1", port=0)
            gateway.start()
            try:
                port = gateway._sock.getsockname()[1]
                token = sign_stream_token("stream-secret", "CA-dl-2",
                                          "brandy-rental-office")
                sock = _open_stream(port, "CA-dl-2", "MZ-dl-2", token)
                time.sleep(0.5)
                self.assertIn("CA-dl-2", server.live_sessions)
                frame = client_text({
                    "event": "media", "streamSid": "MZ-dl-2",
                    "media": {"callSid": "CA-dl-2", "sequenceNumber": "1",
                              "timestamp": "20",
                              "payload": base64.b64encode(
                                  b"\x00" * 160).decode()}})
                sock.sendall(frame[:5])
                server.live_sessions["CA-dl-2"]["session"].started_at = \
                    time.time() - 61
                ended = self._wait_until(
                    lambda: ("CA-dl-2", "duration_budget_exhausted")
                    in server.ended, timeout_s=15)
                self.assertTrue(
                    ended, "partial-frame stall was not ended at the boundary")
                self.assertNotIn("CA-dl-2", server.live_sessions)
                self.assertAlmostEqual(server.cost_ledger.total_usd(), 0.04)
                sock.close()
            finally:
                gateway.stop()

    def test_partial_frame_stall_reserves_and_stream_survives_with_headroom(self):
        # Same stall, but the campaign has headroom: the next minute
        # must be reserved on the deadline, and when the rest of the
        # stalled frame finally arrives it must parse as the same
        # media event — the buffered partial bytes are preserved, the
        # stream does not desync.
        with tempfile.TemporaryDirectory() as tmp:
            server = _StubServer(tmp, mode="TEST_ONLY", campaign=10.0)
            gateway = MediaStreamGateway(server, host="127.0.0.1", port=0)
            gateway.start()
            try:
                port = gateway._sock.getsockname()[1]
                token = sign_stream_token("stream-secret", "CA-dl-3",
                                          "brandy-rental-office")
                sock = _open_stream(port, "CA-dl-3", "MZ-dl-3", token)
                time.sleep(0.5)
                live = server.live_sessions["CA-dl-3"]
                self.assertEqual(live["reserved_minutes"], 1)
                frame = client_text({
                    "event": "media", "streamSid": "MZ-dl-3",
                    "media": {"callSid": "CA-dl-3", "sequenceNumber": "1",
                              "timestamp": "20",
                              "payload": base64.b64encode(
                                  b"\x00" * 160).decode()}})
                sock.sendall(frame[:5])
                live["session"].started_at = time.time() - 61
                reserved = self._wait_until(
                    lambda: live.get("reserved_minutes", 1) == 2,
                    timeout_s=15)
                self.assertTrue(
                    reserved, "next minute was not reserved during the stall")
                sock.sendall(frame[5:])
                time.sleep(0.5)
                self.assertIn("CA-dl-3", server.live_sessions)
                self.assertEqual(live["reserved_minutes"], 2)
                self.assertNotIn(("CA-dl-3", "stream_dropped"), server.ended)
                self._send_silence(sock, "MZ-dl-3", "CA-dl-3", seq=2)
                time.sleep(0.5)
                self.assertIn("CA-dl-3", server.live_sessions)
                sock.close()
            finally:
                gateway.stop()

    def test_two_idle_calls_near_limit_both_end_without_frames(self):
        # Concurrent-call variant of the no-frame regression: campaign
        # of exactly two minutes, two live calls, no frames from
        # either while waiting for I/O. Neither may accrue a second
        # minute, and neither may spend the other's headroom.
        with tempfile.TemporaryDirectory() as tmp:
            server = _StubServer(tmp, mode="TEST_ONLY", campaign=0.08)
            gateway = MediaStreamGateway(server, host="127.0.0.1", port=0)
            gateway.start()
            try:
                port = gateway._sock.getsockname()[1]
                socks = []
                for cid, sid in (("CA-dl-A", "MZ-dl-A"),
                                 ("CA-dl-B", "MZ-dl-B")):
                    token = sign_stream_token("stream-secret", cid,
                                              "brandy-rental-office")
                    socks.append(_open_stream(port, cid, sid, token))
                time.sleep(0.5)
                for cid in ("CA-dl-A", "CA-dl-B"):
                    server.live_sessions[cid]["session"].started_at = \
                        time.time() - 61
                for cid in ("CA-dl-A", "CA-dl-B"):
                    ended = self._wait_until(
                        lambda c=cid: (c, "duration_budget_exhausted")
                        in server.ended, timeout_s=15)
                    self.assertTrue(ended, f"{cid} was not ended while idle")
                self.assertAlmostEqual(server.cost_ledger.total_usd(), 0.08)
                for cid in ("CA-dl-A", "CA-dl-B"):
                    self.assertLessEqual(
                        server.cost_ledger.call_total_usd(cid), 0.50)
                for sock in socks:
                    sock.close()
            finally:
                gateway.stop()

    def test_long_provider_turn_does_not_block_budget_enforcement(self):
        # A provider turn that blocks the media-loop thread for
        # seconds must not suspend budget enforcement: the independent
        # watchdog ends the call on the deadline even while the turn
        # is still running.
        with tempfile.TemporaryDirectory() as tmp:
            server = _StubServer(tmp, mode="TEST_ONLY", campaign=0.04)
            gateway = MediaStreamGateway(server, host="127.0.0.1", port=0)
            gateway.start()
            try:
                port = gateway._sock.getsockname()[1]
                token = sign_stream_token("stream-secret", "CA-dl-5",
                                          "brandy-rental-office")
                sock = _open_stream(port, "CA-dl-5", "MZ-dl-5", token)
                time.sleep(0.5)
                pipe = server.pipelines["CA-dl-5"]
                orig_handle = pipe.handle_audio

                def slow_handle(audio):
                    time.sleep(8)  # a hung STT/LLM/TTS turn
                    return orig_handle(audio)

                pipe.handle_audio = slow_handle
                for seq in range(1, 61):
                    self._send_silence(sock, "MZ-dl-5", "CA-dl-5", seq=seq)
                time.sleep(0.3)  # let the turn start blocking
                server.live_sessions["CA-dl-5"]["session"].started_at = \
                    time.time() - 61
                ended = self._wait_until(
                    lambda: ("CA-dl-5", "duration_budget_exhausted")
                    in server.ended, timeout_s=15)
                self.assertTrue(
                    ended, "call was not ended while a turn blocked the loop")
                self.assertNotIn("CA-dl-5", server.live_sessions)
                self.assertAlmostEqual(server.cost_ledger.total_usd(), 0.04)
                sock.close()
            finally:
                gateway.stop()


if __name__ == "__main__":
    unittest.main()
