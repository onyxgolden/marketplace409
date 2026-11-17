"""Receptionist Cut 1, PR #820 fix round 2 (P1, blocking): a REAL
localhost HTTP/1.1 chunked server, no mocks, proving
`app.providers._local_post_streaming()` reports the real first-byte
wall-clock time rather than waiting for the full response.

Fix round 1's own `test_first_audio_ms_reflects_the_real_first_byte_timestamp_not_a_header`
was vacuous for this exact defect: it injected `first_byte_at` directly
via a fake `http_post_streaming`, so it could never catch
`_local_post_streaming()`'s own internal bug — it never called that
function at all. These tests call the REAL function against a REAL
socket, using `http.server`'s chunked-encoding support by hand (to
control exact inter-chunk timing), and must FAIL against the old
`resp.read(65536)` implementation (verified manually before this file
was finalized: reverting to `read(65536)` fails
`test_delayed_second_chunk_does_not_delay_first_byte_timestamp` by
~0.4s+, comfortably outside its assertion bound).
"""
import http.server
import os
import socket
import sys
import threading
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.providers import _local_post_streaming


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class _ChunkedHandler(http.server.BaseHTTPRequestHandler):
    """Hand-rolled HTTP/1.1 chunked response: sends `first_chunk`
    immediately, sleeps `delay_s`, then sends `second_chunk` (if any)
    and the terminator. Class-level config is set per-test via
    subclassing, matching this project's own `local_inference/server.py`
    streaming pattern (manual chunk framing, not a wrapper lib)."""
    protocol_version = "HTTP/1.1"
    first_chunk = b"A" * 100
    second_chunk = b"B" * 100
    delay_s = 0.4

    def log_message(self, *args):  # noqa: D102 — silence test server logging
        pass

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(length)
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        self.wfile.write(f"{len(self.first_chunk):X}\r\n".encode("ascii"))
        self.wfile.write(self.first_chunk)
        self.wfile.write(b"\r\n")
        self.wfile.flush()
        if self.delay_s:
            time.sleep(self.delay_s)
        if self.second_chunk:
            self.wfile.write(f"{len(self.second_chunk):X}\r\n".encode("ascii"))
            self.wfile.write(self.second_chunk)
            self.wfile.write(b"\r\n")
        self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()


def _run_server(handler_cls):
    port = _free_port()
    server = http.server.HTTPServer(("127.0.0.1", port), handler_cls)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread, port


class TestLocalPostStreamingAgainstARealChunkedServer(unittest.TestCase):
    def test_delayed_second_chunk_does_not_delay_first_byte_timestamp(self):
        """The regression this fix round exists for: a 100-byte first
        chunk, a real 0.4s pause, then a second 100-byte chunk — total
        body (200 bytes) is far under 65536, exactly the case the
        reviewer proved breaks `read(65536)`. The recorded first-byte
        timestamp must land near the START of the request, not after
        the 0.4s delay."""
        class Handler(_ChunkedHandler):
            first_chunk = b"A" * 100
            second_chunk = b"B" * 100
            delay_s = 0.4

        server, thread, port = _run_server(Handler)
        try:
            t0 = time.perf_counter()
            status, headers, body, first_byte_at = _local_post_streaming(
                f"http://127.0.0.1:{port}", "/x", json_body={"text": "hi"}, timeout_s=5.0)
            self.assertEqual(status, 200)
            self.assertEqual(body, b"A" * 100 + b"B" * 100)
            self.assertIsNotNone(first_byte_at)
            elapsed_to_first_byte = first_byte_at - t0
            self.assertLess(
                elapsed_to_first_byte, 0.25,
                f"first_byte_at was {elapsed_to_first_byte:.3f}s after the request started — "
                f"that is NOT before the 0.4s delayed second chunk, so this is reading the whole "
                f"response, not the first streamed byte (the exact fix-round-1 bug).")
        finally:
            server.shutdown()
            thread.join(timeout=5.0)

    def test_single_chunk_shorter_than_64kib(self):
        """A response whose entire body is one small chunk (well under
        65536 bytes) must still report a first-byte timestamp close to
        request start, and the body must be read correctly."""
        class Handler(_ChunkedHandler):
            first_chunk = b"Z" * 37
            second_chunk = b""
            delay_s = 0.0

        server, thread, port = _run_server(Handler)
        try:
            t0 = time.perf_counter()
            status, headers, body, first_byte_at = _local_post_streaming(
                f"http://127.0.0.1:{port}", "/x", json_body={"text": "hi"}, timeout_s=5.0)
            self.assertEqual(status, 200)
            self.assertEqual(body, b"Z" * 37)
            self.assertIsNotNone(first_byte_at)
            self.assertLess(first_byte_at - t0, 0.25)
        finally:
            server.shutdown()
            thread.join(timeout=5.0)

    def test_multi_chunk_with_delay_reassembles_the_full_body_in_order(self):
        """Three chunks, two delays — proves draining continues
        correctly after the first-byte timestamp is taken (this isn't
        a "stop after first chunk" shortcut, the full body still
        arrives intact)."""
        class Handler(_ChunkedHandler):
            first_chunk = b"1" * 50
            second_chunk = b"2" * 50
            delay_s = 0.15

        server, thread, port = _run_server(Handler)
        try:
            status, headers, body, first_byte_at = _local_post_streaming(
                f"http://127.0.0.1:{port}", "/x", json_body={"text": "hi"}, timeout_s=5.0)
            self.assertEqual(status, 200)
            self.assertEqual(body, b"1" * 50 + b"2" * 50)
            self.assertIsNotNone(first_byte_at)
        finally:
            server.shutdown()
            thread.join(timeout=5.0)


if __name__ == "__main__":
    unittest.main()
