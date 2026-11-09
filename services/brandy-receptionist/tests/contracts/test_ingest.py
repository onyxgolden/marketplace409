"""§11.8/§11.12 ingestion contract: HMAC-signed body, timestamp + nonce,
replay protection, forged requests rejected. Mirrors the FORGE-side
verification in src/lib/receptionist/ingestAuth.js (same algorithm).
"""
import json
import os
import sys
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.integrations.forge import sign_body, verify_signature

SECRET = "synthetic-test-secret-only"


class TestIngestSigning(unittest.TestCase):
    def test_round_trip_verifies(self):
        body = json.dumps({"a": 1}, sort_keys=True).encode()
        ts, nonce = int(time.time()), "nonce-1"
        sig = sign_body(SECRET, body, ts, nonce)
        self.assertTrue(verify_signature(SECRET, body, ts, nonce, sig))

    def test_tampered_body_rejected(self):
        body = json.dumps({"a": 1}, sort_keys=True).encode()
        ts, nonce = int(time.time()), "nonce-1"
        sig = sign_body(SECRET, body, ts, nonce)
        self.assertFalse(verify_signature(SECRET, b'{"a": 2}', ts, nonce, sig))

    def test_wrong_secret_rejected(self):
        body = b"{}"
        ts, nonce = int(time.time()), "nonce-1"
        sig = sign_body(SECRET, body, ts, nonce)
        self.assertFalse(verify_signature("other-secret", body, ts, nonce, sig))

    def test_stale_timestamp_rejected_replay(self):
        body = b"{}"
        ts = int(time.time()) - 3600  # 1 hour old
        sig = sign_body(SECRET, body, ts, "nonce-1")
        self.assertFalse(verify_signature(SECRET, body, ts, "nonce-1", sig))

    def test_future_timestamp_rejected(self):
        body = b"{}"
        ts = int(time.time()) + 3600
        sig = sign_body(SECRET, body, ts, "nonce-1")
        self.assertFalse(verify_signature(SECRET, body, ts, "nonce-1", sig))

    def test_empty_signature_rejected(self):
        self.assertFalse(verify_signature(SECRET, b"{}", int(time.time()), "n", ""))


if __name__ == "__main__":
    unittest.main()
