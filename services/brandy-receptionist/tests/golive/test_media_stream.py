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

    def __init__(self, tmp, *, mode="TEST_ONLY", campaign=10.0):
        self.config = ReceptionistConfig(
            cost_ledger_path=os.path.join(tmp, "ledger.json"),
            kill_switch_path=os.path.join(tmp, "kill.json"),
            stream_token_secret="stream-secret",
            max_cost_campaign_usd=campaign)
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


if __name__ == "__main__":
    unittest.main()
